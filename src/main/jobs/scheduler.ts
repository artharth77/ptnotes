import type { ScheduleJob, ScheduleJobEvent } from '@shared/scheduleJobs'
import { computeNextRunAt, planJobPrune, shouldRunExact, shouldRunNext } from '@shared/scheduleJobs'
import type { JobsStore } from './db'
import type { ScheduleJobRunner } from './runner'

const MINUTE_MS = 60_000

export interface JobSchedulerDeps {
  /** List of current project directory names. */
  listProjects: () => Promise<string[]>
  store: JobsStore
  runnerFor: (project: string) => Pick<ScheduleJobRunner, 'run'>
  broadcast: (evt: ScheduleJobEvent) => void
  /** False while the AI provider is unconfigured — job runs are skipped, purges still happen. */
  aiConfigured?: () => Promise<boolean>
}

/** Minute-tick scheduler: checks every project's enabled jobs and launches due runs. */
export class JobScheduler {
  private timer: NodeJS.Timeout | null = null
  private activeRuns = new Map<string, string>() // `${project}/${jobId}` -> runId
  private activePromises = new Set<Promise<void>>()
  private lastDailyPurge = new Map<string, number>()
  private readonly inflight = new Map<string, Promise<void>>()

  constructor(private readonly deps: JobSchedulerDeps) {}

  start(): void {
    if (this.timer) return
    // First tick aligned to the next minute boundary (:00 second); 60s interval after.
    const delay = MINUTE_MS - (Date.now() % MINUTE_MS)
    this.timer = setTimeout(() => {
      void this.tick()
      this.timer = setInterval(() => void this.tick(), MINUTE_MS)
    }, delay)
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      clearInterval(this.timer)
      this.timer = null
    }
  }

  isRunning(project: string, jobId: string): boolean {
    return this.activeRuns.has(`${project}/${jobId}`)
  }

  /** Evaluate all projects once. Re-entrancy safe via per-project inflight promise map. */
  async tick(now = Date.now()): Promise<void> {
    let projects: string[] = []
    try {
      projects = await this.deps.listProjects()
    } catch {
      return
    }
    const waiters: Promise<void>[] = []
    for (const project of projects) {
      const prev = this.inflight.get(project) ?? Promise.resolve()
      const run = prev.then(
        () => this.tickProject(project, now),
        () => undefined
      )
      waiters.push(run)
      this.inflight.set(
        project,
        run.then(
          () => undefined,
          () => undefined
        )
      )
    }
    await Promise.all(waiters)
  }

  private allowedDays(job: ScheduleJob): number[] {
    return job.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : job.days
  }

  /** Check one project's jobs and launch the due ones. */
  private async tickProject(project: string, now: number): Promise<void> {
    let aiReady = true
    if (this.deps.aiConfigured) {
      try {
        aiReady = await this.deps.aiConfigured()
      } catch {
        aiReady = true
      }
    }
    if (aiReady) {
      let jobs: ScheduleJob[] = []
      try {
        jobs = this.deps.store.listJobs(project).filter((j) => j.enabled)
      } catch {
        return
      }
      for (const job of jobs) {
        const key = `${project}/${job.id}`
        if (this.activeRuns.has(key)) continue
        const due =
          job.condition === 'next'
            ? shouldRunNext(now, job.nextRunAt)
            : shouldRunExact(job.timeRule, this.allowedDays(job), now, job.lastRunAt)
        if (!due) continue
        this.launch(project, job, key, now)
      }
      await this.drain()
    }
    await this.maybeDailyPurge(project, now)
  }

  /** Wait for the runs launched so far (keeps ticks and tests deterministic). */
  private async drain(): Promise<void> {
    while (this.activePromises.size > 0) {
      await Promise.all([...this.activePromises])
    }
  }

  /** Force-run a job immediately (Execute now), bypassing schedule checks. */
  runNow(project: string, jobId: string): void {
    const job = this.deps.store.getJob(project, jobId)
    if (!job) throw new Error(`Job not found: ${jobId}`)
    const key = `${project}/${jobId}`
    if (this.activeRuns.has(key)) return
    this.launch(project, job, key)
  }

  /** Start one run and keep it as active until the terminal event fires. */
  private launch(project: string, job: ScheduleJob, key: string, at = Date.now()): void {
    const run = this.deps.store.startRun(project, job.id, job.title, at)
    // 'next' mode: precompute and persist the next fire time BEFORE the run starts.
    if (job.condition === 'next') {
      const next = computeNextRunAt(job.timeRule, this.allowedDays(job), at + 1)
      this.deps.store.setLastRun(project, job.id, at, next)
    }
    this.activeRuns.set(key, run.runId)
    const promise = (async () => {
      try {
        const result = await this.deps.runnerFor(project).run(job, run)
        if (result.status === 'done') {
          this.deps.store.setLastRun(project, job.id, run.startedAt)
        }
        this.deps.store.finishRun(project, run.runId, result.status, {
          ...(result.statusNotice ? { notice: result.statusNotice } : {}),
          ...(result.statusError ? { error: result.statusError } : {})
        })
        if (result.notify && result.statusNotice) {
          this.deps.broadcast({
            type: 'notify',
            project,
            runId: run.runId,
            jobId: job.id,
            jobTitle: job.title,
            text: result.statusNotice,
            ts: Date.now()
          })
        }
      } catch (err) {
        this.deps.store.finishRun(project, run.runId, 'failed', { error: String(err) })
      } finally {
        this.activeRuns.delete(key)
        this.deps.broadcast({ type: 'runs-changed', project, jobId: job.id })
      }
    })()
    const tracked = promise.finally(() => {
      this.activePromises.delete(tracked)
    })
    this.activePromises.add(tracked)
  }

  /** Purge run history + traces older than retention — at most once per project per day. */
  private async maybeDailyPurge(project: string, now: number): Promise<void> {
    const last = this.lastDailyPurge.get(project) ?? 0
    if (now - last < 24 * 60 * 60 * 1000) return
    this.lastDailyPurge.set(project, now)
    try {
      const runs = this.deps.store.listAllRuns(project)
      const stale = planJobPrune(runs, now)
      await this.deps.store.purgeRuns(project, stale)
    } catch {
      // best-effort
    }
  }
}
