import { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, promises as fs } from 'fs'
import type {
  JobScope,
  ScheduleCondition,
  ScheduleJob,
  ScheduleJobInput,
  ScheduleJobRun
} from '@shared/scheduleJobs'
import { GLOBAL_PROJECT_KEY, sanitizeTimeRule } from '@shared/scheduleJobs'
import type { AiTraceFile } from '@shared/types'

function validateId(id: string): string {
  if (!id || id === '.' || id === '..' || id.includes('/') || id.includes('\\')) {
    throw new Error(`Invalid id: ${id}`)
  }
  return id
}

interface JobRow {
  id: string
  title: string
  enabled: number
  days: string
  time_rule: string
  condition: string
  prompt: string
  language: string | null
  scope: string | null
  next_run_at: number | null
  last_run_at: number | null
  created_at: number
  updated_at: number
}

interface RunRow {
  run_id: string
  job_id: string
  title: string
  started_at: number
  finished_at: number | null
  status: string
  notice: string | null
  error: string | null
}

const VALID_DAYS = new Set([0, 1, 2, 3, 4, 5, 6])

const JOBS_DDL = `CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  days TEXT NOT NULL,
  time_rule TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT 'exact',
  prompt TEXT NOT NULL DEFAULT '',
  language TEXT,
  scope TEXT NOT NULL DEFAULT 'project',
  next_run_at INTEGER,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS job_runs (
  run_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  title TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  notice TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs (started_at);`

function parseDays(raw: string | null): number[] {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown
    if (!Array.isArray(parsed)) return [0, 1, 2, 3, 4, 5, 6]
    const days = parsed.map(Number).filter((d) => VALID_DAYS.has(d))
    return days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6]
  } catch {
    return [0, 1, 2, 3, 4, 5, 6]
  }
}

function rowToJob(r: JobRow): ScheduleJob {
  let condition: ScheduleCondition = 'exact'
  if (r.condition === 'next') condition = 'next'
  return {
    id: r.id,
    title: r.title,
    enabled: !!r.enabled,
    days: parseDays(r.days),
    timeRule: sanitizeTimeRule(JSON.parse(r.time_rule)),
    condition,
    prompt: r.prompt,
    scope: r.scope === 'global' ? 'global' : 'project',
    ...(r.language ? { language: r.language } : {}),
    ...(r.next_run_at ? { nextRunAt: r.next_run_at } : {}),
    ...(r.last_run_at ? { lastRunAt: r.last_run_at } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function rowToRun(r: RunRow): ScheduleJobRun {
  const status = r.status
  return {
    runId: r.run_id,
    jobId: r.job_id,
    title: r.title,
    startedAt: r.started_at,
    ...(r.finished_at ? { finishedAt: r.finished_at } : {}),
    ...(status === 'done' || status === 'failed' || status === 'cancelled'
      ? { status: status as ScheduleJobRun['status'] }
      : { status: 'running' }),
    ...(r.notice ? { notice: r.notice } : {}),
    ...(r.error ? { error: r.error } : {})
  }
}

/**
 * SQLite persistence for scheduled jobs — per-project `<project>/.data/jobs/jobs.db`
 * (jobs + run history) plus append-only AI trace files in
 * `<project>/.data/jobs/traces/<runId>.trace.jsonl`. Global-scope jobs use the
 * empty project key and live in the root-level `<root>/.data/jobs/` instead.
 *
 * The DB is opened for a single call and closed straight after it, so no handle,
 * lock or journal sidecar is kept between calls and a cloud drive can sync the
 * file. `journal_mode = DELETE` (converted from WAL on open) keeps the
 * `jobs.db-wal` / `jobs.db-shm` sidecars from ever existing — WAL is unusable on
 * network/replicated filesystems anyway.
 */
export class JobsStore {
  private getRoot: () => string

  constructor(getRoot: () => string) {
    this.getRoot = getRoot
  }

  setRootDir(root: string): void {
    this.getRoot = () => root
  }

  private jobsDir(project: string): string {
    return join(this.getRoot(), project, '.data', 'jobs')
  }

  private dbPath(project: string): string {
    return join(this.jobsDir(project), 'jobs.db')
  }

  private hasDb(project: string): boolean {
    return existsSync(this.dbPath(project))
  }

  /**
   * Open the project DB, run `fn` on it, close it again — always in a `finally`,
   * so a throw can never leave a handle behind. Re-running the schema on every
   * open also repairs a file replaced by a copy synced from another machine.
   */
  private withDb<T>(project: string, fn: (db: DatabaseSync) => T): T {
    mkdirSync(this.jobsDir(project), { recursive: true })
    const db = new DatabaseSync(this.dbPath(project))
    try {
      db.exec('PRAGMA journal_mode = DELETE;')
      db.exec(JOBS_DDL)
      // Migration: pre-global-scope DBs lack the `scope` column.
      const cols = db.prepare('PRAGMA table_info(jobs)').all() as unknown as Array<{ name: string }>
      if (!cols.some((c) => c.name === 'scope')) {
        db.exec("ALTER TABLE jobs ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'")
      }
      return fn(db)
    } finally {
      db.close()
    }
  }

  /**
   * Reads and cleanups run only when the DB is already there: the minute-tick
   * scheduler polls every project, and that must not stamp an empty `jobs.db`
   * into projects that never had a job.
   */
  private withExistingDb<T>(project: string, fallback: T, fn: (db: DatabaseSync) => T): T {
    return this.hasDb(project) ? this.withDb(project, fn) : fallback
  }

  private jobOn(db: DatabaseSync, id: string): ScheduleJob | null {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(validateId(id)) as unknown as
      JobRow | undefined
    return row ? rowToJob(row) : null
  }

  listJobs(project: string): ScheduleJob[] {
    return this.withExistingDb<ScheduleJob[]>(project, [], (db) =>
      (db.prepare('SELECT * FROM jobs ORDER BY created_at').all() as unknown as JobRow[]).map(
        rowToJob
      )
    )
  }

  getJob(project: string, id: string): ScheduleJob | null {
    return this.withExistingDb<ScheduleJob | null>(project, null, (db) => this.jobOn(db, id))
  }

  saveJob(project: string, input: ScheduleJobInput): ScheduleJob {
    const now = Date.now()
    const title = String(input.title ?? '').trim()
    if (!title) throw new Error('Job title is required.')
    const prompt = String(input.prompt ?? '')
    if (!prompt.trim()) throw new Error('Job prompt is required.')
    const days = [...new Set(input.days.map(Number).filter((d) => VALID_DAYS.has(d)))]
    if (days.length === 0) throw new Error('A job needs at least one day of week.')
    const rule = sanitizeTimeRule(input.timeRule)
    const condition: ScheduleCondition = input.condition === 'next' ? 'next' : 'exact'
    const language = String(input.language ?? '').trim() || null
    const enabled = input.enabled === false ? 0 : 1
    if (input.id && !this.hasDb(project)) throw new Error(`Job not found: ${input.id}`)

    return this.withDb(project, (db) => {
      let scope: JobScope
      if (input.id) {
        const existing = this.jobOn(db, validateId(input.id))
        if (!existing) throw new Error(`Job not found: ${input.id}`)
        scope = input.scope ?? existing.scope
      } else {
        scope = input.scope ?? 'project'
      }
      if (scope === 'global' && project !== GLOBAL_PROJECT_KEY) {
        throw new Error('Global jobs must be saved under the global key.')
      }
      if (scope === 'project' && project === GLOBAL_PROJECT_KEY) {
        throw new Error('Project jobs must be saved under a project key.')
      }

      if (input.id) {
        const id = validateId(input.id)
        const nextRun =
          condition === 'next'
            ? (input.conditionMeta?.nextRunAt ?? this.jobOn(db, id)!.nextRunAt ?? null)
            : null
        db.prepare(
          `UPDATE jobs SET title = ?, enabled = ?, days = ?, time_rule = ?, condition = ?, prompt = ?, language = ?, scope = ?, next_run_at = ?, updated_at = ? WHERE id = ?`
        ).run(
          title,
          enabled,
          JSON.stringify(days),
          JSON.stringify(rule),
          condition,
          prompt,
          language,
          scope,
          nextRun,
          now,
          id
        )
        return this.jobOn(db, id)!
      }
      const id = randomUUID()
      db.prepare(
        `INSERT INTO jobs (id, title, enabled, days, time_rule, condition, prompt, language, scope, next_run_at, last_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        title,
        enabled,
        JSON.stringify(days),
        JSON.stringify(rule),
        condition,
        prompt,
        language,
        scope,
        condition === 'next' ? (input.conditionMeta?.nextRunAt ?? null) : null,
        null,
        now,
        now
      )
      return this.jobOn(db, id)!
    })
  }

  setJobEnabled(project: string, id: string, enabled: boolean): ScheduleJob {
    const clean = validateId(id)
    if (!this.hasDb(project)) throw new Error(`Job not found: ${id}`)
    return this.withDb(project, (db) => {
      const info = db
        .prepare('UPDATE jobs SET enabled = ?, updated_at = ? WHERE id = ?')
        .run(enabled ? 1 : 0, Date.now(), clean)
      if (info.changes === 0) throw new Error(`Job not found: ${id}`)
      return this.jobOn(db, clean)!
    })
  }

  /** Record a run; `nextRunAt === undefined` keeps the stored next fire time. */
  setLastRun(project: string, id: string, at: number, nextRunAt?: number | null): void {
    const clean = validateId(id)
    this.withDb(project, (db) => {
      db.prepare(
        'UPDATE jobs SET last_run_at = ?, next_run_at = COALESCE(?, next_run_at) WHERE id = ?'
      ).run(at || Date.now(), nextRunAt ?? null, clean)
    })
  }

  deleteJob(project: string, id: string): Promise<boolean> {
    return this.deleteJobWithTraces(project, id)
  }

  /** Delete a job, its run rows, and all of its run trace files. */
  async deleteJobWithTraces(project: string, id: string): Promise<boolean> {
    const clean = validateId(id)
    if (!this.hasDb(project)) return false
    // All DB work happens in one synchronous block; the trace files are removed
    // afterwards so no handle is open across an await.
    const { deleted, runIds } = this.withDb(project, (db) => {
      const runIds = (
        db.prepare('SELECT run_id FROM job_runs WHERE job_id = ?').all(clean) as unknown as Array<{
          run_id: string
        }>
      ).map((r) => r.run_id)
      const info = db.prepare('DELETE FROM jobs WHERE id = ?').run(clean)
      if (info.changes > 0) db.prepare('DELETE FROM job_runs WHERE job_id = ?').run(clean)
      return { deleted: info.changes > 0, runIds: info.changes > 0 ? runIds : [] }
    })
    for (const runId of runIds) {
      await fs.rm(this.tracePath(project, runId), { force: true }).catch(() => {})
    }
    return deleted
  }

  /**
   * Recreate a job under a different scope: create a new job (fresh id, fresh run
   * history) in the destination DB with the given fields, then delete the old job
   * with its run rows and trace files. Create-first so a failed delete can't lose
   * the job.
   */
  async moveJobScope(
    srcProject: string,
    destProject: string,
    id: string,
    input: ScheduleJobInput
  ): Promise<ScheduleJob> {
    const clean = validateId(id)
    const existing = this.getJob(srcProject, clean)
    if (!existing) throw new Error(`Job not found: ${id}`)
    const scope: JobScope = input.scope ?? existing.scope
    if (scope === existing.scope) throw new Error('Job scope is unchanged.')
    if (scope === 'global' && destProject !== GLOBAL_PROJECT_KEY) {
      throw new Error('Global jobs must be saved under the global key.')
    }
    if (scope === 'project' && destProject === GLOBAL_PROJECT_KEY) {
      throw new Error('Project jobs must be saved under a project key.')
    }
    const created = this.saveJob(destProject, { ...input, id: undefined, scope })
    await this.deleteJobWithTraces(srcProject, clean)
    return created
  }

  startRun(project: string, jobId: string, title: string, at = Date.now()): ScheduleJobRun {
    const run: ScheduleJobRun = {
      runId: randomUUID(),
      jobId: validateId(jobId),
      title,
      startedAt: at,
      status: 'running'
    }
    this.withDb(project, (db) => {
      db.prepare(
        `INSERT INTO job_runs (run_id, job_id, title, started_at, finished_at, status, notice, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(run.runId, run.jobId, run.title, run.startedAt, null, 'running', null, null)
    })
    return run
  }

  finishRun(
    project: string,
    runId: string,
    status: ScheduleJobRun['status'],
    extra?: { notice?: string; error?: string }
  ): void {
    const clean = validateId(runId)
    this.withDb(project, (db) => {
      db.prepare(
        `UPDATE job_runs SET finished_at = ?, status = ?, notice = ?, error = ? WHERE run_id = ?`
      ).run(Date.now(), status, extra?.notice ?? null, extra?.error ?? null, clean)
    })
  }

  /** Mark runs still 'running' as cancelled — crash recovery on first open of a project. */
  reconcileRuns(project: string): void {
    if (!this.hasDb(project)) return
    this.withDb(project, (db) => {
      db.prepare(
        `UPDATE job_runs SET finished_at = ?, status = 'cancelled', error = 'interrupted' WHERE status = 'running' AND started_at < ?`
      ).run(Date.now(), Date.now() - 24 * 60 * 60 * 1000)
    })
  }

  listRuns(project: string, jobId: string, limit = 5): ScheduleJobRun[] {
    const clean = validateId(jobId)
    return this.withExistingDb<ScheduleJobRun[]>(project, [], (db) =>
      (
        db
          .prepare('SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?')
          .all(clean, limit) as unknown as RunRow[]
      ).map(rowToRun)
    )
  }

  listAllRuns(project: string): ScheduleJobRun[] {
    return this.withExistingDb<ScheduleJobRun[]>(project, [], (db) =>
      (db.prepare('SELECT * FROM job_runs ORDER BY started_at').all() as unknown as RunRow[]).map(
        rowToRun
      )
    )
  }

  readRunTraceByRunId(project: string, runId: string): Promise<AiTraceFile | null> {
    return fs
      .readFile(this.tracePath(project, validateId(runId)), 'utf8')
      .catch(() => null)
      .then((raw) => {
        if (raw === null) return null
        const lines = raw.split('\n').filter((l) => l.trim())
        if (lines.length === 0) return null
        let header: Record<string, unknown> | null = null
        const entries: unknown[] = []
        for (let i = 0; i < lines.length; i++) {
          try {
            const parsed = JSON.parse(lines[i]) as Record<string, unknown>
            if (i === 0 && parsed.type === 'header') {
              header = parsed
              continue
            }
            entries.push(parsed)
          } catch {
            // skip malformed line
          }
        }
        if (!header) return null
        const last = entries[entries.length - 1] as { ts?: number } | undefined
        return {
          ...header,
          updatedAt: last?.ts ?? (header.startedAt as number),
          entries,
          path: this.tracePath(project, validateId(runId))
        } as AiTraceFile
      })
  }

  // ---- per-run AI trace (JSONL, append-only) ----

  private tracePath(project: string, runId: string): string {
    return join(this.jobsDir(project), 'traces', `${validateId(runId)}.trace.jsonl`)
  }

  async appendRunTrace(
    project: string,
    runId: string,
    header: unknown,
    lines: string[]
  ): Promise<void> {
    const dir = join(this.jobsDir(project), 'traces')
    await fs.mkdir(dir, { recursive: true })
    const path = this.tracePath(project, runId)
    try {
      await fs.access(path)
    } catch {
      await fs.appendFile(path, `${JSON.stringify(header)}\n`, 'utf8')
    }
    if (lines.length > 0) {
      await fs.appendFile(path, `${lines.join('\n')}\n`, 'utf8')
    }
  }

  /** Delete run rows older than cutoff together with their trace files. */
  async purgeRuns(project: string, runIds: string[]): Promise<number> {
    if (runIds.length === 0) return 0
    const removed = this.withExistingDb<number>(project, 0, (db) => {
      const del = db.prepare('DELETE FROM job_runs WHERE run_id = ?')
      let count = 0
      for (const runId of runIds) {
        try {
          del.run(validateId(runId))
          count++
        } catch {
          // skip invalid ids
        }
      }
      return count
    })
    for (const runId of runIds) {
      await fs.rm(this.tracePath(project, runId), { force: true }).catch(() => {})
    }
    return removed
  }
}
