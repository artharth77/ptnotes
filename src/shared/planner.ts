/**
 * Pure planner engine — schedule/calendar types + working-day math + rollups.
 * Mirrors `find.ts` / `slash.ts`: no imports, fully unit-testable.
 */

export type ScheduleStatus = 'not-started' | 'in-progress' | 'completed' | 'pending' | 'on-hold'

/** Project-level working-day configuration, stored at `<project>/planner/calendar.json`. */
export interface ProjectCalendar {
  /** First working weekday (0 = Sunday … 6 = Saturday). Default 1 (Monday). */
  weekStart: number
  /** Last working weekday (0 = Sunday … 6 = Saturday). Default 5 (Friday). */
  weekEnd: number
  /** Holiday dates as `YYYY-MM-DD`. */
  holidays: string[]
}

export interface ScheduleTask {
  id: string
  title: string
  status: ScheduleStatus
  owner: string
  /** Working days. Computed for parents; manual for leaves. */
  duration: number | null
  /** `YYYY-MM-DD` or empty/null. Computed for parents; manual for leaves. */
  planStart: string | null
  planEnd: string | null
  /** Free-form — never computed, even for parents. */
  actualStart: string | null
  actualEnd: string | null
  /** 0–100. Computed for parents; manual for leaves. */
  percentComplete: number
  note: string
  children: ScheduleTask[]
}

export interface Schedule {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  tasks: ScheduleTask[]
  /** Per-schedule editor column visibility. Absent keys default to visible. */
  columnVisibility?: Record<string, boolean>
}

/** List-item summary of a schedule, without the task tree. */
export interface ScheduleMeta {
  id: string
  name: string
  updatedAt: number
  taskCount: number
}

/** What a parent inherits from its children via `rollupChildren`. */
export interface RolledUpTask {
  percentComplete: number
  planStart: string | null
  planEnd: string | null
  duration: number | null
  status: ScheduleStatus
}

/** The default calendar: Monday–Friday, no holidays. */
export function defaultCalendar(): ProjectCalendar {
  return { weekStart: 1, weekEnd: 5, holidays: [] }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Sanitize a (possibly partial/corrupt) calendar loaded from disk into a valid one. */
export function normalizeCalendar(
  calendar: Partial<ProjectCalendar> | null | undefined
): ProjectCalendar {
  const fallback = defaultCalendar()
  const c = calendar ?? {}
  const weekStart =
    typeof c.weekStart === 'number' ? clampInt(c.weekStart, 0, 6) : fallback.weekStart
  const weekEnd = typeof c.weekEnd === 'number' ? clampInt(c.weekEnd, 0, 6) : fallback.weekEnd
  const holidays = Array.isArray(c.holidays)
    ? c.holidays.filter((h): h is string => typeof h === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h))
    : []
  return { weekStart, weekEnd, holidays }
}

/** Format a Date as `YYYY-MM-DD` in local time (the stored date form). */
export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse a `YYYY-MM-DD` string into a local Date. Invalid parts default to 0. */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

/** Whether a date is in the holiday list (`YYYY-MM-DD`). */
export function isHoliday(date: Date, holidays: string[]): boolean {
  return holidays.includes(formatDate(date))
}

/** Whether a date is a working day for the calendar (weekday range + not a holiday). */
export function isWorkingDay(date: Date, calendar: ProjectCalendar): boolean {
  if (isHoliday(date, calendar.holidays)) return false
  const day = date.getDay()
  if (calendar.weekStart <= calendar.weekEnd) {
    return day >= calendar.weekStart && day <= calendar.weekEnd
  }
  // Wrapped range (e.g. Sun–Fri): treat both sides as working.
  return day >= calendar.weekStart || day <= calendar.weekEnd
}

/** The next working day after `date` (skips weekends + holidays). */
function nextWorkingDay(date: Date, calendar: ProjectCalendar): Date {
  let next = addDays(date, 1)
  while (!isWorkingDay(next, calendar)) next = addDays(next, 1)
  return next
}

/** End date = `start` counted as day 1, advanced `duration - 1` working days. */
export function computeEndDate(start: string, duration: number, calendar: ProjectCalendar): string {
  if (!start || !duration || duration <= 0) return start
  let date = parseDate(start)
  let remaining = duration - 1
  while (remaining > 0) {
    date = nextWorkingDay(date, calendar)
    remaining--
  }
  return formatDate(date)
}

/** Working-day count in [start, end] inclusive (1 when start === end). 0 when end < start. */
export function computeDuration(start: string, end: string, calendar: ProjectCalendar): number {
  if (!start || !end) return 0
  const s = parseDate(start)
  const e = parseDate(end)
  if (s > e) return 0
  if (s.getTime() === e.getTime()) return 1
  let count = 0
  let d = s
  while (d <= e) {
    if (isWorkingDay(d, calendar)) count++
    d = addDays(d, 1)
  }
  return count
}

/**
 * End-date-fixed recompute. Decide which field was edited and recompute the other:
 * - start edited → keep `planEnd` fixed, recompute `duration`; if `planEnd` is not set yet
 *   but a `duration` is assigned, recompute `planEnd` (`start + duration - 1` working days).
 * - duration edited → recompute `planEnd` (`start + duration - 1` working days).
 * - end edited → keep the new `planEnd`, recompute `duration`.
 */
export function applyDateRule(
  prev: ScheduleTask,
  next: ScheduleTask,
  calendar: ProjectCalendar
): ScheduleTask {
  const result: ScheduleTask = { ...next }
  if (next.planStart !== prev.planStart) {
    if (next.planStart && next.planEnd) {
      result.duration = computeDuration(next.planStart, next.planEnd, calendar)
    } else if (next.planStart && next.duration && next.duration > 0) {
      result.planEnd = computeEndDate(next.planStart, next.duration, calendar)
    }
  } else if (next.duration !== prev.duration) {
    if (next.planStart && next.duration && next.duration > 0) {
      result.planEnd = computeEndDate(next.planStart, next.duration, calendar)
    }
  } else if (next.planEnd !== prev.planEnd) {
    if (next.planStart && next.planEnd) {
      result.duration = computeDuration(next.planStart, next.planEnd, calendar)
    }
  }
  return result
}

/** Derive status from percent. `Pending` and `On Hold` are manual only — never auto-changed. */
export function deriveStatus(percent: number, currentStatus: ScheduleStatus): ScheduleStatus {
  if (currentStatus === 'on-hold' || currentStatus === 'pending') return currentStatus
  if (percent <= 0) return 'not-started'
  if (percent >= 100) return 'completed'
  return 'in-progress'
}

/**
 * Compute a parent's fields from its (already rolled-up) children:
 * `%Complete` = duration-weighted mean, `planStart` = min, `planEnd` = max,
 * `duration` = working days between min..max, `status` = derived (pending/on-hold preserved).
 */
export function rollupChildren(
  children: ScheduleTask[],
  calendar: ProjectCalendar,
  currentStatus?: ScheduleStatus
): RolledUpTask {
  if (children.length === 0) {
    return {
      percentComplete: 0,
      planStart: null,
      planEnd: null,
      duration: null,
      status: deriveStatus(0, currentStatus ?? 'not-started')
    }
  }
  let weightTotal = 0
  let weightedPercent = 0
  let plainTotal = 0
  let minStart: string | null = null
  let maxEnd: string | null = null
  for (const child of children) {
    const weight = child.duration && child.duration > 0 ? child.duration : 0
    weightTotal += weight
    weightedPercent += child.percentComplete * weight
    plainTotal += child.percentComplete
    if (child.planStart && (!minStart || child.planStart < minStart)) minStart = child.planStart
    if (child.planEnd && (!maxEnd || child.planEnd > maxEnd)) maxEnd = child.planEnd
  }
  const percent =
    weightTotal > 0
      ? Math.round(weightedPercent / weightTotal)
      : Math.round(plainTotal / children.length)
  const duration = minStart && maxEnd ? computeDuration(minStart, maxEnd, calendar) : null
  return {
    percentComplete: percent,
    planStart: minStart,
    planEnd: maxEnd,
    duration,
    status: deriveStatus(percent, currentStatus ?? 'not-started')
  }
}

/**
 * Roll up one task subtree (bottom-up). Leaves keep their manual fields but get an
 * auto-derived status; parents get every computed field from their (rolled) children.
 */
export function rollupTask(task: ScheduleTask, calendar: ProjectCalendar): ScheduleTask {
  const children = task.children.map((c) => rollupTask(c, calendar))
  if (children.length === 0) {
    return { ...task, children, status: deriveStatus(task.percentComplete, task.status) }
  }
  const rolled = rollupChildren(children, calendar, task.status)
  return {
    ...task,
    children,
    percentComplete: rolled.percentComplete,
    planStart: rolled.planStart,
    planEnd: rolled.planEnd,
    duration: rolled.duration,
    status: rolled.status
  }
}

/** Roll up a whole schedule's task tree (top-level tasks get rolled up recursively). */
export function rollupScheduleTasks(
  tasks: ScheduleTask[],
  calendar: ProjectCalendar
): ScheduleTask[] {
  return tasks.map((t) => rollupTask(t, calendar))
}

/** Depth-first search for the first task whose title matches (case-insensitive). */
export function findTaskByTitle(tasks: ScheduleTask[], title: string): ScheduleTask | null {
  const needle = title.trim().toLowerCase()
  for (const task of tasks) {
    if (task.title.trim().toLowerCase() === needle) return task
    const found = findTaskByTitle(task.children, title)
    if (found) return found
  }
  return null
}

/** Count all tasks including nested children. */
export function countTasks(task: ScheduleTask): number {
  let n = 1
  for (const child of task.children) n += countTasks(child)
  return n
}

/** Outline number from tree position — `1`, `1.1`, `1.1.1`. Derived at render time. */
export function deriveTaskNo(parentNo: string | null, index: number): string {
  const n = String(index + 1)
  return parentNo ? `${parentNo}.${n}` : n
}

/** Guard schedule ids before building file paths (same rule as the note-id guard). */
export function validateScheduleId(id: string): string {
  if (!id || id === '.' || id === '..' || id.includes('/') || id.includes('\\')) {
    throw new Error(`Invalid schedule id: ${id}`)
  }
  return id
}

/** A fresh leaf task with empty fields (used by the editor + AI tools). */
export function emptyTask(): ScheduleTask {
  return {
    id: crypto.randomUUID(),
    title: '',
    status: 'not-started',
    owner: '',
    duration: 1,
    planStart: null,
    planEnd: null,
    actualStart: null,
    actualEnd: null,
    percentComplete: 0,
    note: '',
    children: []
  }
}
