/**
 * Shared pure logic for the scheduled-jobs feature (main + renderer + tests, no I/O).
 * A job fires tool-capable background AI runs per project; time evaluation lives here.
 */

export type ScheduleTimeRule =
  | { kind: 'hourly'; fromHours: number; toHours: number; minute: number }
  | { kind: 'every30'; fromHours: number; toHours: number }
  | { kind: 'every10'; fromHours: number; toHours: number }
  | { kind: 'list'; times: string[] }

export type ScheduleCondition = 'exact' | 'next'

/** Where a job runs: one project, or every project (fan-out + AI summary). */
export type JobScope = 'project' | 'global'

/**
 * Project key used for global-scope jobs. Global jobs live in the root-level
 * DB (`<root>/.data/jobs/jobs.db`) and are addressed with this empty key.
 */
export const GLOBAL_PROJECT_KEY = ''

/** Display name for a project key ('' = global scope). */
export function projectLabel(project: string): string {
  return project === GLOBAL_PROJECT_KEY ? 'All projects' : project
}

/** Main → renderer events for the scheduled-jobs system. */
export type ScheduleJobEvent =
  | {
      type: 'notify'
      project: string
      runId: string
      jobId: string
      jobTitle: string
      text: string
      ts: number
    }
  | { type: 'runs-changed'; project: string; jobId: string }

/** A scheduled job. `days` are JS getDay() values (0 = Sunday) — default is all seven. */
export interface ScheduleJob {
  id: string
  title: string
  enabled: boolean
  days: number[]
  timeRule: ScheduleTimeRule
  condition: ScheduleCondition
  prompt: string
  /** 'global' jobs run across every project and are stored in the root-level DB. */
  scope: JobScope
  /** Preferred response language; blank = English. */
  language?: string
  /** Next pre-computed fire time (ms) — only used by the 'next' condition. */
  nextRunAt?: number
  lastRunAt?: number
  createdAt: number
  updatedAt: number
}

/** One recorded job execution. */
export interface ScheduleJobRun {
  runId: string
  jobId: string
  title: string
  startedAt: number
  finishedAt?: number
  status: ScheduleJobRunStatus
  /** Final AI answer snapshot; suppressed from notification when NO_RESPONSE_MARK. */
  notice?: string
  error?: string
}

export type ScheduleJobRunStatus = 'running' | 'done' | 'failed' | 'cancelled'

/** Input for create/update; id absence means "new job". */
export interface ScheduleJobInput {
  id?: string
  title: string
  enabled: boolean
  days: number[]
  timeRule: ScheduleTimeRule
  condition: ScheduleCondition
  prompt: string
  language?: string
  /** Defaults to 'project' on create; on update, absence keeps the stored scope. */
  scope?: JobScope
  conditionMeta?: { lastRunAt?: number; nextRunAt?: number }
}

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
export const NO_RESPONSE_MARK = '**NO RESPONSE**'

/**
 * Robust NO RESPONSE detection: models often drop the `**` emphasis, change
 * casing, or wrap the phrase in prose — normalize markdown emphasis, quotes
 * and whitespace before matching.
 */
export function isNoResponse(text: string): boolean {
  const norm = text
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase()
  return norm.includes('NORESPONSE')
} /** Slack around the scheduled minute for the 'exact' (+-2 minutes) condition. */
export const EXACT_WINDOW_MS = 2 * 60 * 1000
/** Minimum time between two 'exact'-condition fires of the same job. */
export const EXACT_DEDUPE_MS = 3 * 60 * 1000
/** AI traces and run history older than this are purged. */
export const JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const TIME_RE = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/

function clampHour(v: unknown, fallback: number): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : fallback
}

/** Normalize an untrusted time rule shape into a valid ScheduleTimeRule. */
export function sanitizeTimeRule(rule: unknown): ScheduleTimeRule {
  const r = (rule ?? {}) as Record<string, unknown>
  const fromHours = clampHour(r.fromHours, 0)
  const toHours = clampHour(r.toHours, 23)
  switch (r.kind) {
    case 'every30':
      return { kind: 'every30', fromHours, toHours }
    case 'every10':
      return { kind: 'every10', fromHours, toHours }
    case 'list': {
      const times = Array.isArray(r.times)
        ? r.times
            .map((t) => String(t).trim())
            .filter((t) => TIME_RE.test(t))
            .sort()
        : []
      return { kind: 'list', times: [...new Set(times)] }
    }
    case 'hourly':
    default: {
      const minuteRaw = Math.floor(Number(r.minute))
      const minute = Number.isFinite(minuteRaw) ? Math.min(59, Math.max(0, minuteRaw)) : 0
      return { kind: 'hourly', fromHours, toHours, minute }
    }
  }
}

/** All minutes-of-day (0..1439) a job can fire at for a given rule. */
export function ruleMinutes(rule: ScheduleTimeRule): number[] {
  if (rule.kind === 'list') {
    const out: number[] = []
    for (const t of rule.times) {
      const m = TIME_RE.exec(t)
      if (!m) continue
      out.push(Number(m[1]) * 60 + Number(m[2]))
    }
    return [...new Set(out)].sort((a, b) => a - b)
  }
  const from = Math.min(rule.fromHours, rule.toHours)
  const to = Math.max(rule.fromHours, rule.toHours)
  const out: number[] = []
  for (let h = from; h <= to; h++) {
    if (rule.kind === 'hourly') {
      out.push(h * 60 + rule.minute)
    } else if (rule.kind === 'every30') {
      out.push(h * 60, h * 60 + 30)
    } else {
      out.push(h * 60, h * 60 + 10, h * 60 + 20, h * 60 + 30, h * 60 + 40, h * 60 + 50)
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

/** Local calendar midnight (local-time day start) for a given instant. */
export function localDayStart(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Local minutes-of-day (0..1439) for a given instant. */
export function localMinuteOfDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * Fire decision for the 'exact' condition: the current wall-clock minute must sit
 * within [slot, slot+2] minutes of a scheduled minute of an allowed day (the 2 minutes
 * AFTER the scheduled minute, never before it), and the previous run must be older
 * than the dedupe window (a late tick still fires, but only once).
 */
export function shouldRunExact(
  rule: ScheduleTimeRule,
  days: number[],
  now: number,
  prevRunAt?: number
): boolean {
  if (!days.includes(new Date(now).getDay())) return false
  if (prevRunAt !== undefined && now - prevRunAt < EXACT_DEDUPE_MS) return false
  const nowMin = localMinuteOfDay(now)
  for (const m of ruleMinutes(rule)) {
    // window after the slot; a slot late yesterday can still be due early today
    for (const slot of [m, m - 1440]) {
      const diff = nowMin - slot
      if (diff >= 0 && diff <= 2) return true
    }
  }
  return false
}

/**
 * Fire decision for the 'next' condition: current time has reached the
 * pre-computed nextRunAt.
 */
export function shouldRunNext(now: number, nextRunAt?: number): boolean {
  if (nextRunAt === undefined) return false
  return now >= nextRunAt && nextRunAt > 0
}

/** Recompute nextRunAt for the 'next' condition: first allowed slot strictly after `after`. */
export function computeNextRunAt(
  rule: ScheduleTimeRule,
  days: number[],
  after: number
): number | undefined {
  const minutes = ruleMinutes(rule)
  if (minutes.length === 0 || days.length === 0) return undefined
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const dayStart = localDayStart(after) + dayOffset * 86400000
    if (!days.includes(new Date(dayStart).getDay())) continue
    for (const m of minutes) {
      const at = dayStart + m * 60000
      if (at > after) return at
    }
  }
  return undefined
}

/**
 * Retention decision for run history / traces.
 * Returns the run ids that must be purged.
 */
export function planJobPrune(
  runs: readonly { runId: string; startedAt: number }[],
  now: number,
  retentionMs = JOB_RETENTION_MS
): string[] {
  const cutoff = now - retentionMs
  return runs.filter((r) => r.startedAt < cutoff).map((r) => r.runId)
}
