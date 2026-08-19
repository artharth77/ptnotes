import { useEffect, useRef, useState } from 'react'
import {
  mdiArrowDownCircleOutline,
  mdiArrowLeftCircleOutline,
  mdiArrowRightCircleOutline,
  mdiArrowUpCircleOutline,
  mdiCalendarMonth,
  mdiChevronDown,
  mdiChevronRight,
  mdiContentCopy,
  mdiContentCut,
  mdiPencil,
  mdiPlaylistPlus,
  mdiPlus,
  mdiTableRowPlusAfter,
  mdiTableRowPlusBefore,
  mdiTrashCan,
  mdiViewColumnOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { MdiIcon } from './MdiIcon'
import { Modal, PromptModal } from './Modal'
import { CalendarModal } from './CalendarModal'
import { PlannerColumnModal } from './PlannerColumnModal'
import {
  applyDateRule,
  countTasks,
  defaultCalendar,
  deriveTaskNo,
  emptyTask,
  rollupScheduleTasks
} from '@shared/planner'
import type { Schedule, ScheduleStatus, ScheduleTask } from '@shared/types'

function statusLabel(status: ScheduleStatus): string {
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

type PlannerColumnKey =
  | 'no'
  | 'title'
  | 'status'
  | 'owner'
  | 'duration'
  | 'planStart'
  | 'planEnd'
  | 'actualStart'
  | 'actualEnd'
  | 'percent'
  | 'note'

const COLUMNS: { key: PlannerColumnKey; label: string }[] = [
  { key: 'no', label: 'No.' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'owner', label: 'Owner' },
  { key: 'duration', label: 'Duration' },
  { key: 'planStart', label: 'Plan Start' },
  { key: 'planEnd', label: 'Plan End' },
  { key: 'actualStart', label: 'Actual Start' },
  { key: 'actualEnd', label: 'Actual End' },
  { key: 'percent', label: '%' },
  { key: 'note', label: 'Note' }
]

const COL_WIDTHS: Record<PlannerColumnKey, string> = {
  no: '46px',
  title: 'minmax(180px, 1fr)',
  status: '110px',
  owner: '120px',
  duration: '70px',
  planStart: '125px',
  planEnd: '125px',
  actualStart: '125px',
  actualEnd: '125px',
  percent: '70px',
  note: 'minmax(160px, auto)'
}

function colTemplate(visible: Set<PlannerColumnKey>): string {
  const cols: string[] = ['28px']
  for (const c of COLUMNS) {
    if (visible.has(c.key)) cols.push(COL_WIDTHS[c.key])
  }
  return cols.join(' ')
}

function initVisibleCols(saved: Record<string, boolean> | undefined): Set<PlannerColumnKey> {
  const defaults: Record<string, boolean> = {
    owner: false,
    actualStart: false,
    actualEnd: false
  }
  return new Set(
    COLUMNS.filter((c) => (saved ? saved[c.key] !== false : defaults[c.key] !== false)).map(
      (c) => c.key
    )
  )
}

interface FlatRow {
  task: ScheduleTask
  no: string
  depth: number
}

function flattenTasks(
  tasks: ScheduleTask[],
  parentNo: string | null,
  depth: number,
  collapsed: Set<string>,
  out: FlatRow[]
): FlatRow[] {
  tasks.forEach((task, i) => {
    const no = deriveTaskNo(parentNo, i)
    out.push({ task, no, depth })
    if (task.children.length > 0 && !collapsed.has(task.id)) {
      flattenTasks(task.children, no, depth + 1, collapsed, out)
    }
  })
  return out
}

function updateTask(
  tasks: ScheduleTask[],
  id: string,
  fn: (task: ScheduleTask) => ScheduleTask
): ScheduleTask[] {
  return tasks.map((t) => {
    if (t.id === id) return fn(t)
    if (t.children.length > 0) return { ...t, children: updateTask(t.children, id, fn) }
    return t
  })
}

function addSibling(tasks: ScheduleTask[], id: string, task: ScheduleTask): ScheduleTask[] {
  const out: ScheduleTask[] = []
  for (const t of tasks) {
    out.push(t)
    if (t.id === id) out.push(task)
    else if (t.children.length > 0) {
      out[out.length - 1] = { ...t, children: addSibling(t.children, id, task) }
    }
  }
  return out
}

function addChild(tasks: ScheduleTask[], id: string, task: ScheduleTask): ScheduleTask[] {
  return tasks.map((t) => {
    if (t.id === id) return { ...t, children: [...t.children, task] }
    if (t.children.length > 0) return { ...t, children: addChild(t.children, id, task) }
    return t
  })
}

function insertTasksAfter(
  tasks: ScheduleTask[],
  id: string,
  newTasks: ScheduleTask[]
): ScheduleTask[] {
  const out: ScheduleTask[] = []
  for (const t of tasks) {
    out.push(t)
    if (t.id === id) out.push(...newTasks)
    else if (t.children.length > 0) {
      out[out.length - 1] = { ...t, children: insertTasksAfter(t.children, id, newTasks) }
    }
  }
  return out
}

function removeTasks(tasks: ScheduleTask[], ids: Set<string>): ScheduleTask[] {
  return tasks
    .filter((t) => !ids.has(t.id))
    .map((t) => (t.children.length > 0 ? { ...t, children: removeTasks(t.children, ids) } : t))
}

function findTaskCtx(
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

function indentTask(tasks: ScheduleTask[], id: string): ScheduleTask[] {
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    if (t.id === id) {
      if (i === 0) return tasks
      const prev = tasks[i - 1]
      return [
        ...tasks.slice(0, i - 1),
        { ...prev, children: [...prev.children, t] },
        ...tasks.slice(i + 1)
      ]
    }
    if (t.children.length > 0) {
      const next = indentTask(t.children, id)
      if (next !== t.children)
        return tasks.map((x, idx) => (idx === i ? { ...x, children: next } : x))
    }
  }
  return tasks
}

function outdentTask(tasks: ScheduleTask[], id: string): ScheduleTask[] {
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    if (t.id === id) return tasks
    const childIdx = t.children.findIndex((c) => c.id === id)
    if (childIdx !== -1) {
      const child = t.children[childIdx]
      const newT = {
        ...t,
        children: [...t.children.slice(0, childIdx), ...t.children.slice(childIdx + 1)]
      }
      return [...tasks.slice(0, i), newT, child, ...tasks.slice(i + 1)]
    }
    if (t.children.length > 0) {
      const next = outdentTask(t.children, id)
      if (next !== t.children)
        return tasks.map((x, idx) => (idx === i ? { ...x, children: next } : x))
    }
  }
  return tasks
}

function hasPrecedingSibling(tasks: ScheduleTask[], id: string): boolean {
  const ctx = findTaskCtx(tasks, id)
  return !!ctx && ctx.index > 0
}

function moveTask(tasks: ScheduleTask[], id: string, dir: -1 | 1): ScheduleTask[] {
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    if (t.id === id) {
      const j = i + dir
      if (j < 0 || j >= tasks.length) return tasks
      const out = [...tasks]
      out[i] = tasks[j]
      out[j] = t
      return out
    }
    if (t.children.length > 0) {
      const next = moveTask(t.children, id, dir)
      if (next !== t.children)
        return tasks.map((x, idx) => (idx === i ? { ...x, children: next } : x))
    }
  }
  return tasks
}

function collectTopmost(
  tasks: ScheduleTask[],
  selectedIds: Set<string>,
  out: ScheduleTask[]
): ScheduleTask[] {
  for (const t of tasks) {
    if (selectedIds.has(t.id)) {
      out.push(t)
    } else if (t.children.length > 0) {
      collectTopmost(t.children, selectedIds, out)
    }
  }
  return out
}

function cloneTask(t: ScheduleTask): ScheduleTask {
  return JSON.parse(JSON.stringify(t)) as ScheduleTask
}

function cloneWithNewIds(t: ScheduleTask): ScheduleTask {
  return {
    ...cloneTask(t),
    id: crypto.randomUUID(),
    children: t.children.map(cloneWithNewIds)
  }
}

function DateField({
  value,
  onChange,
  readOnly,
  disabled
}: {
  value: string | null
  onChange: (v: string | null) => void
  readOnly?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <input
      ref={ref}
      type="date"
      className={`planner-input ${!value ? 'planner-date-empty' : ''}`}
      value={value ?? ''}
      readOnly={readOnly}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      onBlur={() => {
        if (!value && ref.current) ref.current.value = ''
      }}
    />
  )
}

export function PlannerEditor(): React.JSX.Element {
  const schedule = useAppStore((s) => s.scheduleContent)
  const calendar = useAppStore((s) => s.calendar)
  const updateScheduleContent = useAppStore((s) => s.updateScheduleContent)
  const saveSchedule = useAppStore((s) => s.saveSchedule)
  const renameSchedule = useAppStore((s) => s.renameSchedule)

  const [calendarOpen, setCalendarOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ tasks: ScheduleTask[] } | null>(null)
  const [statusMenu, setStatusMenu] = useState<{
    id: string
    x: number
    y: number
    mode: ScheduleStatus
  } | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [visibleCols, setVisibleCols] = useState<Set<PlannerColumnKey>>(() =>
    initVisibleCols(schedule?.columnVisibility)
  )
  const [prevScheduleId, setPrevScheduleId] = useState(schedule?.id)
  if (schedule?.id !== prevScheduleId) {
    setPrevScheduleId(schedule?.id)
    setVisibleCols(initVisibleCols(schedule?.columnVisibility))
  }
  const [clipboard, setClipboard] = useState<ScheduleTask[]>([])
  const [clipboardMode, setClipboardMode] = useState<'copy' | 'cut' | null>(null)
  const pendingFocusId = useRef<string | null>(null)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current)
        const latest = useAppStore.getState().scheduleContent
        if (latest) void useAppStore.getState().saveSchedule(latest)
      }
    }
  }, [])

  if (!schedule) return <></>
  const sc: Schedule = schedule
  const cal = calendar ?? defaultCalendar()
  const rows = flattenTasks(sc.tasks, null, 0, collapsed, [])
  const template = colTemplate(visibleCols)

  function renderRow(task: ScheduleTask, no: string, depth: number): React.JSX.Element {
    const isParent = task.children.length > 0
    return (
      <div
        className={`planner-grid-row${selected.has(task.id) ? ' planner-row-selected' : ''}`}
        style={{ gridTemplateColumns: template }}
        onClick={(e) => handleRowClick(e, task.id)}
      >
        <div className="planner-col-toggle planner-cell">
          {isParent ? (
            <button
              className="icon-btn small planner-toggle"
              title={collapsed.has(task.id) ? 'Expand' : 'Collapse'}
              onClick={() => toggleCollapse(task.id)}
            >
              <MdiIcon path={collapsed.has(task.id) ? mdiChevronRight : mdiChevronDown} size={15} />
            </button>
          ) : (
            <span className="planner-toggle-spacer" />
          )}
        </div>
        {visibleCols.has('no') && <div className="planner-col-no planner-cell">{no}</div>}
        {visibleCols.has('title') && (
          <div
            className="planner-col-title planner-cell"
            style={{ left: visibleCols.has('no') ? '74px' : '28px' }}
          >
            <input
              className="planner-input"
              ref={(el) => {
                if (el && pendingFocusId.current === task.id) {
                  pendingFocusId.current = null
                  el.focus()
                }
              }}
              style={{
                paddingLeft: depth * 14,
                fontWeight: isParent ? 600 : undefined
              }}
              value={task.title}
              placeholder={isParent ? 'Group task' : 'Task title'}
              onChange={(e) => editField(sc, task.id, 'title', e.target.value)}
            />
          </div>
        )}
        {visibleCols.has('status') && (
          <div className="planner-col-status planner-cell">
            <button
              type="button"
              className={`planner-status-label${
                task.status === 'on-hold' || task.status === 'pending'
                  ? ` planner-status-manual`
                  : ''
              }${task.status === 'in-progress' ? ' planner-status-inprogress' : ''}${
                task.status === 'completed' ? ' planner-status-completed' : ''
              }`}
              title="Status — click to change"
              onClick={(e) => {
                e.stopPropagation()
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setStatusMenu({
                  id: task.id,
                  x: Math.min(rect.left, window.innerWidth - 160),
                  y: rect.bottom + 2,
                  mode:
                    task.status === 'on-hold' || task.status === 'pending'
                      ? task.status
                      : 'not-started'
                })
              }}
            >
              {statusLabel(task.status)}
            </button>
          </div>
        )}
        {visibleCols.has('owner') && (
          <div className="planner-col-owner planner-cell">
            <input
              className={`planner-input${!task.owner ? ' planner-value-empty' : ''}`}
              value={task.owner}
              placeholder="Owner"
              onChange={(e) => editField(sc, task.id, 'owner', e.target.value)}
            />
          </div>
        )}
        {visibleCols.has('duration') && (
          <div className="planner-col-num planner-cell">
            <input
              type="number"
              min={1}
              className="planner-input planner-num"
              value={numberDrafts[numberDraftKey(task.id, 'duration')] ?? task.duration ?? ''}
              readOnly={isParent}
              disabled={isParent}
              onChange={(e) => {
                setNumberDrafts((d) => ({
                  ...d,
                  [numberDraftKey(task.id, 'duration')]: e.target.value
                }))
                commitNumber(sc, task.id, 'duration', e.target.value)
              }}
              onBlur={() =>
                normalizeNumber(
                  task.id,
                  'duration',
                  numberDrafts[numberDraftKey(task.id, 'duration')] ?? ''
                )
              }
            />
          </div>
        )}
        {visibleCols.has('planStart') && (
          <div className="planner-col-date planner-cell">
            <DateField
              value={task.planStart}
              readOnly={isParent}
              disabled={isParent}
              onChange={(v) => editField(sc, task.id, 'planStart', v)}
            />
          </div>
        )}
        {visibleCols.has('planEnd') && (
          <div className="planner-col-date planner-cell">
            <DateField
              value={task.planEnd}
              readOnly={isParent}
              disabled={isParent}
              onChange={(v) => editField(sc, task.id, 'planEnd', v)}
            />
          </div>
        )}
        {visibleCols.has('actualStart') && (
          <div className="planner-col-date planner-cell">
            <DateField
              value={task.actualStart}
              onChange={(v) => editField(sc, task.id, 'actualStart', v)}
            />
          </div>
        )}
        {visibleCols.has('actualEnd') && (
          <div className="planner-col-date planner-cell">
            <DateField
              value={task.actualEnd}
              onChange={(v) => editField(sc, task.id, 'actualEnd', v)}
            />
          </div>
        )}
        {visibleCols.has('percent') && (
          <div className="planner-col-num planner-cell">
            <input
              type="number"
              min={0}
              max={100}
              className="planner-input planner-num"
              value={
                numberDrafts[numberDraftKey(task.id, 'percentComplete')] ?? task.percentComplete
              }
              readOnly={isParent}
              disabled={isParent}
              onChange={(e) => {
                setNumberDrafts((d) => ({
                  ...d,
                  [numberDraftKey(task.id, 'percentComplete')]: e.target.value
                }))
                commitNumber(sc, task.id, 'percentComplete', e.target.value)
              }}
              onBlur={() =>
                normalizeNumber(
                  task.id,
                  'percentComplete',
                  numberDrafts[numberDraftKey(task.id, 'percentComplete')] ?? ''
                )
              }
            />
          </div>
        )}
        {visibleCols.has('note') && (
          <div className="planner-col-note planner-cell">
            <input
              className={`planner-input${!task.note ? ' planner-value-empty' : ''}`}
              value={task.note}
              placeholder="Note"
              onChange={(e) => editField(sc, task.id, 'note', e.target.value)}
            />
          </div>
        )}
      </div>
    )
  }

  function renderTaskTree(
    tasks: ScheduleTask[],
    parentNo: string | null,
    depth: number
  ): React.JSX.Element[] {
    return tasks.map((task, i) => {
      const no = deriveTaskNo(parentNo, i)
      const isParent = task.children.length > 0
      return (
        <div key={task.id} className="planner-task-group">
          {renderRow(task, no, depth)}
          {isParent && (
            <div className={`planner-children-collapse${collapsed.has(task.id) ? '' : ' open'}`}>
              <div className="planner-children-collapse-inner">
                {renderTaskTree(task.children, no, depth + 1)}
              </div>
            </div>
          )}
        </div>
      )
    })
  }

  function commit(base: Schedule, tasks: ScheduleTask[], override?: Partial<Schedule>): void {
    const nextSchedule = {
      ...base,
      ...override,
      tasks: rollupScheduleTasks(tasks, cal)
    }
    updateScheduleContent(nextSchedule)
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void saveSchedule(nextSchedule)
    }, 800)
  }

  function editTask(
    base: Schedule,
    id: string,
    updater: (prev: ScheduleTask) => ScheduleTask
  ): void {
    const tasks = updateTask(base.tasks, id, updater)
    commit(base, tasks)
  }

  function editField(base: Schedule, id: string, field: string, value: unknown): void {
    editTask(base, id, (prev) => {
      const next = { ...prev, [field]: value }
      if (field === 'planStart' || field === 'planEnd' || field === 'duration') {
        return applyDateRule(prev, next, cal)
      }
      return next
    })
  }

  function setTaskStatusMode(id: string, mode: 'auto' | 'pending' | 'on-hold'): void {
    editTask(sc, id, (prev) => ({
      ...prev,
      status: mode === 'auto' ? 'not-started' : mode
    }))
  }

  function toggleCollapse(id: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function lastSelectedId(): string | null {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (selected.has(rows[i].task.id)) return rows[i].task.id
    }
    return null
  }

  function firstSelectedId(): string | null {
    for (const row of rows) {
      if (selected.has(row.task.id)) return row.task.id
    }
    return null
  }

  function handleRowClick(e: React.MouseEvent, id: string): void {
    if (e.shiftKey) {
      if (anchorId && anchorId !== id) {
        const idxA = rows.findIndex((r) => r.task.id === anchorId)
        const idxB = rows.findIndex((r) => r.task.id === id)
        if (idxA !== -1 && idxB !== -1) {
          const lo = Math.min(idxA, idxB)
          const hi = Math.max(idxA, idxB)
          setSelected(new Set(rows.slice(lo, hi + 1).map((r) => r.task.id)))
          return
        }
      }
      setSelected(new Set([id]))
      setAnchorId(id)
      return
    }
    setSelected(new Set([id]))
    setAnchorId(id)
  }

  function handleNewTask(): void {
    const task = emptyTask()
    const targetId = lastSelectedId()
    if (targetId) commit(sc, addSibling(sc.tasks, targetId, task))
    else commit(sc, [...sc.tasks, task])
    setSelected(new Set([task.id]))
    setAnchorId(task.id)
    pendingFocusId.current = task.id
  }

  function handleNewSubtask(): void {
    const targetId = lastSelectedId()
    if (!targetId) return
    const task = emptyTask()
    commit(sc, addChild(sc.tasks, targetId, task))
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(targetId)
      return next
    })
    setSelected(new Set([task.id]))
    setAnchorId(task.id)
    pendingFocusId.current = task.id
  }

  function handleDeleteSelected(): void {
    const taskList = rows.filter((r) => selected.has(r.task.id)).map((r) => r.task)
    if (taskList.length === 0) return
    if (taskList.some((t) => t.children.length > 0)) {
      setConfirmDelete({ tasks: taskList })
      return
    }
    commit(sc, removeTasks(sc.tasks, selected))
    setSelected(new Set())
    setAnchorId(null)
  }

  function handleCopy(): void {
    const top: ScheduleTask[] = []
    collectTopmost(sc.tasks, selected, top)
    if (top.length === 0) return
    setClipboard(top.map(cloneTask))
    setClipboardMode('copy')
  }

  function handleCut(): void {
    const top: ScheduleTask[] = []
    collectTopmost(sc.tasks, selected, top)
    if (top.length === 0) return
    setClipboard(top.map(cloneTask))
    setClipboardMode('cut')
  }

  function applyClipboard(inserted: ScheduleTask[], clones: ScheduleTask[]): void {
    const next =
      clipboardMode === 'cut'
        ? removeTasks(inserted, new Set(clipboard.map((t) => t.id)))
        : inserted
    commit(sc, next)
    setSelected(new Set(clones.map((c) => c.id)))
    setAnchorId(clones[clones.length - 1]?.id ?? null)
    if (clipboardMode === 'cut') {
      setClipboard([])
      setClipboardMode(null)
    }
  }

  function handlePasteAfter(): void {
    if (clipboard.length === 0) return
    const clones = clipboard.map(cloneWithNewIds)
    const targetId = lastSelectedId()
    const inserted = targetId
      ? insertTasksAfter(sc.tasks, targetId, clones)
      : [...sc.tasks, ...clones]
    applyClipboard(inserted, clones)
  }

  function handlePasteBefore(): void {
    if (clipboard.length === 0) return
    const clones = clipboard.map(cloneWithNewIds)
    const targetId = firstSelectedId()
    let inserted: ScheduleTask[]
    if (!targetId) {
      inserted = [...sc.tasks, ...clones]
    } else {
      const idx = rows.findIndex((r) => r.task.id === targetId)
      if (idx <= 0) {
        inserted = [...clones, ...sc.tasks]
      } else {
        inserted = insertTasksAfter(sc.tasks, rows[idx - 1].task.id, clones)
      }
    }
    applyClipboard(inserted, clones)
  }

  function handleIndent(): void {
    let tasks = sc.tasks
    for (const row of rows) {
      if (selected.has(row.task.id)) tasks = indentTask(tasks, row.task.id)
    }
    commit(sc, tasks)
  }

  function handleOutdent(): void {
    let tasks = sc.tasks
    for (const row of rows) {
      if (selected.has(row.task.id)) tasks = outdentTask(tasks, row.task.id)
    }
    commit(sc, tasks)
  }

  function handleMoveUp(): void {
    let tasks = sc.tasks
    for (const row of rows) {
      const id = row.task.id
      if (!selected.has(id)) continue
      const ctx = findTaskCtx(tasks, id)
      if (ctx && ctx.index > 0 && !selected.has(ctx.parent[ctx.index - 1].id)) {
        tasks = moveTask(tasks, id, -1)
      }
    }
    commit(sc, tasks)
  }

  function handleMoveDown(): void {
    let tasks = sc.tasks
    for (let i = rows.length - 1; i >= 0; i--) {
      const id = rows[i].task.id
      if (!selected.has(id)) continue
      const ctx = findTaskCtx(tasks, id)
      if (ctx && ctx.index < ctx.parent.length - 1 && !selected.has(ctx.parent[ctx.index + 1].id)) {
        tasks = moveTask(tasks, id, 1)
      }
    }
    commit(sc, tasks)
  }

  const canIndent = rows.some(
    (r) => selected.has(r.task.id) && hasPrecedingSibling(sc.tasks, r.task.id)
  )
  const canOutdent = rows.some((r) => selected.has(r.task.id) && r.depth > 0)
  const canMoveUp = rows.some((r) => {
    if (!selected.has(r.task.id)) return false
    const ctx = findTaskCtx(sc.tasks, r.task.id)
    return !!ctx && ctx.index > 0 && !selected.has(ctx.parent[ctx.index - 1].id)
  })
  const canMoveDown = rows.some((r) => {
    if (!selected.has(r.task.id)) return false
    const ctx = findTaskCtx(sc.tasks, r.task.id)
    return !!ctx && ctx.index < ctx.parent.length - 1 && !selected.has(ctx.parent[ctx.index + 1].id)
  })

  function commitNumber(
    base: Schedule,
    id: string,
    field: 'duration' | 'percentComplete',
    raw: string
  ): void {
    const trimmed = raw.trim()
    if (trimmed === '') {
      editField(base, id, field, field === 'duration' ? null : 0)
      return
    }
    const n = Math.floor(Number(trimmed))
    if (isNaN(n)) return
    const clamped = field === 'duration' ? Math.max(1, n) : Math.min(100, Math.max(0, n))
    editField(base, id, field, clamped)
  }

  function numberDraftKey(id: string, field: 'duration' | 'percentComplete'): string {
    return `${field}:${id}`
  }

  function normalizeNumber(id: string, field: 'duration' | 'percentComplete', raw: string): void {
    const trimmed = raw.trim()
    const key = numberDraftKey(id, field)
    const next = { ...numberDrafts }
    if (trimmed === '') {
      delete next[key]
      commitNumber(sc, id, field, '')
    } else {
      const n = Math.floor(Number(trimmed))
      if (!isNaN(n)) {
        const clamped = field === 'duration' ? Math.max(1, n) : Math.min(100, Math.max(0, n))
        next[key] = String(clamped)
        commitNumber(sc, id, field, String(clamped))
      } else {
        delete next[key]
      }
    }
    setNumberDrafts(next)
  }

  const deleteTotal = confirmDelete ? confirmDelete.tasks.reduce((n, t) => n + countTasks(t), 0) : 0

  return (
    <div className="planner-editor">
      <div className="planner-titlebar">
        <span className="planner-toolbar-title" title={schedule.name}>
          {schedule.name}
        </span>
        <button
          className="icon-btn small"
          title="Rename schedule"
          onClick={() => setRenaming(true)}
        >
          <MdiIcon path={mdiPencil} size={14} />
        </button>
      </div>
      <div className="planner-toolbar">
        <div className="planner-toolbar-group">
          <button className="icon-btn" title="New task" onClick={handleNewTask}>
            <MdiIcon path={mdiPlus} size={16} />
          </button>
          <button
            className="icon-btn"
            title="New subtask"
            disabled={!lastSelectedId()}
            onClick={handleNewSubtask}
          >
            <MdiIcon path={mdiPlaylistPlus} size={16} />
          </button>
          <button
            className="icon-btn danger"
            title="Delete selected"
            disabled={selected.size === 0}
            onClick={handleDeleteSelected}
          >
            <MdiIcon path={mdiTrashCan} size={16} />
          </button>
        </div>
        <span className="planner-toolbar-divider" />
        <div className="planner-toolbar-group">
          <button
            className="icon-btn"
            title="Copy"
            disabled={selected.size === 0}
            onClick={handleCopy}
          >
            <MdiIcon path={mdiContentCopy} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Cut"
            disabled={selected.size === 0}
            onClick={handleCut}
          >
            <MdiIcon path={mdiContentCut} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Paste after"
            disabled={clipboard.length === 0}
            onClick={handlePasteAfter}
          >
            <MdiIcon path={mdiTableRowPlusAfter} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Paste before"
            disabled={clipboard.length === 0}
            onClick={handlePasteBefore}
          >
            <MdiIcon path={mdiTableRowPlusBefore} size={16} />
          </button>
        </div>
        <span className="planner-toolbar-divider" />
        <div className="planner-toolbar-group">
          <button
            className="icon-btn"
            title="Move to child level"
            disabled={!canIndent}
            onClick={handleIndent}
          >
            <MdiIcon path={mdiArrowRightCircleOutline} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Move to parent level"
            disabled={!canOutdent}
            onClick={handleOutdent}
          >
            <MdiIcon path={mdiArrowLeftCircleOutline} size={16} />
          </button>
          <button className="icon-btn" title="Move up" disabled={!canMoveUp} onClick={handleMoveUp}>
            <MdiIcon path={mdiArrowUpCircleOutline} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Move down"
            disabled={!canMoveDown}
            onClick={handleMoveDown}
          >
            <MdiIcon path={mdiArrowDownCircleOutline} size={16} />
          </button>
        </div>
        <span className="planner-toolbar-divider" />
        <div className="planner-toolbar-group">
          <button className="icon-btn" title="View columns" onClick={() => setColumnsOpen(true)}>
            <MdiIcon path={mdiViewColumnOutline} size={16} />
          </button>
          <button className="icon-btn" title="Calendar" onClick={() => setCalendarOpen(true)}>
            <MdiIcon path={mdiCalendarMonth} size={16} />
          </button>
        </div>
      </div>
      <div className="planner-content">
        {rows.length === 0 ? (
          <div className="empty-state">
            <p>No tasks yet — add a task to start building your schedule.</p>
            <button className="btn primary" onClick={handleNewTask}>
              + Add Task
            </button>
          </div>
        ) : (
          <div className="planner-grid-scroll">
            <div className="planner-grid">
              <div className="planner-grid-head" style={{ gridTemplateColumns: template }}>
                <div className="planner-col-toggle planner-cell"></div>
                {visibleCols.has('no') && <div className="planner-col-no planner-cell">No.</div>}
                {visibleCols.has('title') && (
                  <div
                    className="planner-col-title planner-cell"
                    style={{ left: visibleCols.has('no') ? '74px' : '28px' }}
                  >
                    Title
                  </div>
                )}
                {visibleCols.has('status') && (
                  <div className="planner-col-status planner-cell">Status</div>
                )}
                {visibleCols.has('owner') && (
                  <div className="planner-col-owner planner-cell">Owner</div>
                )}
                {visibleCols.has('duration') && (
                  <div className="planner-col-num planner-cell">Dur.</div>
                )}
                {visibleCols.has('planStart') && (
                  <div className="planner-col-date planner-cell">Plan Start</div>
                )}
                {visibleCols.has('planEnd') && (
                  <div className="planner-col-date planner-cell">Plan End</div>
                )}
                {visibleCols.has('actualStart') && (
                  <div className="planner-col-date planner-cell">Actual Start</div>
                )}
                {visibleCols.has('actualEnd') && (
                  <div className="planner-col-date planner-cell">Actual End</div>
                )}
                {visibleCols.has('percent') && (
                  <div className="planner-col-num planner-cell">%</div>
                )}
                {visibleCols.has('note') && (
                  <div className="planner-col-note planner-cell">Note</div>
                )}
              </div>
              <div className="planner-grid-body">{renderTaskTree(sc.tasks, null, 0)}</div>
            </div>
          </div>
        )}
      </div>

      {statusMenu && (
        <>
          <div className="menu-overlay" onClick={() => setStatusMenu(null)} />
          <div
            className="note-menu planner-status-menu"
            style={{ left: statusMenu.x, top: statusMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={`note-menu-item${statusMenu.mode === 'not-started' ? ' active' : ''}`}
              onClick={() => {
                setTaskStatusMode(statusMenu.id, 'auto')
                setStatusMenu(null)
              }}
            >
              [Auto]
            </button>
            <div className="note-menu-sep" />
            <button
              type="button"
              className={`note-menu-item${statusMenu.mode === 'pending' ? ' active' : ''}`}
              onClick={() => {
                setTaskStatusMode(statusMenu.id, 'pending')
                setStatusMenu(null)
              }}
            >
              Pending
            </button>
            <button
              type="button"
              className={`note-menu-item${statusMenu.mode === 'on-hold' ? ' active' : ''}`}
              onClick={() => {
                setTaskStatusMode(statusMenu.id, 'on-hold')
                setStatusMenu(null)
              }}
            >
              On Hold
            </button>
          </div>
        </>
      )}

      {confirmDelete && (
        <Modal title="Delete task" onClose={() => setConfirmDelete(null)}>
          <p className="confirm-message">
            {confirmDelete.tasks.length === 1
              ? confirmDelete.tasks[0].children.length > 0
                ? `Delete "${confirmDelete.tasks[0].title || 'Untitled'}" and its ${
                    deleteTotal - 1
                  } subtask${deleteTotal - 1 === 1 ? '' : 's'}? This cannot be undone.`
                : `Delete "${confirmDelete.tasks[0].title || 'Untitled'}"? This cannot be undone.`
              : `Delete ${confirmDelete.tasks.length} selected task${
                  confirmDelete.tasks.length === 1 ? '' : 's'
                } (${deleteTotal} total including subtasks)? This cannot be undone.`}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (confirmDelete) {
                  commit(sc, removeTasks(sc.tasks, new Set(confirmDelete.tasks.map((t) => t.id))))
                }
                setSelected(new Set())
                setAnchorId(null)
                setConfirmDelete(null)
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}

      {columnsOpen && (
        <PlannerColumnModal
          columns={COLUMNS}
          visible={visibleCols}
          onToggle={(key) => {
            const next = new Set(visibleCols)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            setVisibleCols(next)
          }}
          onClose={() => {
            const visibility = { ...(sc.columnVisibility ?? {}) }
            for (const c of COLUMNS) visibility[c.key] = visibleCols.has(c.key)
            commit(sc, sc.tasks, { columnVisibility: visibility })
            setColumnsOpen(false)
          }}
        />
      )}

      {calendarOpen && <CalendarModal onClose={() => setCalendarOpen(false)} />}

      {renaming && (
        <PromptModal
          title="Rename schedule"
          placeholder="Schedule name"
          initialValue={schedule.name}
          submitLabel="Rename"
          onClose={() => setRenaming(false)}
          onSubmit={(value) => {
            setRenaming(false)
            void renameSchedule(schedule.id, value)
          }}
        />
      )}
    </div>
  )
}
