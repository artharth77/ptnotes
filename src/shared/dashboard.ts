import type { NoteMeta } from './types'
import type { KanbanBoard, KanbanColumn, KanbanPriority } from './kanban'
import type { ProjectCalendar, Schedule, ScheduleStatus, ScheduleTask } from './planner'
import { collectOwners, normalizeOwner, overallPercentComplete, parseDate } from './planner'

export type WorkloadBucket = 'low' | 'medium' | 'high'

export interface WorkloadPerAssignee {
  owner: string
  kanbanCards: number
  kanbanStoryPoints: number
  plannerTasks: number
  totalItems: number
  bucket: WorkloadBucket
}

export interface KanbanPieRow {
  columnId: string
  title: string
  color: string
  count: number
  isDone: boolean
}

export interface KanbanPieStats {
  rows: KanbanPieRow[]
  totalCards: number
  totalActive: number
  totalDone: number
}

export type OverdueSourceKind = 'kanban-card' | 'planner-task'
export type OverdueSeverity = 'overdue' | 'today' | 'upcoming'

export interface OverdueItem {
  id: string
  kind: OverdueSourceKind
  severity: OverdueSeverity
  title: string
  dueDate: string
  assignee: string | null
  scheduleId?: string
  scheduleName?: string
  columnId?: string
  columnTitle?: string
  priority?: KanbanPriority | null
  percentComplete?: number
}

export interface PlannerHealth {
  scheduleCount: number
  totalTasks: number
  totalLeafTasks: number
  percentComplete: number
  onTimeTasks: number
  lateTasks: number
  ownerCount: number
  criticalPathDays: number
}

export interface RecentNote {
  id: string
  name: string
  updatedAt: number
  createdAt: number
  starred: boolean
}

export interface ActivityItem {
  kind: 'note' | 'kanban' | 'planner' | 'files' | 'chat'
  name: string
  path: string
  updatedAt: number
  detail?: string
}

export interface DashboardSnapshot {
  projectId: string
  projectName: string
  generatedAt: number
  workload: WorkloadPerAssignee[]
  kanbanStats: KanbanPieStats
  overdue: {
    overdue: OverdueItem[]
    today: OverdueItem[]
    upcoming: OverdueItem[]
    total: number
  }
  plannerHealth: PlannerHealth
  recentNotes: RecentNote[]
  activity: ActivityItem[]
}

const DONE_COLUMN_HINT_KEYWORDS = ['done', 'complete', 'closed', 'cancel', 'archive']

function isDoneColumn(col: KanbanColumn): boolean {
  const t = col.title.toLowerCase()
  return DONE_COLUMN_HINT_KEYWORDS.some((kw) => t.includes(kw))
}

const DONE_STATUS: ScheduleStatus = 'completed'

function bucketOfTotal(n: number): WorkloadBucket {
  if (n >= 8) return 'high'
  if (n >= 4) return 'medium'
  return 'low'
}

function cmpDateAsc(a: string | null, b: string | null): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b)
}

export function computeWorkload(kanban: KanbanBoard, schedules: Schedule[]): WorkloadPerAssignee[] {
  const map = new Map<string, WorkloadPerAssignee>()

  const register = (rawOwner: string): WorkloadPerAssignee => {
    const owner = normalizeOwner(rawOwner) || '(unassigned)'
    let row = map.get(owner)
    if (!row) {
      row = {
        owner,
        kanbanCards: 0,
        kanbanStoryPoints: 0,
        plannerTasks: 0,
        totalItems: 0,
        bucket: 'low'
      }
      map.set(owner, row)
    }
    return row
  }

  const doneColumnIds = new Set(kanban.columns.filter((c) => isDoneColumn(c)).map((c) => c.id))
  for (const card of kanban.cards) {
    if (doneColumnIds.has(card.columnId)) continue
    const row = register(card.assignee)
    row.kanbanCards += 1
    if (card.storyPoints != null && card.storyPoints > 0) {
      row.kanbanStoryPoints += card.storyPoints
    }
  }

  for (const schedule of schedules) {
    const walk = (tasks: ScheduleTask[]): void => {
      for (const task of tasks) {
        if (task.status !== DONE_STATUS) {
          const row = register(task.owner)
          row.plannerTasks += 1
        }
        if (task.children && task.children.length) walk(task.children)
      }
    }
    walk(schedule.tasks)
  }

  const out: WorkloadPerAssignee[] = []
  for (const row of map.values()) {
    row.totalItems = row.kanbanCards + row.plannerTasks
    row.bucket = bucketOfTotal(row.totalItems)
    out.push(row)
  }
  out.sort((a, b) => b.totalItems - a.totalItems || a.owner.localeCompare(b.owner))
  return out
}

export function computeKanbanStats(board: KanbanBoard): KanbanPieStats {
  const rows: KanbanPieRow[] = board.columns.map((col) => {
    const count = board.cards.filter((c) => c.columnId === col.id).length
    const isDone = isDoneColumn(col)
    return {
      columnId: col.id,
      title: col.title,
      color: col.color ?? '#8a8f98',
      count,
      isDone
    }
  })
  const totalCards = rows.reduce((a, r) => a + r.count, 0)
  const totalDone = rows.filter((r) => r.isDone).reduce((a, r) => a + r.count, 0)
  return {
    rows,
    totalCards,
    totalActive: totalCards - totalDone,
    totalDone
  }
}

function dateDifferenceDays(due: string | null, todayIso: string): number | null {
  if (!due) return null
  const d = parseDate(due).getTime()
  const t = parseDate(todayIso).getTime()
  return Math.round((d - t) / 86400000)
}

function collectTasksFlat(
  tasks: ScheduleTask[],
  scheduleId: string,
  scheduleName: string,
  acc: Array<{ task: ScheduleTask; scheduleId: string; scheduleName: string }>
): void {
  for (const task of tasks) {
    if (task.status !== DONE_STATUS) {
      acc.push({ task, scheduleId, scheduleName })
    }
    if (task.children && task.children.length) {
      collectTasksFlat(task.children, scheduleId, scheduleName, acc)
    }
  }
}

export function findOverdueItems(
  kanban: KanbanBoard,
  schedules: Schedule[],
  todayIso: string,
  upcomingDays = 7
): { overdue: OverdueItem[]; today: OverdueItem[]; upcoming: OverdueItem[]; total: number } {
  const overdue: OverdueItem[] = []
  const today: OverdueItem[] = []
  const upcoming: OverdueItem[] = []

  const doneColumnIds = new Set(kanban.columns.filter((c) => isDoneColumn(c)).map((c) => c.id))
  const colById = new Map(kanban.columns.map((c) => [c.id, c]))

  for (const card of kanban.cards) {
    if (doneColumnIds.has(card.columnId)) continue
    if (!card.dueDate) continue
    const diff = dateDifferenceDays(card.dueDate, todayIso)
    if (diff == null) continue
    let severity: OverdueSeverity
    if (diff < 0) severity = 'overdue'
    else if (diff === 0) severity = 'today'
    else if (diff <= upcomingDays) severity = 'upcoming'
    else continue
    const col = colById.get(card.columnId)
    const item: OverdueItem = {
      id: card.id,
      kind: 'kanban-card',
      severity,
      title: card.title,
      dueDate: card.dueDate,
      assignee: card.assignee || null,
      columnId: card.columnId,
      columnTitle: col?.title,
      priority: card.priority
    }
    if (severity === 'overdue') overdue.push(item)
    else if (severity === 'today') today.push(item)
    else upcoming.push(item)
  }

  const flatPlanner: Array<{
    task: ScheduleTask
    scheduleId: string
    scheduleName: string
  }> = []
  for (const s of schedules) collectTasksFlat(s.tasks, s.id, s.name, flatPlanner)
  for (const f of flatPlanner) {
    const task = f.task
    const due = task.planEnd
    if (!due) continue
    const diff = dateDifferenceDays(due, todayIso)
    if (diff == null) continue
    let severity: OverdueSeverity
    if (diff < 0) severity = 'overdue'
    else if (diff === 0) severity = 'today'
    else if (diff <= upcomingDays) severity = 'upcoming'
    else continue
    const item: OverdueItem = {
      id: `${f.scheduleId}:${task.id}`,
      kind: 'planner-task',
      severity,
      title: task.title,
      dueDate: due,
      assignee: normalizeOwner(task.owner) || null,
      scheduleId: f.scheduleId,
      scheduleName: f.scheduleName,
      percentComplete: task.percentComplete
    }
    if (severity === 'overdue') overdue.push(item)
    else if (severity === 'today') today.push(item)
    else upcoming.push(item)
  }

  const sorter = (a: OverdueItem, b: OverdueItem): number => cmpDateAsc(a.dueDate, b.dueDate)
  overdue.sort(sorter)
  today.sort(sorter)
  upcoming.sort(sorter)

  return {
    overdue,
    today,
    upcoming,
    total: overdue.length + today.length + upcoming.length
  }
}

function longestPathDays(tasks: ScheduleTask[], memo: WeakMap<ScheduleTask, number>): number {
  let best = 0
  for (const t of tasks) {
    let here = memo.get(t)
    if (here === undefined) {
      let sub = 0
      if (t.children && t.children.length) sub = longestPathDays(t.children, memo)
      here = (t.duration && t.duration > 0 ? t.duration : 0) + sub
      memo.set(t, here)
    }
    if (here > best) best = here
  }
  return best
}

export function computePlannerHealth(
  schedules: Schedule[],
  _calendar: ProjectCalendar,
  todayIso: string
): PlannerHealth {
  const scheduleCount = schedules.length
  let totalTasks = 0
  let totalLeaf = 0
  const allFlatTasks: ScheduleTask[] = []
  let criticalPath = 0
  const memo = new WeakMap<ScheduleTask, number>()
  const owners = new Set<string>()

  let completedCount = 0
  let activeLate = 0
  let activeNotLate = 0

  for (const schedule of schedules) {
    const walk = (tasks: ScheduleTask[]): void => {
      for (const t of tasks) {
        totalTasks += 1
        allFlatTasks.push(t)
        for (const name of collectOwners([t])) owners.add(name)
        if (t.children && t.children.length) {
          walk(t.children)
        } else {
          totalLeaf += 1
        }
        if (t.status === DONE_STATUS) {
          completedCount += 1
        } else {
          const diff = dateDifferenceDays(t.planEnd, todayIso)
          if (diff != null && diff < 0) activeLate += 1
          else activeNotLate += 1
        }
      }
    }
    walk(schedule.tasks)
    criticalPath = Math.max(criticalPath, longestPathDays(schedule.tasks, memo))
  }

  const percent = overallPercentComplete(allFlatTasks)
  const totalOnTime = completedCount + activeNotLate

  return {
    scheduleCount,
    totalTasks,
    totalLeafTasks: totalLeaf,
    percentComplete: Math.round(percent * 10) / 10,
    onTimeTasks: totalOnTime,
    lateTasks: activeLate,
    ownerCount: owners.size,
    criticalPathDays: criticalPath
  }
}

export function buildRecentNotes(list: NoteMeta[], limit = 5): RecentNote[] {
  return [...list]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((m) => ({
      id: m.id,
      name: m.name,
      updatedAt: m.updatedAt,
      createdAt: m.createdAt,
      starred: m.starred
    }))
}

export function buildActivityFromDates(
  notes: NoteMeta[],
  kanbanUpdatedAt: number | null,
  schedules: Schedule[],
  filesMtimes: Array<{ name: string; path: string; mtime: number }>,
  chatsUpdatedAt: Array<{ name: string; path: string; mtime: number }>,
  limit = 8
): ActivityItem[] {
  const items: ActivityItem[] = []
  for (const n of notes) {
    items.push({
      kind: 'note',
      name: n.name,
      path: `notes/${n.id}.md`,
      updatedAt: n.updatedAt,
      detail: `Note`
    })
  }
  if (kanbanUpdatedAt) {
    items.push({
      kind: 'kanban',
      name: 'Kanban Board',
      path: 'kanban/board.json',
      updatedAt: kanbanUpdatedAt,
      detail: 'Board'
    })
  }
  for (const s of schedules) {
    items.push({
      kind: 'planner',
      name: s.name,
      path: `planner/${s.id}.json`,
      updatedAt: s.updatedAt,
      detail: 'Schedule'
    })
  }
  for (const f of filesMtimes) {
    items.push({ kind: 'files', name: f.name, path: f.path, updatedAt: f.mtime, detail: 'File' })
  }
  for (const c of chatsUpdatedAt) {
    items.push({ kind: 'chat', name: c.name, path: c.path, updatedAt: c.mtime, detail: 'Chat' })
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt)
  return items.slice(0, limit)
}

export function buildDashboardSnapshot(input: {
  projectId: string
  projectName: string
  kanban: KanbanBoard
  schedules: Schedule[]
  notes: NoteMeta[]
  calendar: ProjectCalendar
  todayIso: string
  kanbanUpdatedAt: number | null
  filesMtimes: Array<{ name: string; path: string; mtime: number }>
  chatsUpdatedAt: Array<{ name: string; path: string; mtime: number }>
}): DashboardSnapshot {
  const workload = computeWorkload(input.kanban, input.schedules)
  const kanbanStats = computeKanbanStats(input.kanban)
  const overdue = findOverdueItems(input.kanban, input.schedules, input.todayIso)
  const plannerHealth = computePlannerHealth(input.schedules, input.calendar, input.todayIso)
  const recentNotes = buildRecentNotes(input.notes, 5)
  const activity = buildActivityFromDates(
    input.notes,
    input.kanbanUpdatedAt,
    input.schedules,
    input.filesMtimes,
    input.chatsUpdatedAt,
    8
  )
  return {
    projectId: input.projectId,
    projectName: input.projectName,
    generatedAt: Date.now(),
    workload,
    kanbanStats,
    overdue,
    plannerHealth,
    recentNotes,
    activity
  }
}
