/**
 * Pure planner engine — schedule/calendar types + working-day math + rollups.
 * Mirrors `find.ts` / `slash.ts`: no imports, fully unit-testable.
 */

export type ScheduleStatus = 'not-started' | 'in-progress' | 'completed' | 'pending' | 'on-hold'

/** Dependency link type: how a predecessor pins a successor's dates. */
export type TaskLinkType = 'FS' | 'SS' | 'FF' | 'SF'

/**
 * One incoming dependency link of a leaf task. `id` is the predecessor task's id,
 * `lag` is measured in working days (may be negative):
 * - FS: successor start = predecessor planEnd + lag; lag 0 → next working day.
 * - SS: successor start = predecessor planStart + lag (lag 0 = same day).
 * - FF: successor end = predecessor planEnd + lag (lag 0 = same day).
 * - SF: successor end = predecessor planStart + lag (lag 0 = the working day before it starts).
 */
export interface TaskLink {
  id: string
  type: TaskLinkType
  lag: number
}

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
  /** Incoming links (predecessors). Leaves only — parents are pure rollups. */
  dependsOn?: TaskLink[]
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
  /** Per-schedule editor column order (all column keys). Absent/invalid falls back to default. */
  columnOrder?: string[]
  /** Per-schedule planner title-column widths (px). Absent keys use the view default. */
  titleWidth?: ScheduleTitleWidth
}

/** Title-column width overrides for the planner grid/gantt views. */
export interface ScheduleTitleWidth {
  grid?: number
  gantt?: number
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

/** The first working day strictly after `date` (YYYY-MM-DD). */
export function nextWorkingDayString(date: string, calendar: ProjectCalendar): string {
  return formatDate(nextWorkingDay(parseDate(date), calendar))
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
 * Recomputed-field rule. Decide which field was edited and recompute the derived one,
 * preferring to keep `duration` fixed when it's set:
 * - start edited → keep `duration`, recompute `planEnd`; if no `duration` is set but a
 *   `planEnd` is assigned, keep `planEnd` and recompute `duration`.
 * - duration edited → recompute `planEnd` (`start + duration - 1` working days).
 * - end edited → keep the new `planEnd`, recompute `duration`.
 *
 * With dependency `constraints` the pinned edge is the anchor instead:
 * - end locked (FF/SF incoming) → start edited recomputes `duration`; duration edited
 *   pulls `planStart` back from the pinned `planEnd`. The pinned end is never moved.
 * - both edges locked → nothing is recomputed (all three fields are derived).
 */
export function applyDateRule(
  prev: ScheduleTask,
  next: ScheduleTask,
  calendar: ProjectCalendar,
  constraints?: LinkConstraints
): ScheduleTask {
  if (constraints?.startLocked && constraints?.endLocked) return { ...next }
  if (constraints?.endLocked) {
    const result: ScheduleTask = { ...next }
    if (next.planStart !== prev.planStart) {
      if (next.planStart && next.planEnd) {
        result.duration = computeDuration(next.planStart, next.planEnd, calendar)
      }
    } else if (next.duration !== prev.duration) {
      if (next.planEnd && next.duration && next.duration > 0) {
        result.planStart = shiftWorkingDaysStr(next.planEnd, -(next.duration - 1), calendar)
      }
    }
    return result
  }
  const result: ScheduleTask = { ...next }
  if (next.planStart !== prev.planStart) {
    if (next.planStart && next.duration && next.duration > 0) {
      result.planEnd = computeEndDate(next.planStart, next.duration, calendar)
    } else if (next.planStart && next.planEnd) {
      result.duration = computeDuration(next.planStart, next.planEnd, calendar)
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

/** Display label for a status (grid, Gantt, Excel export). */
export function statusLabel(status: ScheduleStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'on-hold':
      return 'On Hold'
    case 'completed':
      return 'Completed'
    case 'in-progress':
      return 'In Progress'
    default:
      return 'Not Started'
  }
}

/** Fill state of the Plan Indicator strip, derived at render time (never persisted). */
export type PlanIndicator = 'green' | 'yellow' | 'red' | 'none'

/**
 * Plan Indicator color for a row, computed from the record and today (`YYYY-MM-DD`):
 * - green: `percentComplete >= 100`
 * - red: < 100 and `planEnd` set and today > `planEnd`
 * - none: < 100 and no plan dates at all, or `planStart` set and today < `planStart`
 * - yellow: otherwise (< 100 and today >= `planStart`, not past `planEnd`)
 */
export function planIndicator(task: ScheduleTask, today: string): PlanIndicator {
  if (task.percentComplete >= 100) return 'green'
  if (task.planEnd && today > task.planEnd) return 'red'
  if (!task.planStart && !task.planEnd) return 'none'
  if (task.planStart && today < task.planStart) return 'none'
  return 'yellow'
}

/**
 * Sanitize a saved column order into a complete, valid one:
 * `fixedKeys` first (canonical order, never movable), then the saved keys that are known and
 * not fixed (deduped), then any remaining known keys in default order.
 */
export function normalizeColumnOrder(
  saved: string[] | null | undefined,
  allKeys: string[],
  fixedKeys: string[]
): string[] {
  const out: string[] = []
  const known = new Set(allKeys)
  for (const k of fixedKeys) if (known.has(k) && !out.includes(k)) out.push(k)
  for (const k of saved ?? []) {
    if (known.has(k) && !fixedKeys.includes(k) && !out.includes(k)) out.push(k)
  }
  for (const k of allKeys) if (!out.includes(k)) out.push(k)
  return out
}

/** Sanitize a title-column width: finite numbers are rounded and clamped to [min, max], else null. */
export function normalizeTitleWidth(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.round(value)))
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

// ---- Task dependencies ----

/** Which plan fields of a task are pinned by its incoming dependency links. */
export interface LinkConstraints {
  startLocked: boolean
  endLocked: boolean
}

/** A dependency problem reported for a task (`taskId` — the successor carrying `dependsOn`). */
export interface LinkIssue {
  taskId: string
  linkId: string
  message: string
}

/** A date conflict or unresolvable link found while applying dependencies. */
export interface LinkViolation {
  taskId: string
  message: string
}

/** Whether a task is a leaf (no children) — only leaves may participate in links. */
export function isLeafTask(task: ScheduleTask): boolean {
  return task.children.length === 0
}

/**
 * Which plan fields a task's incoming links pin:
 * - FS/SS incoming → `startLocked` (start computed from predecessors).
 * - FF/SF incoming → `endLocked` (end computed from predecessors).
 * - Both edges pinned → `start`/`end` computed and `duration` derived from the two.
 */
export function linkConstraints(task: Pick<ScheduleTask, 'dependsOn'>): LinkConstraints {
  let startLocked = false
  let endLocked = false
  for (const link of task.dependsOn ?? []) {
    if (link.type === 'FS' || link.type === 'SS') startLocked = true
    else endLocked = true
  }
  return { startLocked, endLocked }
}

/** Every ancestor id of the task with `id` (empty when it is a top-level task or missing). */
export function collectAncestorIds(tasks: ScheduleTask[], id: string): Set<string> {
  let found: Set<string> | null = null
  const walk = (list: ScheduleTask[], path: string[]): boolean => {
    for (const task of list) {
      if (task.id === id) {
        found = new Set(path)
        return true
      }
      if (walk(task.children, [...path, task.id])) return true
    }
    return false
  }
  walk(tasks, [])
  return found ?? new Set()
}

/**
 * Leaf tasks that may become predecessors of task `id`: leaves excluding the task itself,
 * its ancestors and its descendants (a self/descendant link would always be a cycle,
 * ancestor links are meaningless for leaf-only links).
 */
export function eligibleLinkTargets(tasks: ScheduleTask[], id: string): ScheduleTask[] {
  let target: ScheduleTask | null = null
  const find = (list: ScheduleTask[]): void => {
    for (const task of list) {
      if (task.id === id) target = task
      find(task.children)
    }
  }
  find(tasks)
  if (!target || !isLeafTask(target)) return []
  const ancestors = collectAncestorIds(tasks, id)
  const out: ScheduleTask[] = []
  const walk = (list: ScheduleTask[], skip: boolean): void => {
    for (const task of list) {
      if (task.id === id) {
        walk(task.children, true)
        continue
      }
      if (!skip && isLeafTask(task) && !ancestors.has(task.id)) out.push(task)
      walk(task.children, skip)
    }
  }
  walk(tasks, false)
  return out
}

interface TaskIndexEntry {
  task: ScheduleTask
  ancestors: Set<string>
}

function buildTaskIndex(tasks: ScheduleTask[]): Map<string, TaskIndexEntry> {
  const map = new Map<string, TaskIndexEntry>()
  const walk = (list: ScheduleTask[], ancestors: string[]): void => {
    for (const task of list) {
      map.set(task.id, { task, ancestors: new Set(ancestors) })
      walk(task.children, [...ancestors, task.id])
    }
  }
  walk(tasks, [])
  return map
}

/** Structural problems in the link graph: self/dup links, missing or non-leaf participants, ancestor links. */
export function validateLinks(tasks: ScheduleTask[]): LinkIssue[] {
  const index = buildTaskIndex(tasks)
  const issues: LinkIssue[] = []
  for (const [id, entry] of index) {
    const seen = new Set<string>()
    const leaf = isLeafTask(entry.task)
    if (!leaf && (entry.task.dependsOn ?? []).length > 0) {
      issues.push({ taskId: id, linkId: id, message: 'Only leaf tasks can have dependencies' })
    }
    for (const link of entry.task.dependsOn ?? []) {
      const key = `${link.id}|${link.type}`
      if (link.id === id) {
        issues.push({ taskId: id, linkId: link.id, message: 'A task cannot depend on itself' })
        continue
      }
      if (seen.has(key)) {
        issues.push({ taskId: id, linkId: link.id, message: 'Duplicate dependency link' })
        continue
      }
      seen.add(key)
      const pred = index.get(link.id)
      if (!pred) {
        issues.push({ taskId: id, linkId: link.id, message: 'Predecessor no longer exists' })
        continue
      }
      if (!isLeafTask(pred.task)) {
        issues.push({ taskId: id, linkId: link.id, message: 'Predecessor must be a leaf task' })
        continue
      }
      if (entry.ancestors.has(link.id)) {
        issues.push({ taskId: id, linkId: link.id, message: 'Predecessor is an ancestor task' })
        continue
      }
      if (pred.ancestors.has(id)) {
        issues.push({ taskId: id, linkId: link.id, message: 'Predecessor is a descendant task' })
      }
    }
  }
  return issues
}

/**
 * Cycle check over the leaf link graph. Returns the ids stuck in a cycle (null when the
 * graph is clean). Invalid links (missing/non-leaf/self) are ignored.
 */
export function detectCycle(tasks: ScheduleTask[]): string[] | null {
  const index = buildTaskIndex(tasks)
  const indeg = new Map<string, number>()
  const successors = new Map<string, string[]>()
  for (const [id, entry] of index) {
    if (!isLeafTask(entry.task)) continue
    indeg.set(id, 0)
  }
  for (const [id, entry] of index) {
    if (!isLeafTask(entry.task)) continue
    for (const link of entry.task.dependsOn ?? []) {
      if (link.id === id) continue
      const pred = index.get(link.id)
      if (!pred || !isLeafTask(pred.task)) continue
      successors.set(link.id, [...(successors.get(link.id) ?? []), id])
      indeg.set(id, (indeg.get(id) ?? 0) + 1)
    }
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  let processed = 0
  while (queue.length > 0) {
    const id = queue.pop() as string
    processed++
    for (const succId of successors.get(id) ?? []) {
      const d = (indeg.get(succId) ?? 0) - 1
      indeg.set(succId, d)
      if (d === 0) queue.push(succId)
    }
  }
  if (processed === indeg.size) return null
  return [...indeg.entries()].filter(([, d]) => d > 0).map(([id]) => id)
}

/** Shift a `YYYY-MM-DD` date by n working days (0 returns the date unchanged). */
function shiftWorkingDaysStr(date: string, n: number, calendar: ProjectCalendar): string {
  if (!date || n === 0) return date
  let cur = parseDate(date)
  if (n > 0) {
    for (let i = 0; i < n; i++) cur = nextWorkingDay(cur, calendar)
  } else {
    for (let i = 0; i > n; i--) {
      cur = addDays(cur, -1)
      while (!isWorkingDay(cur, calendar)) cur = addDays(cur, -1)
    }
  }
  return formatDate(cur)
}

/** The dates one link pins on its successor; null when the link cannot be applied. */
function linkTargetDates(
  link: TaskLink,
  successorId: string,
  current: Map<string, ScheduleTask>,
  calendar: ProjectCalendar
): { start?: string; end?: string } | null {
  if (link.id === successorId) return null
  const pred = current.get(link.id)
  if (!pred || !isLeafTask(pred)) return null
  switch (link.type) {
    case 'FS':
      if (!pred.planEnd) return null
      return { start: shiftWorkingDaysStr(pred.planEnd, link.lag + 1, calendar) }
    case 'SS':
      if (!pred.planStart) return null
      return { start: shiftWorkingDaysStr(pred.planStart, link.lag, calendar) }
    case 'FF':
      if (!pred.planEnd) return null
      return { end: shiftWorkingDaysStr(pred.planEnd, link.lag, calendar) }
    case 'SF':
      if (!pred.planStart) return null
      return { end: shiftWorkingDaysStr(pred.planStart, link.lag - 1, calendar) }
  }
}

function mapTree(tasks: ScheduleTask[], fn: (task: ScheduleTask) => ScheduleTask): ScheduleTask[] {
  return tasks.map((task) => {
    const updated = fn(task)
    return { ...updated, children: mapTree(updated.children, fn) }
  })
}

/** Remove every link pointing at the removed task id (whole tree). */
export function removeTaskLinks(tasks: ScheduleTask[], removedId: string): ScheduleTask[] {
  return mapTree(tasks, (task) => {
    if (!task.dependsOn?.length) return task
    const dependsOn = task.dependsOn.filter((l) => l.id !== removedId)
    if (dependsOn.length === task.dependsOn.length) return task
    return { ...task, dependsOn: dependsOn.length ? dependsOn : undefined }
  })
}

/**
 * Drop structurally invalid links (non-leaf or missing participants, self/ancestor/
 * descendant links, duplicates). Returns the cleaned tree and how many links were removed.
 */
export function stripInvalidLinks(tasks: ScheduleTask[]): {
  tasks: ScheduleTask[]
  removed: number
} {
  const index = buildTaskIndex(tasks)
  let removed = 0
  const cleaned = mapTree(tasks, (task) => {
    if (!task.dependsOn?.length) return task
    const entry = index.get(task.id)
    if (!entry) return task
    const links = task.dependsOn
    const keep = links.filter((link, i) => {
      if (isLeafTask(task) && link.id !== task.id) {
        const pred = index.get(link.id)
        if (
          pred &&
          isLeafTask(pred.task) &&
          !entry.ancestors.has(link.id) &&
          !pred.ancestors.has(task.id)
        ) {
          const firstAt = links.findIndex((l) => l.id === link.id && l.type === link.type)
          if (firstAt === i) return true
        }
      }
      removed++
      return false
    })
    if (keep.length === task.dependsOn.length) return task
    return keep.length ? { ...task, dependsOn: keep } : { ...task, dependsOn: undefined }
  })
  return { tasks: cleaned, removed }
}

export interface AppliedDependencies {
  tasks: ScheduleTask[]
  violations: LinkViolation[]
}

/**
 * Recompute leaf plan dates from dependency links (FS/SS/FF/SF + lag), in topological
 * order so chained links resolve through freshly computed predecessor dates. Run this
 * BEFORE `rollupScheduleTasks` so parents roll up from the resolved leaves.
 *
 * - Incoming FS/SS pin `planStart` (max over the links), FF/SF pin `planEnd`.
 * - Both edges pinned → `duration` is derived from the two computed dates; when
 *   start > end the range is reported as a violation.
 * - A pinned start recomputes the free end from `duration` (mirror of the date rule);
 *   when no `duration` is set, the existing end is kept and `duration` recomputed.
 * - A pinned end recomputes `duration` from the pinned end and the manual start, and
 *   repairs an inverted manual start by pulling it back from the pinned end.
 * - Links whose predecessor is missing, is a parent, or lacks the needed date are
 *   skipped with a violation.
 * On a cycle, the tasks are returned unchanged with violations.
 */
export function applyDependencies(
  tasks: ScheduleTask[],
  calendar: ProjectCalendar
): AppliedDependencies {
  const cycle = detectCycle(tasks)
  const violations: LinkViolation[] = []
  if (cycle) {
    for (const id of cycle) violations.push({ taskId: id, message: 'Dependency cycle detected' })
    return { tasks, violations }
  }
  const index = buildTaskIndex(tasks)
  const current = new Map<string, ScheduleTask>()
  for (const [id, entry] of index) current.set(id, entry.task)
  // Topological order via Kahn's algorithm (graph already cycle-free).
  const indeg = new Map<string, number>()
  const successors = new Map<string, string[]>()
  for (const [id, entry] of index) {
    if (!isLeafTask(entry.task)) continue
    indeg.set(id, 0)
  }
  for (const [id, entry] of index) {
    if (!isLeafTask(entry.task)) continue
    for (const link of entry.task.dependsOn ?? []) {
      if (link.id === id) continue
      const pred = index.get(link.id)
      if (!pred || !isLeafTask(pred.task)) continue
      successors.set(link.id, [...(successors.get(link.id) ?? []), id])
      indeg.set(id, (indeg.get(id) ?? 0) + 1)
    }
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.pop() as string
    order.push(id)
    for (const succId of successors.get(id) ?? []) {
      const d = (indeg.get(succId) ?? 0) - 1
      indeg.set(succId, d)
      if (d === 0) queue.push(succId)
    }
  }
  const maxOf = (list: string[]): string => list.reduce((a, b) => (b > a ? b : a))
  for (const id of order) {
    const task = current.get(id)
    if (!task) continue
    const links = task.dependsOn ?? []
    if (links.length === 0) continue
    const startCands: string[] = []
    const endCands: string[] = []
    for (const link of links) {
      const target = linkTargetDates(link, id, current, calendar)
      if (!target) {
        const pred = current.get(link.id)
        if (pred && isLeafTask(pred)) {
          const needed = link.type === 'FS' || link.type === 'FF' ? 'end date' : 'start date'
          violations.push({
            taskId: id,
            message: `Predecessor "${pred.title}" has no ${needed}`
          })
        }
        continue
      }
      if (target.start) startCands.push(target.start)
      if (target.end) endCands.push(target.end)
    }
    const next: ScheduleTask = { ...task }
    const newStart = startCands.length ? maxOf(startCands) : null
    const newEnd = endCands.length ? maxOf(endCands) : null
    if (newStart) next.planStart = newStart
    if (newEnd) next.planEnd = newEnd
    if (newStart && newEnd) {
      if (newStart <= newEnd) {
        next.duration = computeDuration(newStart, newEnd, calendar)
      } else {
        violations.push({
          taskId: id,
          message: `Dependency dates conflict (start ${newStart} after end ${newEnd})`
        })
        next.duration = 0
      }
    } else if (newStart) {
      if (next.duration && next.duration > 0) {
        next.planEnd = computeEndDate(newStart, next.duration, calendar)
      } else if (next.planEnd) {
        next.duration = computeDuration(newStart, next.planEnd, calendar)
      }
    } else if (newEnd) {
      if (next.planStart && next.planStart > newEnd) {
        if (next.duration && next.duration > 0) {
          next.planStart = shiftWorkingDaysStr(newEnd, -(next.duration - 1), calendar)
        } else {
          next.planStart = newEnd
        }
      }
      if (next.planStart) next.duration = computeDuration(next.planStart, newEnd, calendar)
    }
    current.set(id, next)
  }
  const rebuilt = mapTree(tasks, (task) => current.get(task.id) ?? task)
  return { tasks: rebuilt, violations }
}

/**
 * Overall %complete of a schedule: duration-weighted mean of the top-level tasks'
 * `percentComplete` (same weights as `rollupChildren`; plain mean when none have a
 * duration). 0 for an empty schedule.
 */
export function overallPercentComplete(tasks: ScheduleTask[]): number {
  if (tasks.length === 0) return 0
  let weightTotal = 0
  let weightedPercent = 0
  let plainTotal = 0
  for (const task of tasks) {
    const weight = task.duration && task.duration > 0 ? task.duration : 0
    weightTotal += weight
    weightedPercent += task.percentComplete * weight
    plainTotal += task.percentComplete
  }
  return weightTotal > 0
    ? Math.round(weightedPercent / weightTotal)
    : Math.round(plainTotal / tasks.length)
}

/**
 * Estimated %complete of a task tree as of `estimateDate` (`YYYY-MM-DD`):
 * a leaf counts as 100 when it is already 100% or its `planEnd` is on/before the date,
 * otherwise it keeps its user-filled value (also when `planEnd` is missing). Parents and the
 * root level are the duration-weighted mean of their children's estimates — the same weights
 * as `rollupChildren`.
 */
export function estimatePercentComplete(tasks: ScheduleTask[], estimateDate: string): number {
  const estimate = (task: ScheduleTask): number => {
    if (task.children.length === 0) {
      if (task.percentComplete >= 100) return 100
      if (task.planEnd && task.planEnd <= estimateDate) return 100
      return task.percentComplete
    }
    return rollupChildren(
      task.children.map((c) => ({ ...c, percentComplete: estimate(c) })),
      defaultCalendar()
    ).percentComplete
  }
  return rollupChildren(
    tasks.map((t) => ({ ...t, percentComplete: estimate(t) })),
    defaultCalendar()
  ).percentComplete
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

/** Locate a task's parent list and index within it by id. */
export function findTaskCtx(
  tasks: ScheduleTask[],
  id: string
): { parent: ScheduleTask[]; index: number } | null {
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].id === id) return { parent: tasks, index: i }
    if (tasks[i].children.length > 0) {
      const found = findTaskCtx(tasks[i].children, id)
      if (found) return found
    }
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

/** Split a free-text owner field into individual names (comma-separated). */
export function parseOwners(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/**
 * Normalize a free-text owner field: split by comma, trim, drop empties, dedupe
 * case-insensitively (first-seen spelling wins), rejoin with ', '.
 */
export function normalizeOwner(value: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of parseOwners(value)) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out.join(', ')
}

/** Distinct owner names across a task tree, in display (DFS) order, case-insensitive. */
export function collectOwners(tasks: ScheduleTask[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const walk = (t: ScheduleTask): void => {
    for (const name of parseOwners(t.owner)) {
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(name)
    }
    t.children.forEach(walk)
  }
  tasks.forEach(walk)
  return out
}

/** Per-owner workload stats for the Resources view. */
export interface OwnerStats {
  name: string
  assigned: number
  notStarted: number
  inProgress: number
  completed: number
  percentComplete: number
}

/**
 * Per-owner stats across a task tree (DFS). Each name in a task's `owner` field is credited
 * with that task. Names are deduped case-insensitively (first-seen spelling wins, display
 * order). `assigned` counts every task the name appears on; `notStarted`/`inProgress`/
 * `completed` bucket by status (`pending`/`on-hold` count toward `assigned` only).
 * `percentComplete` is the duration-weighted mean of the name's tasks' `percentComplete`
 * (same weights as `rollupChildren`; plain mean when none have a duration).
 */
export function ownerStats(tasks: ScheduleTask[]): OwnerStats[] {
  const map = new Map<string, OwnerStats>()
  const weightTotal = new Map<string, number>()
  const weightedPercent = new Map<string, number>()
  const plainTotal = new Map<string, number>()

  const credit = (name: string, task: ScheduleTask): void => {
    const key = name.toLowerCase()
    let stats = map.get(key)
    if (!stats) {
      stats = { name, assigned: 0, notStarted: 0, inProgress: 0, completed: 0, percentComplete: 0 }
      map.set(key, stats)
      weightTotal.set(key, 0)
      weightedPercent.set(key, 0)
      plainTotal.set(key, 0)
    }
    stats.assigned++
    if (task.status === 'not-started') stats.notStarted++
    else if (task.status === 'in-progress') stats.inProgress++
    else if (task.status === 'completed') stats.completed++
    const weight = task.duration && task.duration > 0 ? task.duration : 0
    weightTotal.set(key, (weightTotal.get(key) ?? 0) + weight)
    weightedPercent.set(key, (weightedPercent.get(key) ?? 0) + task.percentComplete * weight)
    plainTotal.set(key, (plainTotal.get(key) ?? 0) + task.percentComplete)
  }

  const walk = (task: ScheduleTask): void => {
    for (const name of parseOwners(task.owner)) credit(name, task)
    task.children.forEach(walk)
  }
  tasks.forEach(walk)

  const out: OwnerStats[] = []
  for (const stats of map.values()) {
    const key = stats.name.toLowerCase()
    const wt = weightTotal.get(key) ?? 0
    const wp = weightedPercent.get(key) ?? 0
    const pt = plainTotal.get(key) ?? 0
    stats.percentComplete = wt > 0 ? Math.round(wp / wt) : Math.round(pt / stats.assigned)
    out.push(stats)
  }
  return out
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

// ---- Excel export ----

/** One exported column: the planner column key + its display label. */
export interface PlannerExportColumn {
  key: string
  label: string
}

/** One exported row: a flattened task with its tree position. */
export interface PlannerExportRow {
  no: string
  title: string
  status: ScheduleStatus
  owner: string
  duration: number | null
  planStart: string | null
  planEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  percentComplete: number
  note: string
  /** Comma-joined predecessor summary (`1.2 FS+1`), null when the row has no links. */
  dependsOn?: string | null
  depth: number
  hasChildren: boolean
}

/** How the C5 progress line is written. */
export type PlannerProgressMode = 'percent' | 'percent-plan'

/** Which Gantt timeline the export embeds (none = table only). */
export type PlannerGanttMode = 'none' | 'day' | 'week'

/** Everything the main process needs to build the .xlsx (no file access in the renderer). */
export interface PlannerExportPayload {
  scheduleName: string
  overallPercent: number
  columns: PlannerExportColumn[]
  rows: PlannerExportRow[]
  /** Working-day config for the exported Gantt's non-working-day shading. */
  calendar: ProjectCalendar
  /** As-of date for the progress line and the Gantt highlight (`YYYY-MM-DD`). */
  progressDate: string
  progressMode: PlannerProgressMode
  /** Planned %complete as of `progressDate` (null when `progressMode` is `'percent'`). */
  planPercent: number | null
  ganttMode: PlannerGanttMode
}

/** Result of `planner:exportExcel`. */
export interface PlannerExportResult {
  ok: boolean
  /** True when the user dismissed the save dialog. */
  canceled?: boolean
  /** Absolute path of the written file (when ok). */
  path?: string
  /** Error message (when !ok and not canceled). */
  error?: string
}
