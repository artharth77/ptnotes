import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  mdiAccountGroup,
  mdiArrowDownCircleOutline,
  mdiArrowLeftCircleOutline,
  mdiArrowRightCircleOutline,
  mdiArrowUpCircleOutline,
  mdiCalendarClock,
  mdiCalendarMonth,
  mdiCalendarRemove,
  mdiChartTimeline,
  mdiChevronDown,
  mdiChevronRight,
  mdiClose,
  mdiContentCopy,
  mdiContentCut,
  mdiContentPaste,
  mdiFileExcelOutline,
  mdiGrid,
  mdiHistory,
  mdiMagnifyMinus,
  mdiMagnifyPlus,
  mdiPencil,
  mdiPercent,
  mdiPlaylistPlus,
  mdiPlus,
  mdiRedo,
  mdiTableRowPlusAfter,
  mdiTableRowPlusBefore,
  mdiTargetVariant,
  mdiTrashCanOutline,
  mdiUndo,
  mdiViewColumnOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { MdiIcon } from './MdiIcon'
import { PromptModal, ConfirmModal } from './Modal'
import { friendlyError } from '../errors'
import { CalendarModal } from './CalendarModal'
import { PlannerColumnModal } from './PlannerColumnModal'
import { PlannerEstimateModal } from './PlannerEstimateModal'
import { PlannerExportModal, type PlannerExportOptions } from './PlannerExportModal'
import { PlannerResourcesModal } from './PlannerResourcesModal'
import {
  GanttChart,
  GANTT_DAY_WIDTH_DEFAULT,
  GANTT_DAY_WIDTH_MAX,
  GANTT_DAY_WIDTH_MIN,
  GANTT_TITLE_WIDTH_DEFAULT,
  GANTT_TITLE_WIDTH_MAX,
  GANTT_TITLE_WIDTH_MIN,
  type GanttLinkLock
} from './GanttChart'
import { PlannerResizeHandle } from './PlannerResizeHandle'
import { nameTipFrom, NameTip, type NameTipState } from './NameTip'
import { resolveKanbanCardNames } from '@shared/bots'
import type { KanbanCard } from '@shared/kanban'
import { KANBAN_LINK_ICON, NOTE_LINK_ICON } from './contentIcons'
import {
  applyDateRule,
  collectOwners,
  computeDuration,
  computeEndDate,
  applyDependencies,
  detectCycle,
  eligibleLinkTargets,
  isLeafTask,
  linkConstraints,
  validateLinks,
  defaultCalendar,
  deriveTaskNo,
  emptyTask,
  estimatePercentComplete,
  findTaskCtx,
  formatDate,
  nextWorkingDayString,
  normalizeColumnOrder,
  normalizeOwner,
  normalizeTitleWidth,
  overallPercentComplete,
  parseOwners,
  planIndicator,
  rollupScheduleTasks,
  removeTaskLinks,
  stripInvalidLinks,
  statusLabel
} from '@shared/planner'
import type {
  NoteMeta,
  PlannerExportColumn,
  PlannerExportRow,
  Schedule,
  ScheduleStatus,
  ScheduleTask,
  ScheduleTitleWidth,
  TaskLink,
  TaskLinkType
} from '@shared/types'

type PlannerColumnKey =
  | 'indicator'
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
  | 'deps'

const COLUMNS: { key: PlannerColumnKey; label: string }[] = [
  { key: 'indicator', label: 'Plan Indicator' },
  { key: 'no', label: 'No.' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'owner', label: 'Owner' },
  { key: 'duration', label: 'Duration' },
  { key: 'planStart', label: 'Plan Start' },
  { key: 'planEnd', label: 'Plan End' },
  { key: 'actualStart', label: 'Actual Start' },
  { key: 'actualEnd', label: 'Actual End' },
  { key: 'deps', label: 'Dependencies' },
  { key: 'percent', label: '%' },
  { key: 'note', label: 'Note' }
]

const COL_WIDTHS: Record<PlannerColumnKey, string> = {
  indicator: '5px',
  no: '46px',
  title: 'minmax(180px, 1fr)',
  status: '110px',
  owner: '120px',
  duration: '84px',
  planStart: '125px',
  planEnd: '125px',
  actualStart: '125px',
  actualEnd: '125px',
  percent: '84px',
  note: 'minmax(160px, auto)',
  deps: '170px'
}

/** Pinned first, never movable (Plan Indicator stays hideable; No./Title always visible). */
const FIXED_COLUMNS: PlannerColumnKey[] = ['indicator', 'no', 'title']

const TITLE_WIDTH_GRID_MIN = 180
const TITLE_WIDTH_GRID_MAX = 600
const TITLE_WIDTH_GRID_DEFAULT = 300

const COL_WIDTH_MIN = 65
const COL_WIDTH_MAX = 600

type MovableColumnKey = Exclude<PlannerColumnKey, 'indicator' | 'no' | 'title'>

const MOVABLE_HEADERS: Record<MovableColumnKey, { label: string; className: string }> = {
  status: { label: 'Status', className: 'planner-col-status' },
  owner: { label: 'Owner', className: 'planner-col-owner' },
  duration: { label: 'Dur.', className: 'planner-col-num' },
  planStart: { label: 'Plan Start', className: 'planner-col-date' },
  planEnd: { label: 'Plan End', className: 'planner-col-date' },
  actualStart: { label: 'Actual Start', className: 'planner-col-date' },
  actualEnd: { label: 'Actual End', className: 'planner-col-date' },
  percent: { label: '%', className: 'planner-col-num' },
  note: { label: 'Note', className: 'planner-col-note' },
  deps: { label: 'Deps', className: 'planner-col-deps' }
}

function colWidth(
  key: PlannerColumnKey,
  titleWidth: number | null,
  widths: Partial<Record<PlannerColumnKey, number>>
): string {
  if (key === 'title') return `${titleWidth ?? TITLE_WIDTH_GRID_DEFAULT}px`
  const w = widths[key]
  return w !== undefined ? `${w}px` : COL_WIDTHS[key]
}

function colTemplate(
  visible: Set<PlannerColumnKey>,
  order: PlannerColumnKey[],
  titleWidth: number | null,
  widths: Partial<Record<PlannerColumnKey, number>>
): string {
  const cols: string[] = ['28px']
  for (const k of order) {
    if (k === 'no' || k === 'title' || visible.has(k)) {
      cols.push(colWidth(k, titleWidth, widths))
    }
  }
  return cols.join(' ')
}

function colTemplateSplit(
  visible: Set<PlannerColumnKey>,
  order: PlannerColumnKey[],
  titleWidth: number | null,
  widths: Partial<Record<PlannerColumnKey, number>>
): { left: string; right: string; leftCount: number } {
  const left: string[] = ['28px']
  const right: string[] = []
  for (const k of order) {
    if (!(k === 'no' || k === 'title' || visible.has(k))) continue
    if (k === 'indicator' || k === 'no' || k === 'title') {
      left.push(colWidth(k, titleWidth, widths))
    } else {
      right.push(colWidth(k, titleWidth, widths))
    }
  }
  return { left: left.join(' '), right: right.join(' '), leftCount: left.length }
}

function initColumnOrder(saved: string[] | undefined): PlannerColumnKey[] {
  return normalizeColumnOrder(
    saved,
    COLUMNS.map((c) => c.key),
    FIXED_COLUMNS
  ) as PlannerColumnKey[]
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

function initColumnWidths(
  saved: Record<string, number> | undefined
): Partial<Record<PlannerColumnKey, number>> {
  const out: Partial<Record<PlannerColumnKey, number>> = {}
  if (!saved) return out
  for (const c of COLUMNS) {
    if (FIXED_COLUMNS.includes(c.key)) continue
    const w = normalizeTitleWidth(saved[c.key], COL_WIDTH_MIN, COL_WIDTH_MAX)
    if (w !== null) out[c.key] = w
  }
  return out
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

function insertTasksBefore(
  tasks: ScheduleTask[],
  id: string,
  newTasks: ScheduleTask[]
): ScheduleTask[] {
  const out: ScheduleTask[] = []
  for (const t of tasks) {
    if (t.id === id) {
      out.push(...newTasks, t)
    } else {
      out.push(t)
      if (t.children.length > 0) {
        out[out.length - 1] = { ...t, children: insertTasksBefore(t.children, id, newTasks) }
      }
    }
  }
  return out
}

function removeTasks(tasks: ScheduleTask[], ids: Set<string>): ScheduleTask[] {
  const filtered = tasks
    .filter((t) => !ids.has(t.id))
    .map((t) => (t.children.length > 0 ? { ...t, children: removeTasks(t.children, ids) } : t))
  let result = filtered
  for (const id of ids) result = removeTaskLinks(result, id)
  return result
}

function countDeletable(tasks: ScheduleTask[]): number {
  const ids = new Set<string>()
  const add = (t: ScheduleTask): void => {
    ids.add(t.id)
    t.children.forEach(add)
  }
  tasks.forEach(add)
  return ids.size
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
  disabled,
  cellId,
  col,
  title
}: {
  value: string | null
  onChange: (v: string | null) => void
  readOnly?: boolean
  disabled?: boolean
  cellId?: string
  col?: string
  title?: string
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
      title={title}
      data-cell={cellId}
      data-col={col}
      onChange={(e) => onChange(e.target.value || null)}
      onBlur={() => {
        if (!value && ref.current) ref.current.value = ''
      }}
    />
  )
}

const LINK_TYPE_OPTIONS: TaskLinkType[] = ['FS', 'SS', 'FF', 'SF']

/** Preloaded 1x1 transparent GIF drag image: setDragImage shows the platform globe
 *  fallback when the passed image is not already loaded at dragstart. */
const DEP_DRAG_BLANK = new Image(1, 1)
DEP_DRAG_BLANK.src =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function lagLabel(lag: number): string {
  return lag > 0 ? `+${lag}` : lag === 0 ? '' : String(lag)
}

function DepEditorMenu({
  schedule,
  task,
  noById,
  allTaskMap,
  onApply,
  onClose
}: {
  schedule: ScheduleTask[]
  task: ScheduleTask
  noById: Map<string, string>
  allTaskMap: Map<string, ScheduleTask>
  onApply: (links: TaskLink[] | undefined) => void
  onClose: () => void
}): React.JSX.Element {
  const links = task.dependsOn ?? []
  const eligible = eligibleLinkTargets(schedule, task.id)
  const [addPred, setAddPred] = useState(eligible[0]?.id ?? '')
  const [addType, setAddType] = useState<TaskLinkType>('FS')
  const [addLag, setAddLag] = useState('0')
  const [addError, setAddError] = useState('')

  const validate = (nextLinks: TaskLink[] | undefined): string | null => {
    try {
      const updated: ScheduleTask = { ...task }
      if (nextLinks?.length) updated.dependsOn = nextLinks
      else delete updated.dependsOn
      const patched = updateTask(schedule, task.id, () => updated)
      const issues = validateLinks(patched)
      if (issues.length > 0) return issues[0].message
      const cycle = detectCycle(patched)
      if (cycle) return 'Dependency cycle detected'
      return null
    } catch (err) {
      return (err as Error).message
    }
  }

  const commit = (nextLinks: TaskLink[] | undefined): boolean => {
    const problem = validate(nextLinks)
    if (problem) {
      setAddError(problem)
      return false
    }
    onApply(nextLinks)
    setAddError('')
    return true
  }

  const addLink = (): void => {
    if (!addPred) return
    const lag = Number.parseInt(addLag, 10)
    const next = [...links, { id: addPred, type: addType, lag: Number.isFinite(lag) ? lag : 0 }]
    if (next.some((l, i) => next.findIndex((x) => x.id === l.id && x.type === l.type) !== i)) {
      setAddError('That link already exists')
      return
    }
    if (commit(next)) onClose()
  }

  return (
    <div className="planner-dep-menu-inner">
      <div className="planner-dep-header">
        <div className="planner-dep-title">Dependencies</div>
        <button type="button" className="icon-btn small" title="Close" onClick={() => onClose()}>
          <MdiIcon path={mdiClose} size={14} />
        </button>
      </div>
      <div className="planner-dep-subtitle" title={`${noById.get(task.id) ?? ''} ${task.title}`}>
        {noById.get(task.id)} {task.title || 'Task'}
      </div>
      <div className="planner-dep-sep" />
      {links.length === 0 ? (
        <div className="planner-owner-empty">No dependencies</div>
      ) : (
        <div className="planner-dep-list">
          {links.map((l, i) => (
            <div key={`${l.id}|${l.type}|${i}`} className="planner-dep-row">
              <span
                className="planner-dep-no"
                title={`${noById.get(l.id) ?? ''} ${allTaskMap.get(l.id)?.title || ''}`}
              >
                {noById.get(l.id) ?? '?'} {allTaskMap.get(l.id)?.title || ''}
              </span>
              <select
                value={l.type}
                className="planner-dep-select"
                onChange={(e) => {
                  const nextLinks = links.map((x, j) =>
                    j === i ? { ...x, type: e.target.value as TaskLinkType } : x
                  )
                  commit(nextLinks)
                }}
              >
                {LINK_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                type="number"
                className="planner-dep-input"
                value={l.lag}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value, 10)
                  if (!Number.isFinite(v)) return
                  commit(links.map((x, j) => (j === i ? { ...x, lag: v } : x)))
                }}
              />
              <button
                type="button"
                className="btn planner-dep-delete"
                title="Remove link"
                onClick={() => commit(links.filter((_, j) => j !== i))}
              >
                <MdiIcon path={mdiClose} size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="planner-dep-sep" />
      {eligible.length > 0 ? (
        <div className="planner-dep-add-row">
          <select
            value={addPred}
            className="planner-dep-select planner-dep-add-task"
            onChange={(e) => setAddPred(e.target.value)}
          >
            {eligible.map((t) => (
              <option key={t.id} value={t.id}>
                {noById.get(t.id)} {t.title || 'Task'}
              </option>
            ))}
          </select>
          <select
            value={addType}
            className="planner-dep-select"
            onChange={(e) => setAddType(e.target.value as TaskLinkType)}
          >
            {LINK_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="number"
            className="planner-dep-input"
            value={addLag}
            title="Lag (working days)"
            onChange={(e) => setAddLag(e.target.value)}
          />
          <button type="button" className="btn" title="Add dependency" onClick={addLink}>
            Add
          </button>
        </div>
      ) : (
        <div className="planner-owner-empty">No eligible predecessor tasks</div>
      )}
      {addError ? <div className="planner-dep-error">{addError}</div> : null}
    </div>
  )
}

export function PlannerEditor(): React.JSX.Element {
  const schedule = useAppStore((s) => s.scheduleContent)
  const calendar = useAppStore((s) => s.calendar)
  const updateScheduleContent = useAppStore((s) => s.updateScheduleContent)
  const saveSchedule = useAppStore((s) => s.saveSchedule)
  const renameSchedule = useAppStore((s) => s.renameSchedule)
  const setSnapshotsOpen = useAppStore((s) => s.setSnapshotsOpen)
  const plannerUndo = useAppStore((s) => s.plannerUndo)
  const plannerRedo = useAppStore((s) => s.plannerRedo)
  const notes = useAppStore((s) => s.notes)
  const kanban = useAppStore((s) => s.kanban)
  const selectNote = useAppStore((s) => s.selectNote)
  const setTab = useAppStore((s) => s.setTab)
  const setActiveKanbanCard = useAppStore((s) => s.setActiveKanbanCard)

  const [calendarOpen, setCalendarOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [estimateOpen, setEstimateOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [view, setView] = useState<'table' | 'gantt'>('table')
  const [ganttDayWidth, setGanttDayWidth] = useState(GANTT_DAY_WIDTH_DEFAULT)
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ tasks: ScheduleTask[] } | null>(null)
  const [statusMenu, setStatusMenu] = useState<{
    id: string
    x: number
    y: number
    mode: ScheduleStatus
  } | null>(null)
  const [gridMenu, setGridMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [gridPercent, setGridPercent] = useState(0)
  const [percentMenu, setPercentMenu] = useState<{ id: string; input: HTMLInputElement } | null>(
    null
  )
  const [ownerMenu, setOwnerMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [depEditor, setDepEditor] = useState<{ id: string; x: number; y: number } | null>(null)
  const [depViolations, setDepViolations] = useState<Record<string, string>>({})
  const [depDragSource, setDepDragSource] = useState<string | null>(null)
  const [depDragOver, setDepDragOver] = useState<string | null>(null)
  const [depDragFrom, setDepDragFrom] = useState<{ x: number; y: number } | null>(null)
  const [depDragCursor, setDepDragCursor] = useState<{ x: number; y: number } | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [titleEditId, setTitleEditId] = useState<string | null>(null)
  const [noteEditId, setNoteEditId] = useState<string | null>(null)
  const [noteMention, setNoteMention] = useState<{
    id: string
    kind: 'note' | 'kanban'
    start: number
    query: string
    x: number
    y: number
  } | null>(null)
  const [noteMentionIndex, setNoteMentionIndex] = useState(0)
  const [titleTip, setTitleTip] = useState<NameTipState | null>(null)
  const [visibleCols, setVisibleCols] = useState<Set<PlannerColumnKey>>(() =>
    initVisibleCols(schedule?.columnVisibility)
  )
  const [columnOrder, setColumnOrder] = useState<PlannerColumnKey[]>(() =>
    initColumnOrder(schedule?.columnOrder)
  )
  const [titleWidthGrid, setTitleWidthGrid] = useState<number | null>(() =>
    normalizeTitleWidth(schedule?.titleWidth?.grid, TITLE_WIDTH_GRID_MIN, TITLE_WIDTH_GRID_MAX)
  )
  const [columnWidths, setColumnWidths] = useState<Partial<Record<PlannerColumnKey, number>>>(() =>
    initColumnWidths(schedule?.columnWidth)
  )
  const [titleWidthGantt, setTitleWidthGantt] = useState<number>(
    () =>
      normalizeTitleWidth(
        schedule?.titleWidth?.gantt,
        GANTT_TITLE_WIDTH_MIN,
        GANTT_TITLE_WIDTH_MAX
      ) ?? GANTT_TITLE_WIDTH_DEFAULT
  )
  const [prevScheduleId, setPrevScheduleId] = useState(schedule?.id)
  if (schedule?.id !== prevScheduleId) {
    setPrevScheduleId(schedule?.id)
    setVisibleCols(initVisibleCols(schedule?.columnVisibility))
    setColumnOrder(initColumnOrder(schedule?.columnOrder))
    setColumnWidths(initColumnWidths(schedule?.columnWidth))
    setTitleWidthGrid(
      normalizeTitleWidth(schedule?.titleWidth?.grid, TITLE_WIDTH_GRID_MIN, TITLE_WIDTH_GRID_MAX)
    )
    setTitleWidthGantt(
      normalizeTitleWidth(
        schedule?.titleWidth?.gantt,
        GANTT_TITLE_WIDTH_MIN,
        GANTT_TITLE_WIDTH_MAX
      ) ?? GANTT_TITLE_WIDTH_DEFAULT
    )
    setView('table')
    setOwnerMenu(null)
    setPercentMenu(null)
    setNoteEditId(null)
    setNoteMention(null)
  }
  const [clipboard, setClipboard] = useState<ScheduleTask[]>([])
  const [clipboardMode, setClipboardMode] = useState<'copy' | 'cut' | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const ganttBodyRef = useRef<HTMLDivElement>(null)
  const pendingScrollTop = useRef<number | null>(null)
  const statusMenuRef = useRef<HTMLDivElement>(null)
  const gridMenuRef = useRef<HTMLDivElement>(null)
  const ownerMenuRef = useRef<HTMLDivElement>(null)
  const percentMenuRef = useRef<HTMLDivElement>(null)
  const depEditorRef = useRef<HTMLDivElement>(null)
  const noteInputRef = useRef<HTMLInputElement>(null)
  const gridPercentBase = useRef<Schedule | null>(null)
  const pendingFocus = useRef<{ id: string; col: string } | null>(null)
  const saveTimer = useRef<number | null>(null)
  const editSession = useRef<{ scheduleId: string; snapshot: Schedule } | null>(null)
  const plannerRef = useRef<HTMLDivElement | null>(null)
  const titlebarRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const statusbarRef = useRef<HTMLDivElement | null>(null)
  const hScrollBarRef = useRef<HTMLDivElement | null>(null)
  const hScrollThumbRef = useRef<HTMLDivElement | null>(null)
  const focusValueRef = useRef<{
    id: string
    col: string
    value: string | number | null
    undoLen: number
  } | null>(null)

  useEffect(() => {
    const root = plannerRef.current
    const tb = titlebarRef.current
    const bar = toolbarRef.current
    const sb = statusbarRef.current
    if (!root || !tb || !bar || !sb) return
    const apply = (): void => {
      root.style.setProperty('--planner-titlebar-h', `${tb.offsetHeight}px`)
      root.style.setProperty('--planner-toolbar-h', `${bar.offsetHeight}px`)
      root.style.setProperty('--planner-header-h', `${tb.offsetHeight + bar.offsetHeight}px`)
      root.style.setProperty('--planner-statusbar-h', `${sb.offsetHeight}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(tb)
    ro.observe(bar)
    ro.observe(sb)
    return () => ro.disconnect()
  }, [schedule?.id])

  useEffect(() => {
    const target = view === 'gantt' ? ganttBodyRef.current : gridScrollRef.current
    const barEl = hScrollBarRef.current
    const thumbEl = hScrollThumbRef.current
    if (!target || !barEl || !thumbEl) return
    const update = (): void => {
      const overflow = target.scrollWidth - target.clientWidth
      barEl.style.display = overflow > 1 ? 'flex' : 'none'
      const ratio = target.scrollWidth > 0 ? target.clientWidth / target.scrollWidth : 1
      const pct = Math.min(100, Math.max(4, ratio * 100))
      const pos = Math.min(100 - pct, Math.max(0, (target.scrollLeft / target.scrollWidth) * 100))
      thumbEl.style.width = `${pct}%`
      thumbEl.style.left = `${pos}%`
    }
    update()
    target.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(target)
    if (target.firstElementChild) ro.observe(target.firstElementChild)
    return () => {
      ro.disconnect()
      target.removeEventListener('scroll', update)
    }
  }, [view, schedule?.id])

  function handleHScrollDown(e: React.PointerEvent<HTMLDivElement>): void {
    const target = view === 'gantt' ? ganttBodyRef.current : gridScrollRef.current
    const barEl = hScrollBarRef.current
    const thumbEl = hScrollThumbRef.current
    if (!target || !barEl || !thumbEl || target.scrollWidth <= target.clientWidth) return
    e.preventDefault()
    const rect = barEl.getBoundingClientRect()
    const thumbW = Math.max(30, target.clientWidth * (rect.width / target.scrollWidth))
    const thumbLeft = ((parseFloat(thumbEl.style.left) || 0) / 100) * rect.width
    const offsetInThumb = Math.min(Math.max(0, e.clientX - rect.left - thumbLeft), thumbW)
    const onMove = (ev: PointerEvent): void => {
      const x = Math.min(Math.max(0, ev.clientX - rect.left - offsetInThumb), rect.width - thumbW)
      target.scrollLeft = x / (rect.width / target.scrollWidth)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.removeProperty('cursor')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.style.setProperty('cursor', 'grabbing')
  }

  function recordHistory(base: Schedule): void {
    const snapshot = JSON.parse(JSON.stringify(base)) as Schedule
    useAppStore.getState().plannerPushUndo(base.id, snapshot)
    useAppStore.getState().plannerClearRedo(base.id)
  }

  function scheduleKey(s: Schedule): string {
    return JSON.stringify({ name: s.name, tasks: s.tasks, columnVisibility: s.columnVisibility })
  }

  function startEditSession(): void {
    if (editSession.current) return
    const current = useAppStore.getState().scheduleContent
    if (!current) return
    editSession.current = {
      scheduleId: current.id,
      snapshot: JSON.parse(JSON.stringify(current)) as Schedule
    }
  }

  function endEditSession(): void {
    const session = editSession.current
    if (!session) return
    editSession.current = null
    const current = useAppStore.getState().scheduleContent
    if (current && scheduleKey(current) !== scheduleKey(session.snapshot)) {
      useAppStore.getState().plannerPushUndo(session.scheduleId, session.snapshot)
      useAppStore.getState().plannerClearRedo(session.scheduleId)
    }
  }

  function restoreSchedule(restored: Schedule | null): void {
    if (!restored) return
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    setNumberDrafts({})
    setSelected(new Set())
    setAnchorId(null)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void saveSchedule(restored)
    }, 800)
  }

  function isTrackedField(el: HTMLElement | null): boolean {
    if (!el || el.tagName !== 'INPUT') return false
    const col = el.dataset.col
    return (
      col === 'title' ||
      col === 'owner' ||
      col === 'duration' ||
      col === 'percent' ||
      col === 'note'
    )
  }

  function prepareUndoRedo(): void {
    const session = editSession.current
    if (!session) return
    const current = useAppStore.getState().scheduleContent
    if (current && scheduleKey(current) !== scheduleKey(session.snapshot)) {
      useAppStore.getState().plannerPushUndo(session.scheduleId, session.snapshot)
      useAppStore.getState().plannerClearRedo(session.scheduleId)
    }
  }

  function rearmEditSession(): void {
    const el = document.activeElement as HTMLElement | null
    if (isTrackedField(el)) {
      const current = useAppStore.getState().scheduleContent
      if (current) {
        editSession.current = {
          scheduleId: current.id,
          snapshot: JSON.parse(JSON.stringify(current)) as Schedule
        }
        return
      }
    }
    editSession.current = null
  }

  function handleGridFocusCapture(e: React.FocusEvent): void {
    const el = e.target as HTMLElement
    if (el.tagName !== 'INPUT') return
    const id = el.dataset.cell
    const col = el.dataset.col
    if (!id || !col) return
    const current = useAppStore.getState().scheduleContent
    if (!current) return
    const ctx = findTaskCtx(current.tasks, id)
    if (!ctx) return
    const value = ctx.parent[ctx.index][col as keyof ScheduleTask]
    const undo = useAppStore.getState().plannerUndo[current.id] ?? []
    focusValueRef.current = {
      id,
      col,
      value: (value ?? null) as string | number | null,
      undoLen: undo.length
    }
  }

  function cancelEdit(): void {
    const active = document.activeElement
    const el = active instanceof HTMLElement ? active : null
    if (!el || el.tagName !== 'INPUT') return
    const session = editSession.current
    if (session) {
      editSession.current = null
      if (saveTimer.current !== null) clearTimeout(saveTimer.current)
      setNumberDrafts({})
      const restored = session.snapshot
      updateScheduleContent(restored)
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null
        void saveSchedule(restored)
      }, 800)
    } else {
      const f = focusValueRef.current
      if (f) {
        const current = useAppStore.getState().scheduleContent
        if (current) {
          const tasks = updateTask(current.tasks, f.id, (prev) => {
            const next = { ...prev, [f.col]: f.value } as ScheduleTask
            if (f.col === 'planStart' || f.col === 'planEnd') {
              return applyDateRule(prev, next, cal)
            }
            return next
          })
          commit(current, tasks, undefined, false)
          useAppStore.getState().plannerTruncateUndo(current.id, f.undoLen)
        }
      }
    }
    el.blur()
  }

  function handleUndo(): void {
    prepareUndoRedo()
    restoreSchedule(useAppStore.getState().undoPlanner())
    rearmEditSession()
  }

  function handleRedo(): void {
    prepareUndoRedo()
    restoreSchedule(useAppStore.getState().redoPlanner())
    rearmEditSession()
  }

  function switchView(next: 'table' | 'gantt'): void {
    if (next === view) return
    setOwnerMenu(null)
    setPercentMenu(null)
    setNoteEditId(null)
    setNoteMention(null)
    endEditSession()
    const current = useAppStore.getState().scheduleContent
    if (current) useAppStore.getState().plannerClearHistory(current.id)
    const outgoing = view === 'table' ? gridScrollRef.current : ganttBodyRef.current
    pendingScrollTop.current = outgoing ? outgoing.scrollTop : 0
    setView(next)
  }

  useEffect(() => {
    if (pendingScrollTop.current === null) return
    const target = view === 'table' ? gridScrollRef.current : ganttBodyRef.current
    if (target) target.scrollTop = pendingScrollTop.current
    pendingScrollTop.current = null
  }, [view])

  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current)
        const latest = useAppStore.getState().scheduleContent
        if (latest) void useAppStore.getState().saveSchedule(latest)
      }
    }
  }, [])

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    const el = gridRef.current?.querySelector<HTMLElement>(
      `[data-cell="${target.id}"][data-col="${target.col}"]`
    )
    if (el) {
      pendingFocus.current = null
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'nearest' })
    }
  })

  const noteMentionOpen = noteMention !== null
  useEffect(() => {
    if (!noteMentionOpen) return
    const close = (): void => setNoteMention(null)
    const scrollEl = gridScrollRef.current
    scrollEl?.addEventListener('scroll', close, { passive: true })
    window.addEventListener('resize', close)
    return () => {
      scrollEl?.removeEventListener('scroll', close)
      window.removeEventListener('resize', close)
    }
  }, [noteMentionOpen])

  useEffect(() => {
    if (!statusMenu) return
    const items = statusMenuRef.current?.querySelectorAll<HTMLButtonElement>('.note-menu-item')
    const activeIdx = statusMenu.mode === 'pending' ? 1 : statusMenu.mode === 'on-hold' ? 2 : 0
    items?.[activeIdx]?.focus()
  }, [statusMenu])

  useEffect(() => {
    if (!gridMenu) return
    const onDocMouseDown = (e: MouseEvent): void => {
      const el = e.target as HTMLElement
      if (el.closest('.planner-grid-menu')) return
      setGridMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setGridMenu(null)
    }
    const onScroll = (): void => setGridMenu(null)
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    const scrollEl = gridScrollRef.current
    scrollEl?.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
      scrollEl?.removeEventListener('scroll', onScroll, true)
    }
  }, [gridMenu])

  useLayoutEffect(() => {
    if (!gridMenu) return
    const el = gridMenuRef.current
    if (!el) return
    const margin = 8
    const width = el.offsetWidth
    const height = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.max(margin, Math.min(gridMenu.x, vw - width - margin))
    const top = Math.max(margin, Math.min(gridMenu.y, vh - height - margin))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [gridMenu])

  useLayoutEffect(() => {
    if (!ownerMenu) return
    const el = ownerMenuRef.current
    if (!el) return
    const margin = 8
    const width = el.offsetWidth
    const height = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.max(margin, Math.min(ownerMenu.x, vw - width - margin))
    const top = Math.max(margin, Math.min(ownerMenu.y, vh - height - margin))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [ownerMenu])

  useEffect(() => {
    if (!ownerMenu) return
    const onScroll = (): void => setOwnerMenu(null)
    const scrollEl = gridScrollRef.current
    scrollEl?.addEventListener('scroll', onScroll, true)
    return () => scrollEl?.removeEventListener('scroll', onScroll, true)
  }, [ownerMenu])

  useLayoutEffect(() => {
    if (!percentMenu) return
    const menu = percentMenuRef.current
    if (!menu) return
    const position = (): void => {
      const rect = percentMenu.input.getBoundingClientRect()
      const margin = 8
      menu.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - menu.offsetWidth - margin))}px`
      const top =
        rect.bottom + 2 + menu.offsetHeight <= window.innerHeight - margin
          ? rect.bottom + 2
          : rect.top - menu.offsetHeight - 2
      menu.style.top = `${Math.max(margin, top)}px`
    }
    const dismiss = (e: PointerEvent): void => {
      const target = e.target as Node
      if (target === percentMenu.input || menu.contains(target)) return
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        (active === percentMenu.input || menu.contains(active))
      ) {
        active.blur()
      }
      setPercentMenu(null)
    }
    position()
    window.addEventListener('resize', position)
    document.addEventListener('scroll', position, true)
    document.addEventListener('pointerdown', dismiss)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPercentMenu(null)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', position)
      document.removeEventListener('scroll', position, true)
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', onKey)
    }
  }, [percentMenu])

  useEffect(() => {
    if (!depEditor) return
    const el = depEditorRef.current
    if (!el) return
    const margin = 8
    const width = el.offsetWidth
    const height = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.max(margin, Math.min(depEditor.x, vw - width - margin))
    const top = Math.max(margin, Math.min(depEditor.y, vh - height - margin))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [depEditor])

  useEffect(() => {
    if (!depEditor) return
    const onScroll = (): void => setDepEditor(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDepEditor(null)
    }
    const scrollEl = gridScrollRef.current
    scrollEl?.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKey)
    return () => {
      scrollEl?.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [depEditor])

  useEffect(() => {
    if (!depDragSource) return
    const move = (e: DragEvent): void => {
      setDepDragCursor({ x: e.clientX, y: e.clientY })
    }
    document.addEventListener('dragover', move)
    return () => document.removeEventListener('dragover', move)
  }, [depDragSource])

  useEffect(() => {
    const update = (): void => {
      const el = document.activeElement as HTMLElement | null
      const inPlanner = !!el?.closest('.planner-editor')
      const plannerTab = useAppStore.getState().tab === 'planner'
      window.ptnotes.planner.setEditActive(
        inPlanner || (plannerTab && (!el || el === document.body))
      )
    }
    window.addEventListener('focusin', update)
    window.addEventListener('focusout', update)
    update()
    return () => {
      window.removeEventListener('focusin', update)
      window.removeEventListener('focusout', update)
      window.ptnotes.planner.setEditActive(false)
    }
  })

  useEffect(() => {
    return window.ptnotes.planner.onUndoRedo(({ redo }) => {
      if (redo) handleRedo()
      else handleUndo()
    })
  })

  if (!schedule) return <></>
  const sc: Schedule = schedule
  const allTaskMap: Map<string, ScheduleTask> = (() => {
    const map = new Map<string, ScheduleTask>()
    const walk = (list: ScheduleTask[]): void => {
      for (const t of list) {
        map.set(t.id, t)
        walk(t.children)
      }
    }
    walk(sc.tasks)
    return map
  })()

  const noById: Map<string, string> = (() => {
    const map = new Map<string, string>()
    const walk = (list: ScheduleTask[], parentNo: string | null): void => {
      list.forEach((t, i) => {
        const no = deriveTaskNo(parentNo, i)
        map.set(t.id, no)
        walk(t.children, no)
      })
    }
    walk(sc.tasks, null)
    return map
  })()

  function depConstraints(task: ScheduleTask): { startLocked: boolean; endLocked: boolean } {
    return isLeafTask(task) ? linkConstraints(task) : { startLocked: false, endLocked: false }
  }
  function depStartLocked(task: ScheduleTask): boolean {
    return depConstraints(task).startLocked
  }
  function depEndLocked(task: ScheduleTask): boolean {
    return depConstraints(task).endLocked
  }
  function depBothLocked(task: ScheduleTask): boolean {
    const c = depConstraints(task)
    return c.startLocked && c.endLocked
  }

  function depLockedTitle(task: ScheduleTask, edge: 'start' | 'end'): string | undefined {
    const pred = (task.dependsOn ?? []).find((l) =>
      edge === 'start' ? l.type === 'FS' || l.type === 'SS' : l.type === 'FF' || l.type === 'SF'
    )
    if (!pred) return undefined
    const predTitle = allTaskMap.get(pred.id)?.title || 'task'
    return `${edge === 'start' ? 'Start' : 'End'} set by ${predTitle} (${pred.type})`
  }

  const ganttLinkLocks: Map<string, GanttLinkLock> = (() => {
    const map = new Map<string, GanttLinkLock>()
    const walk = (list: ScheduleTask[]): void => {
      for (const t of list) {
        if (t.children.length === 0 && t.dependsOn?.length) {
          const c = linkConstraints(t)
          if (c.startLocked || c.endLocked) {
            const lock: GanttLinkLock = {}
            if (c.startLocked) lock.start = depLockedTitle(t, 'start')
            if (c.endLocked) lock.end = depLockedTitle(t, 'end')
            lock.move = 'Move disabled — dates are set by dependency links'
            map.set(t.id, lock)
          }
        }
        walk(t.children)
      }
    }
    walk(sc.tasks)
    return map
  })()

  function applyLinks(id: string, links: TaskLink[] | undefined): void {
    editTask(sc, id, (prev) => {
      if (links?.length) return { ...prev, dependsOn: links }
      const { dependsOn: _drop, ...rest } = prev
      return rest as ScheduleTask
    })
  }

  /** Drop of a Deps chip onto this row: the DRAGGED task gains the drop target as FS predecessor. */
  function addLinkFromDrag(sourceId: string, targetId: string): void {
    const ctx = findTaskCtx(sc.tasks, sourceId)
    if (!ctx) return
    const source = ctx.parent[ctx.index]
    if (!isLeafTask(source) || sourceId === targetId) return
    const links = source.dependsOn ?? []
    if (links.some((l) => l.id === targetId && l.type === 'FS')) return
    const next = [...links, { id: targetId, type: 'FS' as const, lag: 0 }]
    const patched = updateTask(sc.tasks, sourceId, (t) => ({ ...t, dependsOn: next }))
    if (validateLinks(patched).length > 0 || detectCycle(patched)) return
    applyLinks(sourceId, next)
  }
  const cal = calendar ?? defaultCalendar()
  const rows = flattenTasks(sc.tasks, null, 0, collapsed, [])
  const template = colTemplate(visibleCols, columnOrder, titleWidthGrid, columnWidths)
  const colSplit = colTemplateSplit(visibleCols, columnOrder, titleWidthGrid, columnWidths)
  const today = formatDate(new Date())
  const noLeft = 28 + (visibleCols.has('indicator') ? 5 : 0)
  const titleLeft = noLeft + 46
  const movableCols = columnOrder.filter(
    (k) => !FIXED_COLUMNS.includes(k) && visibleCols.has(k)
  ) as MovableColumnKey[]
  const noteQuery = noteMention?.query.toLowerCase() ?? ''
  const noteMentionItems: (NoteMeta | KanbanCard)[] = !noteMention
    ? []
    : noteMention.kind === 'kanban'
      ? (kanban?.cards ?? []).filter((c) => c.title.toLowerCase().includes(noteQuery))
      : notes.filter((n) => n.name.toLowerCase().includes(noteQuery))
  const ownerCtx = ownerMenu ? findTaskCtx(sc.tasks, ownerMenu.id) : null
  const ownerTask = ownerCtx ? ownerCtx.parent[ownerCtx.index] : null
  const percentCtx = percentMenu ? findTaskCtx(sc.tasks, percentMenu.id) : null
  const percentTask = percentCtx ? percentCtx.parent[percentCtx.index] : null
  const ownerNames = ownerTask ? collectOwners(sc.tasks) : []
  const ownerChecked = new Set(
    ownerTask ? parseOwners(ownerTask.owner).map((n) => n.toLowerCase()) : []
  )

  function openNoteLink(noteName: string): Promise<void> {
    const note =
      notes.find((n) => n.id === noteName) ??
      notes.find((n) => n.name === noteName) ??
      notes.find((n) => n.name.includes(noteName))
    if (!note) return Promise.resolve()
    return selectNote(note.id).then(() => setTab('notes'))
  }

  function openKanbanLink(ref: string): void {
    if (!kanban) return
    const q = ref.trim().toLowerCase()
    const card =
      kanban.cards.find((c) => c.id.toLowerCase() === q) ??
      kanban.cards.find((c) => c.title.toLowerCase() === q) ??
      kanban.cards.find((c) => {
        const t = c.title.toLowerCase()
        return t.includes(q) || q.includes(t)
      })
    if (!card) return
    setTab('kanban')
    setActiveKanbanCard(card.id)
  }

  function updateNoteMention(taskId: string, value: string, sel: number): void {
    const before = value.slice(0, sel)
    const at = before.lastIndexOf('@')
    const bang = before.lastIndexOf('!')
    const last = Math.max(at, bang)
    const token = last === -1 ? null : before.slice(last + 1)
    const rect = noteInputRef.current?.getBoundingClientRect()
    if (token === null || token.includes(' ') || !rect) {
      setNoteMention(null)
      return
    }
    setNoteMention({
      id: taskId,
      kind: last === at ? 'note' : 'kanban',
      start: last,
      query: token,
      x: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
      y: rect.bottom + 194 > window.innerHeight ? Math.max(8, rect.top - 194) : rect.bottom + 4
    })
    setNoteMentionIndex(0)
  }

  function insertNoteMention(item: NoteMeta | KanbanCard): void {
    if (!noteMention) return
    const ctx = findTaskCtx(sc.tasks, noteMention.id)
    if (!ctx) return
    const value = ctx.parent[ctx.index].note
    const before = value.slice(0, noteMention.start)
    const after = value.slice(noteMention.start + 1 + noteMention.query.length)
    const token =
      noteMention.kind === 'kanban'
        ? `kanban:${item.id} `
        : `note:${'name' in item ? item.name : ''} `
    editField(sc, noteMention.id, 'note', `${before}${token}${after}`)
    setNoteMention(null)
    requestAnimationFrame(() => {
      const el = noteInputRef.current
      if (el) {
        const pos = before.length + token.length
        el.focus()
        el.setSelectionRange(pos, pos)
      }
    })
  }

  function handleNoteInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (!noteMention) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setNoteMention(null)
      return
    }
    if (noteMentionItems.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setNoteMentionIndex((i) => (i + 1) % noteMentionItems.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setNoteMentionIndex((i) => (i - 1 + noteMentionItems.length) % noteMentionItems.length)
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      const item = noteMentionItems[noteMentionIndex] ?? noteMentionItems[0]
      if (item) insertNoteMention(item)
    }
  }

  /** Does this `note:`/`kanban:` reference resolve to a real note or card? */
  function noteRefResolves(kind: 'note' | 'kanban', ref: string): boolean {
    if (!ref) return false
    const q = ref.toLowerCase()
    return kind === 'note'
      ? notes.some((n) => n.id === ref || n.name.toLowerCase().includes(q))
      : (kanban?.cards ?? []).some(
          (c) => c.id.toLowerCase() === q || c.title.toLowerCase().includes(q)
        )
  }

  /** Longest word-run of `rest` that resolves (multi-word names win); trailing punctuation is trimmed. */
  function longestNoteRef(kind: 'note' | 'kanban', rest: string): string {
    const parts = rest.split(/(\s+)/)
    let candidate = ''
    let best = ''
    for (let i = 0; i < parts.length; i += 2) {
      const word = parts[i]
      if (!word) break
      candidate = i === 0 ? word : candidate + parts[i - 1] + word
      if (candidate.length > 80) break
      if (noteRefResolves(kind, candidate)) {
        best = candidate
        continue
      }
      const trimmed = candidate.replace(/[.,;:!?…)\]}>"']+$/, '')
      if (trimmed !== candidate && noteRefResolves(kind, trimmed)) best = trimmed
    }
    return best
  }

  /** Wrap resolvable `note:`/`kanban:` references in links; everything else stays plain text. */
  function renderNoteLinks(text: string): React.ReactNode {
    const display = resolveKanbanCardNames(text, kanban?.cards ?? [])
    const out: React.ReactNode[] = []
    const re = /(^|\s)(note|kanban):/g
    let scanFrom = 0
    let n = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(display)) !== null) {
      const kind = m[2] as 'note' | 'kanban'
      const prefixStart = m.index + m[1].length
      const valueStart = prefixStart + kind.length + 1
      const ref = longestNoteRef(kind, display.slice(valueStart))
      if (!ref) continue
      if (prefixStart > scanFrom) out.push(display.slice(scanFrom, prefixStart))
      const captured = display.slice(prefixStart, valueStart + ref.length)
      out.push(
        <a
          key={`ref-${n++}`}
          href="#"
          className="planner-note-link"
          title={ref}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (kind === 'note') void openNoteLink(ref)
            else openKanbanLink(ref)
          }}
        >
          <span className="chat-note-link-icon">
            <MdiIcon path={kind === 'note' ? NOTE_LINK_ICON : KANBAN_LINK_ICON} size={13} />
          </span>
          {captured}
        </a>
      )
      scanFrom = valueStart + ref.length
      re.lastIndex = scanFrom
    }
    if (scanFrom < display.length) out.push(display.slice(scanFrom))
    return out
  }

  function renderColumnCell(
    key: MovableColumnKey,
    task: ScheduleTask,
    isParent: boolean
  ): React.JSX.Element {
    switch (key) {
      case 'status':
        return (
          <div key={key} className="planner-col-status planner-cell">
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
              data-cell={task.id}
              data-col="status"
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
        )
      case 'owner':
        if (isParent) {
          return (
            <div key={key} className="planner-col-owner planner-cell">
              <input
                className={`planner-input${!task.owner ? ' planner-value-empty' : ''}`}
                data-cell={task.id}
                data-col="owner"
                value={task.owner}
                readOnly
                disabled
              />
            </div>
          )
        }
        return (
          <div key={key} className="planner-col-owner planner-cell">
            <input
              className={`planner-input${!task.owner ? ' planner-value-empty' : ''}`}
              data-cell={task.id}
              data-col="owner"
              value={task.owner}
              placeholder="Owner"
              onFocus={(e) => {
                startEditSession()
                const rect = e.currentTarget.getBoundingClientRect()
                setOwnerMenu({ id: task.id, x: rect.left, y: rect.bottom + 2 })
              }}
              onBlur={() => {
                applyOwnerEdit(task.id)
                setOwnerMenu(null)
                endEditSession()
              }}
              onChange={(e) => editField(sc, task.id, 'owner', e.target.value)}
            />
          </div>
        )
      case 'duration':
        return (
          <div key={key} className="planner-col-num planner-cell">
            <input
              type="number"
              min={1}
              className="planner-input planner-num"
              data-cell={task.id}
              data-col="duration"
              value={displayNumber(task, 'duration')}
              readOnly={isParent || depBothLocked(task)}
              disabled={isParent || depBothLocked(task)}
              title={
                isParent
                  ? undefined
                  : depLockedTitle(task, 'start') && depLockedTitle(task, 'end')
                    ? 'Duration is derived from dependency-linked dates'
                    : undefined
              }
              onFocus={startEditSession}
              onChange={(e) => {
                setNumberDrafts((d) => ({
                  ...d,
                  [numberDraftKey(task.id, 'duration')]: e.target.value
                }))
                commitNumber(sc, task.id, 'duration', e.target.value)
              }}
              onBlur={() => {
                normalizeNumber(
                  task.id,
                  'duration',
                  numberDrafts[numberDraftKey(task.id, 'duration')] ?? ''
                )
                endEditSession()
              }}
            />
          </div>
        )
      case 'planStart':
        return (
          <div key={key} className="planner-col-date planner-cell">
            <DateField
              value={task.planStart}
              readOnly={isParent || depStartLocked(task)}
              disabled={isParent || depStartLocked(task)}
              title={
                isParent ? undefined : (depViolations[task.id] ?? depLockedTitle(task, 'start'))
              }
              cellId={task.id}
              col="planStart"
              onChange={(v) => editField(sc, task.id, 'planStart', v)}
            />
          </div>
        )
      case 'planEnd':
        return (
          <div key={key} className="planner-col-date planner-cell">
            <DateField
              value={task.planEnd}
              readOnly={isParent || depEndLocked(task)}
              disabled={isParent || depEndLocked(task)}
              title={isParent ? undefined : (depViolations[task.id] ?? depLockedTitle(task, 'end'))}
              cellId={task.id}
              col="planEnd"
              onChange={(v) => editField(sc, task.id, 'planEnd', v)}
            />
          </div>
        )
      case 'deps': {
        if (isParent) return <div key={key} className="planner-col-deps planner-cell" />
        const links = task.dependsOn ?? []
        return (
          <div key={key} className="planner-col-deps planner-cell">
            <button
              type="button"
              draggable
              className={`planner-dep-chip${links.length ? '' : ' planner-dep-empty'}`}
              data-cell={task.id}
              data-col="deps"
              title={
                (links.length
                  ? links
                      .map(
                        (l) =>
                          `${noById.get(l.id) ?? '?'} ${l.type}${lagLabel(l.lag)} — ${
                            allTaskMap.get(l.id)?.title || ''
                          }`
                      )
                      .join('\n')
                  : 'Add dependencies') +
                '\nDrag onto another task to depend on it (this task chains after it, FS)'
              }
              onClick={(e) => {
                e.stopPropagation()
                setSelected(new Set([task.id]))
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setDepEditor({ id: task.id, x: rect.left, y: rect.bottom + 2 })
              }}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'link'
                e.dataTransfer.setData('text/plain', `PTNOTES_DEP_FS:${task.id}`)
                e.dataTransfer.setDragImage(DEP_DRAG_BLANK, 0, 0)
                setDepDragFrom({ x: e.clientX, y: e.clientY })
                setDepDragSource(task.id)
              }}
              onDragEnd={() => {
                setDepDragSource(null)
                setDepDragOver(null)
                setDepDragFrom(null)
                setDepDragCursor(null)
              }}
            >
              {links.length
                ? links
                    .map((l) => `${noById.get(l.id) ?? '?'} ${l.type}${lagLabel(l.lag)}`)
                    .join(', ')
                : '—'}
            </button>
          </div>
        )
      }
      case 'actualStart':
        return (
          <div key={key} className="planner-col-date planner-cell">
            <DateField
              value={task.actualStart}
              cellId={task.id}
              col="actualStart"
              onChange={(v) => editField(sc, task.id, 'actualStart', v)}
            />
          </div>
        )
      case 'actualEnd':
        return (
          <div key={key} className="planner-col-date planner-cell">
            <DateField
              value={task.actualEnd}
              cellId={task.id}
              col="actualEnd"
              onChange={(v) => editField(sc, task.id, 'actualEnd', v)}
            />
          </div>
        )
      case 'percent':
        return (
          <div key={key} className="planner-col-num planner-cell">
            <input
              type="number"
              min={0}
              max={100}
              className="planner-input planner-num"
              data-cell={task.id}
              data-col="percent"
              value={displayNumber(task, 'percentComplete')}
              readOnly={isParent}
              disabled={isParent}
              onFocus={(e) => {
                startEditSession()
                if (!isParent) {
                  setPercentMenu({ id: task.id, input: e.currentTarget })
                }
              }}
              onChange={(e) => {
                setNumberDrafts((d) => ({
                  ...d,
                  [numberDraftKey(task.id, 'percentComplete')]: e.target.value
                }))
                commitNumber(sc, task.id, 'percentComplete', e.target.value)
              }}
              onBlur={(e) => {
                normalizeNumber(
                  task.id,
                  'percentComplete',
                  numberDrafts[numberDraftKey(task.id, 'percentComplete')] ?? ''
                )
                const rt = e.relatedTarget
                if (rt instanceof Node && percentMenuRef.current?.contains(rt)) return
                endEditSession()
                setPercentMenu((m) => (m && m.id === task.id ? null : m))
              }}
            />
          </div>
        )
      case 'note':
        return (
          <div key={key} className="planner-col-note planner-cell">
            {noteEditId === task.id ? (
              <input
                ref={noteInputRef}
                className={`planner-input${!task.note ? ' planner-value-empty' : ''}`}
                data-cell={task.id}
                data-col="note"
                value={task.note}
                placeholder="Note"
                autoFocus
                onFocus={startEditSession}
                onBlur={() => {
                  endEditSession()
                  setNoteEditId(null)
                  setNoteMention(null)
                }}
                onChange={(e) => {
                  editField(sc, task.id, 'note', e.target.value)
                  updateNoteMention(
                    task.id,
                    e.target.value,
                    e.target.selectionStart ?? e.target.value.length
                  )
                }}
                onKeyDown={handleNoteInputKeyDown}
              />
            ) : (
              <div
                className="planner-input planner-note-display"
                onClick={() => setNoteEditId(task.id)}
              >
                {task.note ? (
                  renderNoteLinks(task.note)
                ) : (
                  <span className="planner-title-placeholder">Note</span>
                )}
              </div>
            )}
          </div>
        )
    }
  }

  function renderRow(task: ScheduleTask, no: string, depth: number): React.JSX.Element {
    const isParent = task.children.length > 0
    return (
      <div
        className={`planner-grid-row${selected.has(task.id) ? ' planner-row-selected' : ''}${
          depDragOver === task.id ? ' planner-row-drop-hint' : ''
        }`}
        data-row={task.id}
        style={{ gridTemplateColumns: template }}
        onClick={(e) => handleRowClick(e, task.id)}
        onContextMenu={(e) => handleRowContext(e, task.id)}
        onDragOver={(e) => {
          if (!depDragSource || depDragSource === task.id || task.children.length > 0) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'link'
          setDepDragOver(task.id)
        }}
        onDragLeave={(e) => {
          if (depDragOver === task.id && !e.currentTarget.contains(e.relatedTarget as Node)) {
            setDepDragOver(null)
          }
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const data = e.dataTransfer.getData('text/plain')
          const sourceId = data.replace('PTNOTES_DEP_FS:', '') || depDragSource
          if (sourceId) addLinkFromDrag(sourceId, task.id)
          setDepDragSource(null)
          setDepDragOver(null)
          setDepDragFrom(null)
          setDepDragCursor(null)
        }}
        onDragEnd={() => {
          setDepDragSource(null)
          setDepDragOver(null)
          setDepDragFrom(null)
          setDepDragCursor(null)
        }}
      >
        <div className="planner-col-toggle planner-cell">
          {isParent ? (
            <button
              className="icon-btn small planner-toggle"
              title={collapsed.has(task.id) ? 'Expand' : 'Collapse'}
              onClick={() => toggleCollapse(task.id)}
            >
              <MdiIcon path={collapsed.has(task.id) ? mdiChevronRight : mdiChevronDown} size={16} />
            </button>
          ) : (
            <span className="planner-toggle-spacer" />
          )}
        </div>
        {visibleCols.has('indicator') && (
          <div
            className={`planner-col-indicator planner-cell planner-indicator-${planIndicator(
              task,
              today
            )}`}
          />
        )}
        <div className="planner-col-no planner-cell" style={{ left: noLeft }}>
          {no}
        </div>
        <div className="planner-col-title planner-cell" style={{ left: titleLeft }}>
          {titleEditId === task.id ? (
            <input
              className="planner-input"
              data-cell={task.id}
              data-col="title"
              style={{
                paddingLeft: depth * 14,
                fontWeight: isParent ? 600 : undefined
              }}
              value={task.title}
              placeholder={isParent ? 'Group task' : 'Task title'}
              autoFocus
              onFocus={startEditSession}
              onBlur={() => {
                endEditSession()
                setTitleEditId(null)
              }}
              onChange={(e) => editField(sc, task.id, 'title', e.target.value)}
            />
          ) : (
            <div
              className="planner-input planner-title-display"
              style={{
                paddingLeft: depth * 14,
                fontWeight: isParent ? 600 : undefined
              }}
              onMouseEnter={(e) =>
                setTitleTip(
                  nameTipFrom(
                    e,
                    task.title || (isParent ? 'Group task' : 'Task title'),
                    `planner-name-tip${isParent ? ' gantt-name-tip-parent' : ''}`,
                    depth * 14 + 1,
                    4
                  )
                )
              }
              onMouseLeave={() => setTitleTip(null)}
              onClick={() => setTitleEditId(task.id)}
            >
              {task.title || (
                <span className="planner-title-placeholder">
                  {isParent ? 'Group task' : 'Task title'}
                </span>
              )}
            </div>
          )}
        </div>
        {movableCols.map((key) => renderColumnCell(key, task, isParent))}
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

  function commit(
    base: Schedule,
    tasks: ScheduleTask[],
    override?: Partial<Schedule>,
    record = true
  ): void {
    if (record && !editSession.current) recordHistory(base)
    const dep = applyDependencies(stripInvalidLinks(tasks).tasks, cal)
    setDepViolations(Object.fromEntries(dep.violations.map((v) => [v.taskId, v.message])))
    const nextSchedule = {
      ...base,
      ...override,
      tasks: rollupScheduleTasks(dep.tasks, cal)
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
        const constr = isLeafTask(prev) ? linkConstraints(prev) : undefined
        return applyDateRule(prev, next, cal, constr)
      }
      return next
    })
  }

  function persistTitleWidth(patch: { grid?: number | null; gantt?: number }): void {
    const current = useAppStore.getState().scheduleContent
    if (!current) return
    const next: ScheduleTitleWidth = {}
    const grid =
      'grid' in patch ? (patch.grid === null ? undefined : patch.grid) : current.titleWidth?.grid
    const gantt = 'gantt' in patch ? patch.gantt : current.titleWidth?.gantt
    if (grid !== undefined) next.grid = grid
    if (gantt !== undefined) next.gantt = gantt
    commit(
      current,
      current.tasks,
      { titleWidth: Object.keys(next).length > 0 ? next : undefined },
      false
    )
  }

  function persistColumnWidth(key: PlannerColumnKey, width: number | null): void {
    const current = useAppStore.getState().scheduleContent
    if (!current) return
    const next = { ...(current.columnWidth ?? {}) }
    if (width === null) delete next[key]
    else next[key] = width
    commit(
      current,
      current.tasks,
      { columnWidth: Object.keys(next).length > 0 ? next : undefined },
      false
    )
  }

  function applyOwnerEdit(id: string): void {
    const current = useAppStore.getState().scheduleContent
    if (!current) return
    const ctx = findTaskCtx(current.tasks, id)
    if (!ctx) return
    const raw = ctx.parent[ctx.index].owner
    const normalized = normalizeOwner(raw)
    if (normalized !== raw) editField(current, id, 'owner', normalized)
  }

  function toggleOwner(id: string, name: string): void {
    const current = useAppStore.getState().scheduleContent
    if (!current) return
    const ctx = findTaskCtx(current.tasks, id)
    if (!ctx) return
    const names = collectOwners(current.tasks)
    const checked = new Set(parseOwners(ctx.parent[ctx.index].owner).map((n) => n.toLowerCase()))
    const key = name.toLowerCase()
    if (checked.has(key)) checked.delete(key)
    else checked.add(key)
    editField(current, id, 'owner', names.filter((n) => checked.has(n.toLowerCase())).join(', '))
  }

  function handleGanttResize(
    id: string,
    start: string | null,
    end: string | null,
    mode: 'start' | 'end' | 'move'
  ): void {
    editTask(sc, id, (prev) => {
      const next = { ...prev }
      if (mode === 'start') {
        next.planStart = start
        if (next.planStart && next.planEnd) {
          next.duration = computeDuration(next.planStart, next.planEnd, cal)
        }
      } else if (mode === 'end') {
        next.planEnd = end
        if (next.planStart && next.planEnd) {
          next.duration = computeDuration(next.planStart, next.planEnd, cal)
        }
      } else if (mode === 'move') {
        next.planStart = start
        next.planEnd = end
      }
      return next
    })
  }

  function handleGanttSetDates(id: string, date: string): void {
    editTask(sc, id, (prev) => {
      const duration = prev.duration && prev.duration > 0 ? prev.duration : 1
      return {
        ...prev,
        duration,
        planStart: date,
        planEnd: computeEndDate(date, duration, cal)
      }
    })
  }

  function handleGanttClearPlan(id: string): void {
    editTask(sc, id, (prev) => ({
      ...prev,
      planStart: null,
      planEnd: null
    }))
  }

  function handleGanttInsertBefore(id: string): string | null {
    const next = emptyTask()
    commit(sc, insertTasksBefore(sc.tasks, id, [next]))
    setSelected(new Set([next.id]))
    setAnchorId(next.id)
    return next.id
  }

  function handleGanttInsertAfter(id: string): string | null {
    const next = emptyTask()
    commit(sc, insertTasksAfter(sc.tasks, id, [next]))
    setSelected(new Set([next.id]))
    setAnchorId(next.id)
    return next.id
  }

  function handleGanttIndent(id: string): void {
    commit(sc, indentTask(sc.tasks, id))
  }

  function handleGanttOutdent(id: string): void {
    commit(sc, outdentTask(sc.tasks, id))
  }

  function handleGanttMoveUp(id: string): void {
    const ctx = findTaskCtx(sc.tasks, id)
    if (!ctx || ctx.index === 0) return
    commit(sc, moveTask(sc.tasks, id, -1))
  }

  function handleGanttMoveDown(id: string): void {
    const ctx = findTaskCtx(sc.tasks, id)
    if (!ctx || ctx.index === ctx.parent.length - 1) return
    commit(sc, moveTask(sc.tasks, id, 1))
  }

  function handleGanttDelete(id: string): void {
    const ctx = findTaskCtx(sc.tasks, id)
    if (!ctx) return
    const task = ctx.parent[ctx.index]
    if (task.children.length > 0) {
      setConfirmDelete({ tasks: [task] })
      return
    }
    commit(sc, removeTasks(sc.tasks, new Set([id])))
  }

  function handleGanttTitleStart(): void {
    startEditSession()
  }

  function handleGanttTitleEdit(id: string, value: string): void {
    editField(sc, id, 'title', value)
  }

  function handleGanttTitleEnd(): void {
    endEditSession()
  }

  function setTaskStatusMode(id: string, mode: 'auto' | 'pending' | 'on-hold'): void {
    editTask(sc, id, (prev) => ({
      ...prev,
      status: mode === 'auto' ? 'not-started' : mode
    }))
  }

  function applyStatusMode(mode: 'auto' | 'pending' | 'on-hold'): void {
    if (statusMenu) {
      setTaskStatusMode(statusMenu.id, mode)
      pendingFocus.current = { id: statusMenu.id, col: 'status' }
    }
    setStatusMenu(null)
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

  function handleGridMouseDown(e: React.MouseEvent): void {
    const el = e.target as HTMLElement
    const grid = gridRef.current
    if (el.tagName !== 'INPUT') {
      if (grid) grid.focus({ preventScroll: true })
      return
    }
    if (e.shiftKey || e.button === 2) {
      e.preventDefault()
      el.blur()
      if (grid) grid.focus({ preventScroll: true })
      return
    }
    if (el.dataset.col === 'title' && el.dataset.cell && !selected.has(el.dataset.cell)) {
      e.preventDefault()
      const active = document.activeElement
      if (active instanceof HTMLElement && active.tagName === 'INPUT') active.blur()
      if (grid) grid.focus({ preventScroll: true })
    }
  }

  function handleRowContext(e: React.MouseEvent, id: string): void {
    e.preventDefault()
    e.stopPropagation()
    const isSelected = selected.has(id)
    const sel = isSelected ? selected : new Set([id])
    if (!isSelected) {
      setSelected(sel)
      setAnchorId(id)
    }
    const leafRows = rows.filter((r) => sel.has(r.task.id) && r.task.children.length === 0)
    setGridPercent(leafRows[0]?.task.percentComplete ?? 0)
    setGridMenu({ x: e.clientX, y: e.clientY, id })
  }

  function handleGridInsertBefore(): void {
    if (!gridMenu) return
    const selRows = rows.filter((r) => selected.has(r.task.id))
    const newTasks = Array.from({ length: Math.max(1, selRows.length) }, () => emptyTask())
    const targetId = selRows[0]?.task.id ?? gridMenu.id
    const next = insertTasksBefore(sc.tasks, targetId, newTasks)
    commit(sc, next)
    setSelected(new Set(newTasks.map((t) => t.id)))
    setAnchorId(newTasks[0].id)
    pendingFocus.current = { id: newTasks[0].id, col: 'title' }
    setGridMenu(null)
  }

  function handleGridInsertAfter(): void {
    if (!gridMenu) return
    const selRows = rows.filter((r) => selected.has(r.task.id))
    const newTasks = Array.from({ length: Math.max(1, selRows.length) }, () => emptyTask())
    const targetId = selRows[selRows.length - 1]?.task.id ?? gridMenu.id
    const next = insertTasksAfter(sc.tasks, targetId, newTasks)
    commit(sc, next)
    setSelected(new Set(newTasks.map((t) => t.id)))
    setAnchorId(newTasks[0].id)
    pendingFocus.current = { id: newTasks[0].id, col: 'title' }
    setGridMenu(null)
  }

  function handleGridInsertSubtask(): void {
    if (!gridMenu) return
    const selRows = rows.filter((r) => selected.has(r.task.id))
    const newTasks = Array.from({ length: Math.max(1, selRows.length) }, () => emptyTask())
    const targetId = selRows[selRows.length - 1]?.task.id ?? gridMenu.id
    let next = sc.tasks
    for (const task of newTasks) next = addChild(next, targetId, task)
    commit(sc, next)
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(targetId)
      return next
    })
    setSelected(new Set(newTasks.map((t) => t.id)))
    setAnchorId(newTasks[0].id)
    pendingFocus.current = { id: newTasks[0].id, col: 'title' }
    setGridMenu(null)
  }

  function handleGridCopy(): void {
    handleCopy()
    setGridMenu(null)
  }

  function handleGridCut(): void {
    handleCut()
    setGridMenu(null)
  }

  function handleGridPasteBefore(): void {
    handlePasteBefore()
    setGridMenu(null)
  }

  function handleGridPasteAfter(): void {
    handlePasteAfter()
    setGridMenu(null)
  }

  function autoPlanAnchorIdx(rows: FlatRow[], firstIdx: number): number {
    let prevIdx = firstIdx - 1
    const firstNo = rows[firstIdx].no
    while (prevIdx >= 0 && firstNo.startsWith(rows[prevIdx].no + '.')) prevIdx -= 1
    return prevIdx
  }

  function handleGridAutoPlan(): void {
    const firstIdx = rows.findIndex((r) => selected.has(r.task.id))
    if (firstIdx < 0) return
    const prevIdx = autoPlanAnchorIdx(rows, firstIdx)
    if (prevIdx < 0) return
    const initial = rows[prevIdx].task.planEnd
    if (!initial) return
    let tasks = sc.tasks
    let cursorEnd: string = initial
    for (const row of rows) {
      if (!selected.has(row.task.id)) continue
      if (row.task.children.length > 0) continue
      const planStart = nextWorkingDayString(cursorEnd, cal)
      const duration = row.task.duration ?? 1
      const planEnd = computeEndDate(planStart, duration, cal)
      tasks = updateTask(tasks, row.task.id, (prev) => ({ ...prev, planStart, planEnd, duration }))
      cursorEnd = planEnd
    }
    commit(sc, tasks)
    setGridMenu(null)
  }

  function handleGridClearPlan(): void {
    let tasks = sc.tasks
    for (const row of rows) {
      if (selected.has(row.task.id)) {
        tasks = updateTask(tasks, row.task.id, (prev) => ({
          ...prev,
          planStart: null,
          planEnd: null
        }))
      }
    }
    commit(sc, tasks)
    setGridMenu(null)
  }

  function handleGridDelete(): void {
    setGridMenu(null)
    handleDeleteSelected()
  }

  function handleGridPercentStart(): void {
    if (gridPercentBase.current) return
    const current = useAppStore.getState().scheduleContent
    if (current) gridPercentBase.current = JSON.parse(JSON.stringify(current)) as Schedule
  }

  function handleGridPercentChange(v: number): void {
    setGridPercent(v)
    if (!gridPercentBase.current) handleGridPercentStart()
    let tasks = sc.tasks
    for (const row of rows) {
      if (!selected.has(row.task.id)) continue
      if (row.task.children.length > 0) continue
      tasks = updateTask(tasks, row.task.id, (prev) => ({ ...prev, percentComplete: v }))
    }
    commit(sc, tasks, undefined, false)
  }

  function handleGridPercentEnd(): void {
    const base = gridPercentBase.current
    if (!base) return
    gridPercentBase.current = null
    const current = useAppStore.getState().scheduleContent
    if (current && scheduleKey(current) !== scheduleKey(base)) {
      recordHistory(base)
    }
  }

  function handleNewTask(): void {
    const selRows = rows.filter((r) => selected.has(r.task.id))
    const newTasks = Array.from({ length: Math.max(1, selRows.length) }, () => emptyTask())
    const targetId = selRows[selRows.length - 1]?.task.id ?? lastSelectedId()
    if (targetId) commit(sc, insertTasksAfter(sc.tasks, targetId, newTasks))
    else commit(sc, [...sc.tasks, ...newTasks])
    setSelected(new Set(newTasks.map((t) => t.id)))
    setAnchorId(newTasks[0].id)
    pendingFocus.current = { id: newTasks[0].id, col: 'title' }
  }

  async function handleExportExcel(opts: PlannerExportOptions): Promise<void> {
    const columns: PlannerExportColumn[] = columnOrder
      .filter((k) => k !== 'indicator' && (k === 'no' || k === 'title' || visibleCols.has(k)))
      .map((k) => ({ key: k, label: COLUMNS.find((c) => c.key === k)?.label ?? k }))
    const allRows = flattenTasks(sc.tasks, null, 0, new Set(), [])
    const noByExportId = new Map(allRows.map((r) => [r.task.id, r.no]))
    const exportRows: PlannerExportRow[] = allRows.map((r) => ({
      no: r.no,
      title: r.task.title,
      status: r.task.status,
      owner: r.task.owner,
      duration: r.task.duration,
      planStart: r.task.planStart,
      planEnd: r.task.planEnd,
      actualStart: r.task.actualStart,
      actualEnd: r.task.actualEnd,
      percentComplete: r.task.percentComplete,
      note: r.task.note,
      dependsOn:
        r.task.dependsOn && r.task.dependsOn.length > 0
          ? r.task.dependsOn
              .map(
                (l) =>
                  `${noByExportId.get(l.id) ?? '?'} ${l.type}${
                    l.lag === 0 ? '' : l.lag > 0 ? `+${l.lag}` : l.lag
                  }`
              )
              .join(', ')
          : null,
      depth: r.depth,
      hasChildren: r.task.children.length > 0
    }))
    try {
      const result = await window.ptnotes.planner.exportExcel({
        scheduleName: sc.name,
        overallPercent: overallPercentComplete(sc.tasks),
        columns,
        rows: exportRows,
        calendar: cal,
        progressDate: opts.progressDate,
        progressMode: opts.progressMode,
        planPercent:
          opts.progressMode === 'percent-plan'
            ? estimatePercentComplete(sc.tasks, opts.progressDate)
            : null,
        ganttMode: opts.ganttMode
      })
      if (!result.ok && !result.canceled) window.alert(friendlyError(result.error))
    } catch (err) {
      window.alert(friendlyError(err))
    }
  }

  function handleNewSubtask(): void {
    const selRows = rows.filter((r) => selected.has(r.task.id))
    const newTasks = Array.from({ length: Math.max(1, selRows.length) }, () => emptyTask())
    const targetId = selRows[selRows.length - 1]?.task.id ?? lastSelectedId()
    if (!targetId) return
    let next = sc.tasks
    for (const task of newTasks) next = addChild(next, targetId, task)
    commit(sc, next)
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(targetId)
      return next
    })
    setSelected(new Set(newTasks.map((t) => t.id)))
    setAnchorId(newTasks[0].id)
    pendingFocus.current = { id: newTasks[0].id, col: 'title' }
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
    const inserted = targetId
      ? insertTasksBefore(sc.tasks, targetId, clones)
      : [...sc.tasks, ...clones]
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

  function focusCell(id: string, col: string): boolean {
    if (col === 'title' || col === 'note') {
      // Title/note inputs only render in edit mode — flip the display div, then the
      // pending-focus effect focuses it once it mounts.
      pendingFocus.current = { id, col }
      if (col === 'title') setTitleEditId(id)
      else setNoteEditId(id)
      setSelected(new Set([id]))
      setAnchorId(id)
      return true
    }
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${id}"][data-col="${col}"]`)
    if (!el || (el as HTMLInputElement).disabled) return false
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'nearest' })
    setSelected(new Set([id]))
    setAnchorId(id)
    return true
  }

  function moveFocusFrom(rowIdx: number, col: string, dir: -1 | 1): void {
    let i = rowIdx + dir
    while (i >= 0 && i < rows.length) {
      if (focusCell(rows[i].task.id, col)) return
      i += dir
    }
  }

  function moveSelectionBy(step: number): void {
    if (rows.length === 0) return
    const from = lastSelectedId()
    const curIdx = from ? rows.findIndex((r) => r.task.id === from) : -1
    const targetIdx = Math.max(0, Math.min(rows.length - 1, (curIdx === -1 ? 0 : curIdx) + step))
    if (rows[targetIdx]) {
      setSelected(new Set([rows[targetIdx].task.id]))
      setAnchorId(rows[targetIdx].task.id)
      scrollRowIntoView(rows[targetIdx].task.id)
    }
  }

  function scrollRowIntoView(id: string): void {
    const scroll = gridScrollRef.current
    const row = gridRef.current?.querySelector<HTMLElement>(`[data-row="${id}"]`)
    if (!scroll || !row) return
    const head = gridRef.current?.querySelector<HTMLElement>('.planner-grid-head')
    const hRect = head?.getBoundingClientRect()
    const sRect = scroll.getBoundingClientRect()
    const headerGuard = hRect ? hRect.bottom - sRect.top : 0
    const statusH = statusbarRef.current?.offsetHeight ?? 0
    const rect = row.getBoundingClientRect()
    const top = rect.top - sRect.top
    const bottom = rect.bottom - sRect.top
    const viewH = scroll.clientHeight
    if (top < headerGuard) {
      scroll.scrollTop += top - headerGuard
    } else if (bottom > viewH - statusH) {
      scroll.scrollTop += bottom - (viewH - statusH)
    }
  }

  function selectRow(idx: number): void {
    if (idx < 0 || idx >= rows.length) return
    setSelected(new Set([rows[idx].task.id]))
    setAnchorId(rows[idx].task.id)
    scrollRowIntoView(rows[idx].task.id)
  }

  function handleGridKeyDown(e: React.KeyboardEvent): void {
    const active = document.activeElement
    const cellEl = active instanceof HTMLElement ? active.closest<HTMLElement>('[data-cell]') : null
    const cellId = cellEl?.dataset.cell
    const col = cellEl?.dataset.col
    const rowIdx = cellId ? rows.findIndex((r) => r.task.id === cellId) : -1

    if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
      gridRef.current?.focus({ preventScroll: true })
      return
    }

    if (e.key === 'Enter') {
      if (cellId && col && rowIdx !== -1) {
        if (col === 'status') return
        e.preventDefault()
        ;(active as HTMLElement).blur()
        if (rowIdx === rows.length - 1) {
          const task = emptyTask()
          commit(sc, addSibling(sc.tasks, rows[rows.length - 1].task.id, task))
          setSelected(new Set([task.id]))
          setAnchorId(task.id)
          // The new row's title cell starts as a display div — flip it to edit mode.
          setTitleEditId(task.id)
          pendingFocus.current = { id: task.id, col: 'title' }
        } else {
          moveFocusFrom(rowIdx, col, 1)
        }
        return
      }
      e.preventDefault()
      const id = lastSelectedId() ?? rows[0]?.task.id
      if (id) focusCell(id, 'title')
      return
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const dir: -1 | 1 = e.key === 'ArrowDown' ? 1 : -1
      if (cellId && col && rowIdx !== -1) {
        e.preventDefault()
        moveFocusFrom(rowIdx, col, dir)
        return
      }
      e.preventDefault()
      moveSelectionBy(dir)
      return
    }

    if (e.key === 'PageDown' || e.key === 'PageUp') {
      if (cellId && col && rowIdx !== -1) return
      e.preventDefault()
      moveSelectionBy(e.key === 'PageDown' ? 10 : -10)
      return
    }

    if (e.key === 'Home' || e.key === 'End') {
      if (cellId && col && rowIdx !== -1) return
      e.preventDefault()
      selectRow(e.key === 'Home' ? 0 : rows.length - 1)
      return
    }
  }

  function handleStatusMenuKeyDown(e: React.KeyboardEvent): void {
    const items = statusMenuRef.current?.querySelectorAll<HTMLButtonElement>('.note-menu-item')
    if (!items || items.length === 0) return
    const curIdx = Array.from(items).indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      const next = Math.max(0, Math.min(items.length - 1, (curIdx === -1 ? 0 : curIdx) + dir))
      items[next].focus()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (curIdx === -1) {
        e.preventDefault()
        const activeIdx =
          statusMenu?.mode === 'pending' ? 1 : statusMenu?.mode === 'on-hold' ? 2 : 0
        items[activeIdx].click()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setStatusMenu(null)
    }
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
  const canAutoPlan = (() => {
    const firstIdx = rows.findIndex((r) => selected.has(r.task.id))
    if (firstIdx < 0) return false
    const prevIdx = autoPlanAnchorIdx(rows, firstIdx)
    return prevIdx >= 0 && !!rows[prevIdx].task.planEnd
  })()
  const allParents = (() => {
    const selRows = rows.filter((r) => selected.has(r.task.id))
    return selRows.length > 0 && selRows.every((r) => r.task.children.length > 0)
  })()

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

  function setSliderPercent(id: string, v: number): void {
    setNumberDrafts((d) => {
      if (!(numberDraftKey(id, 'percentComplete') in d)) return d
      const next = { ...d }
      delete next[numberDraftKey(id, 'percentComplete')]
      return next
    })
    const current = useAppStore.getState().scheduleContent
    if (!current) return
    editField(current, id, 'percentComplete', Math.min(100, Math.max(0, Math.round(v))))
  }

  function handlePercentSliderBlur(e: React.FocusEvent): void {
    endEditSession()
    const rt = e.relatedTarget
    if (!(rt instanceof Node && percentMenuRef.current?.contains(rt))) {
      setPercentMenu(null)
    }
  }

  /** Draft shown while typing; a draft no longer matching the committed value is stale (e.g.
   *  a later planEnd edit recomputed the duration) — the committed value wins instead. */
  function displayNumber(
    task: ScheduleTask,
    field: 'duration' | 'percentComplete'
  ): string | number {
    const committed = field === 'duration' ? task.duration : task.percentComplete
    const draft = numberDrafts[numberDraftKey(task.id, field)]
    if (
      draft !== undefined &&
      (committed === null || committed === undefined || Number(draft) !== committed)
    ) {
      return committed ?? ''
    }
    return draft ?? committed ?? ''
  }

  function normalizeNumber(id: string, field: 'duration' | 'percentComplete', raw: string): void {
    const trimmed = raw.trim()
    const key = numberDraftKey(id, field)
    if (trimmed === '') {
      if (!(key in numberDrafts)) return
      const next = { ...numberDrafts }
      delete next[key]
      setNumberDrafts(next)
      commitNumber(sc, id, field, '')
      return
    }
    const n = Math.floor(Number(trimmed))
    const next = { ...numberDrafts }
    if (!isNaN(n)) {
      const clamped = field === 'duration' ? Math.max(1, n) : Math.min(100, Math.max(0, n))
      next[key] = String(clamped)
      commitNumber(sc, id, field, String(clamped))
    } else {
      delete next[key]
    }
    setNumberDrafts(next)
  }

  const ganttMode = view === 'gantt'
  const deleteTotal = confirmDelete ? countDeletable(confirmDelete.tasks) : 0

  return (
    <div className={`planner-editor${ganttMode ? ' planner-gantt' : ''}`} ref={plannerRef}>
      <div className="planner-titlebar" ref={titlebarRef}>
        <span className="planner-toolbar-title" title={schedule.name}>
          {schedule.name}
        </span>
        <button
          className="icon-btn small"
          title="Rename schedule"
          onClick={() => {
            setRenameError('')
            setRenaming(true)
          }}
        >
          <MdiIcon path={mdiPencil} size={16} />
        </button>
        {!ganttMode && (
          <button
            className="icon-btn small"
            title="Snapshots"
            onClick={() => setSnapshotsOpen(true)}
          >
            <MdiIcon path={mdiHistory} size={16} />
          </button>
        )}
      </div>
      <div className="planner-toolbar" ref={toolbarRef}>
        <div className="planner-toolbar-group">
          <button
            className="icon-btn"
            title="Undo (⌘Z)"
            disabled={(plannerUndo[schedule.id]?.length ?? 0) === 0}
            onClick={handleUndo}
          >
            <MdiIcon path={mdiUndo} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Redo (⇧⌘Z)"
            disabled={(plannerRedo[schedule.id]?.length ?? 0) === 0}
            onClick={handleRedo}
          >
            <MdiIcon path={mdiRedo} size={16} />
          </button>
        </div>
        <span className="planner-toolbar-divider" />
        <div className="planner-toolbar-group">
          <button
            className="icon-btn"
            title="New task"
            disabled={ganttMode}
            onClick={handleNewTask}
          >
            <MdiIcon path={mdiPlus} size={16} />
          </button>
          <button
            className="icon-btn"
            title="New subtask"
            disabled={ganttMode || !lastSelectedId()}
            onClick={handleNewSubtask}
          >
            <MdiIcon path={mdiPlaylistPlus} size={16} />
          </button>
          <button
            className="icon-btn danger"
            title="Delete selected"
            disabled={ganttMode || selected.size === 0}
            onClick={handleDeleteSelected}
          >
            <MdiIcon path={mdiTrashCanOutline} size={16} />
          </button>
        </div>
        <span className="planner-toolbar-divider" />
        <div className="planner-toolbar-group">
          <button
            className="icon-btn"
            title="Copy"
            disabled={ganttMode || selected.size === 0}
            onClick={handleCopy}
          >
            <MdiIcon path={mdiContentCopy} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Cut"
            disabled={ganttMode || selected.size === 0}
            onClick={handleCut}
          >
            <MdiIcon path={mdiContentCut} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Paste"
            disabled={ganttMode || clipboard.length === 0}
            onClick={handlePasteBefore}
          >
            <MdiIcon path={mdiContentPaste} size={16} />
          </button>
        </div>
        <span className="planner-toolbar-divider" />
        <div className="planner-toolbar-group">
          <button
            className="icon-btn"
            title="Move to child level"
            disabled={ganttMode || !canIndent}
            onClick={handleIndent}
          >
            <MdiIcon path={mdiArrowRightCircleOutline} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Move to parent level"
            disabled={ganttMode || !canOutdent}
            onClick={handleOutdent}
          >
            <MdiIcon path={mdiArrowLeftCircleOutline} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Move up"
            disabled={ganttMode || !canMoveUp}
            onClick={handleMoveUp}
          >
            <MdiIcon path={mdiArrowUpCircleOutline} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Move down"
            disabled={ganttMode || !canMoveDown}
            onClick={handleMoveDown}
          >
            <MdiIcon path={mdiArrowDownCircleOutline} size={16} />
          </button>
        </div>
        <span className="planner-toolbar-divider" />
        <div className="planner-toolbar-group">
          <button className="icon-btn" title="Resources" onClick={() => setResourcesOpen(true)}>
            <MdiIcon path={mdiAccountGroup} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Estimate %Completed"
            onClick={() => setEstimateOpen(true)}
          >
            <MdiIcon path={mdiPercent} size={16} />
          </button>
        </div>
        <span className="planner-toolbar-divider" />
        <div className="planner-toolbar-group">
          <button
            className="icon-btn"
            title="View columns"
            disabled={ganttMode}
            onClick={() => setColumnsOpen(true)}
          >
            <MdiIcon path={mdiViewColumnOutline} size={16} />
          </button>
          <button
            className="icon-btn"
            title="Calendar"
            disabled={ganttMode}
            onClick={() => setCalendarOpen(true)}
          >
            <MdiIcon path={mdiCalendarMonth} size={16} />
          </button>
        </div>
        <span className="planner-toolbar-divider" />
        <div className="planner-toolbar-group">
          <button
            className="icon-btn"
            title="Export to Excel"
            disabled={sc.tasks.length === 0}
            onClick={() => setExportOpen(true)}
          >
            <MdiIcon path={mdiFileExcelOutline} size={16} />
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
          <div className="planner-grid-scroll" ref={gridScrollRef}>
            {view === 'table' ? (
              <div
                className="planner-grid"
                ref={gridRef}
                tabIndex={-1}
                onKeyDown={handleGridKeyDown}
                onFocusCapture={handleGridFocusCapture}
                onMouseDownCapture={handleGridMouseDown}
              >
                <div className="planner-grid-head" style={{ gridTemplateColumns: template }}>
                  <div
                    className="planner-head-band planner-head-left"
                    style={{
                      gridColumn: `1 / ${colSplit.leftCount + 1}`,
                      gridTemplateColumns: colSplit.left
                    }}
                  >
                    <div className="planner-col-toggle planner-cell"></div>
                    {visibleCols.has('indicator') && (
                      <div className="planner-col-indicator planner-cell"></div>
                    )}
                    <div className="planner-col-no planner-cell" style={{ left: noLeft }}>
                      No.
                    </div>
                    <div className="planner-col-title planner-cell" style={{ left: titleLeft }}>
                      Title
                      <PlannerResizeHandle
                        width={titleWidthGrid}
                        min={TITLE_WIDTH_GRID_MIN}
                        max={TITLE_WIDTH_GRID_MAX}
                        onResize={setTitleWidthGrid}
                        onCommitEnd={(w) => {
                          setTitleWidthGrid(w)
                          persistTitleWidth({ grid: w })
                        }}
                        onReset={() => {
                          setTitleWidthGrid(null)
                          persistTitleWidth({ grid: null })
                        }}
                      />
                    </div>
                  </div>
                  {colSplit.right && (
                    <div
                      className="planner-head-band planner-head-right"
                      style={{
                        gridColumn: `${colSplit.leftCount + 1} / -1`,
                        gridTemplateColumns: colSplit.right
                      }}
                    >
                      {movableCols.map((key) => (
                        <div key={key} className={`${MOVABLE_HEADERS[key].className} planner-cell`}>
                          {MOVABLE_HEADERS[key].label}
                          <PlannerResizeHandle
                            width={columnWidths[key] ?? null}
                            min={COL_WIDTH_MIN}
                            max={COL_WIDTH_MAX}
                            onResize={(w) => setColumnWidths((prev) => ({ ...prev, [key]: w }))}
                            onCommitEnd={(w) => {
                              setColumnWidths((prev) => ({ ...prev, [key]: w }))
                              persistColumnWidth(key, w)
                            }}
                            onReset={() => {
                              setColumnWidths((prev) => {
                                const next = { ...prev }
                                delete next[key]
                                return next
                              })
                              persistColumnWidth(key, null)
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="planner-grid-body">{renderTaskTree(sc.tasks, null, 0)}</div>
              </div>
            ) : (
              <GanttChart
                tasks={sc.tasks}
                calendar={cal}
                collapsed={collapsed}
                dayWidth={ganttDayWidth}
                titleWidth={titleWidthGantt}
                linkLocks={ganttLinkLocks}
                onToggle={toggleCollapse}
                onTitleWidthResize={setTitleWidthGantt}
                onTitleWidthCommit={(w) => persistTitleWidth({ gantt: w })}
                onTitleWidthReset={() => {
                  setTitleWidthGantt(GANTT_TITLE_WIDTH_DEFAULT)
                  persistTitleWidth({ gantt: GANTT_TITLE_WIDTH_DEFAULT })
                }}
                onResize={handleGanttResize}
                onSetDates={handleGanttSetDates}
                onClearPlan={handleGanttClearPlan}
                onInsertBefore={handleGanttInsertBefore}
                onInsertAfter={handleGanttInsertAfter}
                onIndent={handleGanttIndent}
                onOutdent={handleGanttOutdent}
                onMoveUp={handleGanttMoveUp}
                onMoveDown={handleGanttMoveDown}
                onDelete={handleGanttDelete}
                onTitleEditStart={handleGanttTitleStart}
                onTitleEdit={handleGanttTitleEdit}
                onTitleEditEnd={handleGanttTitleEnd}
                bodyRef={ganttBodyRef}
              />
            )}
          </div>
        )}
      </div>
      <NameTip tip={titleTip} onDismiss={() => setTitleTip(null)} />
      <div className="planner-hscroll" ref={hScrollBarRef} onPointerDown={handleHScrollDown}>
        <div className="planner-hscroll-thumb" ref={hScrollThumbRef} />
      </div>
      <div className="planner-statusbar" ref={statusbarRef}>
        {ganttMode && (
          <div className="planner-gantt-zoom" title="Gantt zoom">
            <button
              type="button"
              className="planner-zoom-btn"
              aria-label="Zoom out"
              onClick={() => setGanttDayWidth((w) => Math.max(GANTT_DAY_WIDTH_MIN, w - 4))}
            >
              <MdiIcon path={mdiMagnifyMinus} size={16} />
            </button>
            <input
              type="range"
              min={GANTT_DAY_WIDTH_MIN}
              max={GANTT_DAY_WIDTH_MAX}
              step={4}
              value={ganttDayWidth}
              onChange={(e) => setGanttDayWidth(Number(e.target.value))}
            />
            <button
              type="button"
              className="planner-zoom-btn"
              aria-label="Zoom in"
              onClick={() => setGanttDayWidth((w) => Math.min(GANTT_DAY_WIDTH_MAX, w + 4))}
            >
              <MdiIcon path={mdiMagnifyPlus} size={16} />
            </button>
          </div>
        )}
        <div className="view-toggle">
          <button
            className={`view-btn ${view === 'table' ? 'active' : ''}`}
            onClick={() => switchView('table')}
          >
            <MdiIcon path={mdiGrid} size={16} /> Grid View
          </button>
          <button
            className={`view-btn ${view === 'gantt' ? 'active' : ''}`}
            onClick={() => switchView('gantt')}
          >
            <MdiIcon path={mdiChartTimeline} size={16} /> Gantt Chart View
          </button>
        </div>
      </div>
      {statusMenu && (
        <>
          <div className="menu-overlay" onClick={() => setStatusMenu(null)} />
          <div
            ref={statusMenuRef}
            className="note-menu planner-status-menu"
            style={{ left: statusMenu.x, top: statusMenu.y }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleStatusMenuKeyDown}
          >
            <button
              type="button"
              className={`note-menu-item${statusMenu.mode === 'not-started' ? ' active' : ''}`}
              onClick={() => applyStatusMode('auto')}
            >
              [Auto]
            </button>
            <div className="note-menu-sep" />
            <button
              type="button"
              className={`note-menu-item${statusMenu.mode === 'pending' ? ' active' : ''}`}
              onClick={() => applyStatusMode('pending')}
            >
              Pending
            </button>
            <button
              type="button"
              className={`note-menu-item${statusMenu.mode === 'on-hold' ? ' active' : ''}`}
              onClick={() => applyStatusMode('on-hold')}
            >
              On Hold
            </button>
          </div>
        </>
      )}

      {noteMention && noteMentionItems.length > 0 && (
        <div
          className="mention-popup planner-mention-popup"
          style={{ left: noteMention.x, top: noteMention.y }}
        >
          {noteMentionItems.map((item, i) => (
            <div
              key={item.id}
              ref={(el) => {
                if (el && i === noteMentionIndex) el.scrollIntoView({ block: 'nearest' })
              }}
              className={`mention-item ${i === noteMentionIndex ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                insertNoteMention(item)
              }}
              onMouseEnter={() => setNoteMentionIndex(i)}
            >
              <span className="mention-icon">
                <MdiIcon
                  path={noteMention.kind === 'kanban' ? KANBAN_LINK_ICON : NOTE_LINK_ICON}
                  size={16}
                />
              </span>
              {'name' in item ? item.name : item.title}
            </div>
          ))}
        </div>
      )}

      {ownerMenu && ownerTask && (
        <>
          <div className="menu-overlay" onClick={() => setOwnerMenu(null)} />
          <div
            ref={ownerMenuRef}
            className="note-menu planner-owner-menu"
            style={{ left: ownerMenu.x, top: ownerMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {ownerNames.length === 0 ? (
              <div className="planner-owner-empty">No owners yet — type a name above</div>
            ) : (
              ownerNames.map((name) => (
                <div
                  key={name.toLowerCase()}
                  className="planner-owner-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggleOwner(ownerTask.id, name)}
                >
                  <input
                    type="checkbox"
                    checked={ownerChecked.has(name.toLowerCase())}
                    readOnly
                    tabIndex={-1}
                  />
                  <span>{name}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {percentMenu && percentTask && percentTask.children.length === 0 && (
        <div ref={percentMenuRef} className="note-menu planner-percent-menu">
          <div className="note-menu-slider">
            <span>%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={percentTask.percentComplete ?? 0}
              onChange={(e) => setSliderPercent(percentTask.id, Number(e.target.value))}
              onPointerDown={() => startEditSession()}
              onPointerUp={() => endEditSession()}
              onKeyUp={endEditSession}
              onBlur={handlePercentSliderBlur}
            />
            <span className="note-menu-slider-value">{percentTask.percentComplete ?? 0}%</span>
          </div>
        </div>
      )}

      {depEditor &&
        (() => {
          const ctx = findTaskCtx(sc.tasks, depEditor.id)
          const depTask = ctx ? ctx.parent[ctx.index] : null
          if (!depTask) return null
          return (
            <>
              <div className="menu-overlay" onClick={() => setDepEditor(null)} />
              <div
                ref={depEditorRef}
                className="note-menu planner-dep-menu"
                style={{ left: depEditor.x, top: depEditor.y }}
                onClick={(e) => e.stopPropagation()}
              >
                <DepEditorMenu
                  schedule={sc.tasks}
                  task={depTask}
                  noById={noById}
                  allTaskMap={allTaskMap}
                  onApply={(l) => applyLinks(depTask.id, l)}
                  onClose={() => setDepEditor(null)}
                />
              </div>
            </>
          )
        })()}

      {depDragSource && depDragFrom && (
        <div className="planner-dep-drag-overlay">
          <svg width="100%" height="100%">
            {depDragCursor && (
              <line
                x1={depDragFrom.x}
                y1={depDragFrom.y}
                x2={depDragCursor.x}
                y2={depDragCursor.y}
                className="planner-dep-drag-line"
              />
            )}
          </svg>
          {depDragCursor && (
            <div
              className="planner-dep-drag-target"
              style={{ left: depDragCursor.x, top: depDragCursor.y }}
            >
              <MdiIcon path={mdiTargetVariant} size={20} />
            </div>
          )}
        </div>
      )}

      {gridMenu && (
        <>
          <div className="menu-overlay" onClick={() => setGridMenu(null)} />
          <div
            ref={gridMenuRef}
            className="note-menu planner-grid-menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="note-menu-item" onClick={handleGridInsertBefore}>
              <span className="note-menu-icon">
                <MdiIcon path={mdiTableRowPlusBefore} size={16} />
              </span>
              Insert Before
            </button>
            <button type="button" className="note-menu-item" onClick={handleGridInsertAfter}>
              <span className="note-menu-icon">
                <MdiIcon path={mdiTableRowPlusAfter} size={16} />
              </span>
              Insert After
            </button>
            <button type="button" className="note-menu-item" onClick={handleGridInsertSubtask}>
              <span className="note-menu-icon">
                <MdiIcon path={mdiPlaylistPlus} size={16} />
              </span>
              Insert Sub Task
            </button>
            <div className="note-menu-sep" />
            <button type="button" className="note-menu-item" onClick={handleGridCopy}>
              <span className="note-menu-icon">
                <MdiIcon path={mdiContentCopy} size={16} />
              </span>
              Copy
            </button>
            <button type="button" className="note-menu-item" onClick={handleGridCut}>
              <span className="note-menu-icon">
                <MdiIcon path={mdiContentCut} size={16} />
              </span>
              Cut
            </button>
            <button
              type="button"
              className="note-menu-item"
              disabled={clipboard.length === 0}
              onClick={handleGridPasteBefore}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiContentPaste} size={16} />
              </span>
              Paste Before
            </button>
            <button
              type="button"
              className="note-menu-item"
              disabled={clipboard.length === 0}
              onClick={handleGridPasteAfter}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiContentPaste} size={16} />
              </span>
              Paste After
            </button>
            {!allParents && <div className="note-menu-sep" />}
            {!allParents && (
              <>
                <button
                  type="button"
                  className="note-menu-item"
                  disabled={!canAutoPlan}
                  onClick={handleGridAutoPlan}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiCalendarClock} size={16} />
                  </span>
                  Auto Plan Date
                </button>
                <button type="button" className="note-menu-item" onClick={handleGridClearPlan}>
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiCalendarRemove} size={16} />
                  </span>
                  Clear Plan Date
                </button>
              </>
            )}
            {!allParents && (
              <>
                <div className="note-menu-sep" />
                <div className="note-menu-item note-menu-slider">
                  <span>%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={10}
                    value={gridPercent}
                    onPointerDown={handleGridPercentStart}
                    onChange={(e) => handleGridPercentChange(Number(e.target.value))}
                    onPointerUp={handleGridPercentEnd}
                    onKeyUp={handleGridPercentEnd}
                    onBlur={handleGridPercentEnd}
                  />
                  <span className="note-menu-slider-value">{gridPercent}%</span>
                </div>
              </>
            )}
            <div className="note-menu-sep" />
            <button type="button" className="note-menu-item danger" onClick={handleGridDelete}>
              <span className="note-menu-icon">
                <MdiIcon path={mdiTrashCanOutline} size={16} />
              </span>
              Delete
            </button>
          </div>
        </>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete task"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            if (confirmDelete) {
              commit(sc, removeTasks(sc.tasks, new Set(confirmDelete.tasks.map((t) => t.id))))
            }
            setSelected(new Set())
            setAnchorId(null)
            setConfirmDelete(null)
          }}
          message={
            confirmDelete.tasks.length === 1
              ? confirmDelete.tasks[0].children.length > 0
                ? `Delete "${confirmDelete.tasks[0].title || 'Untitled'}" and its ${
                    deleteTotal - 1
                  } subtask${deleteTotal - 1 === 1 ? '' : 's'}? This cannot be undone.`
                : `Delete "${confirmDelete.tasks[0].title || 'Untitled'}"? This cannot be undone.`
              : `Delete ${confirmDelete.tasks.length} selected task${
                  confirmDelete.tasks.length === 1 ? '' : 's'
                } (${deleteTotal} total including subtasks)? This cannot be undone.`
          }
        />
      )}

      {columnsOpen && (
        <PlannerColumnModal
          columns={COLUMNS}
          visible={visibleCols}
          disabledKeys={new Set(['no', 'title'])}
          order={columnOrder}
          fixedKeys={new Set(FIXED_COLUMNS)}
          onMove={(key, dir) => {
            setColumnOrder((prev) => {
              const i = prev.indexOf(key)
              const j = i + dir
              if (i === -1 || j < 0 || j >= prev.length) return prev
              const next = [...prev]
              ;[next[i], next[j]] = [next[j], next[i]]
              return next
            })
          }}
          onToggle={(key) => {
            const next = new Set(visibleCols)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            setVisibleCols(next)
          }}
          onReset={() => {
            setVisibleCols(initVisibleCols(undefined))
            setColumnOrder(initColumnOrder(undefined))
            setColumnWidths({})
            setTitleWidthGrid(null)
          }}
          onClose={() => {
            const visibility = { ...(sc.columnVisibility ?? {}) }
            for (const c of COLUMNS) visibility[c.key] = visibleCols.has(c.key)
            visibility.no = true
            visibility.title = true
            const titleWidth = { ...(sc.titleWidth ?? {}) }
            if (titleWidthGrid === null) delete titleWidth.grid
            else titleWidth.grid = titleWidthGrid
            commit(sc, sc.tasks, {
              columnVisibility: visibility,
              columnOrder,
              columnWidth: Object.keys(columnWidths).length > 0 ? columnWidths : undefined,
              titleWidth: Object.keys(titleWidth).length > 0 ? titleWidth : undefined
            })
            setColumnsOpen(false)
          }}
        />
      )}

      {calendarOpen && <CalendarModal onClose={() => setCalendarOpen(false)} />}

      {estimateOpen && <PlannerEstimateModal onClose={() => setEstimateOpen(false)} />}

      {exportOpen && (
        <PlannerExportModal
          onClose={() => setExportOpen(false)}
          onExport={(opts) => {
            setExportOpen(false)
            void handleExportExcel(opts)
          }}
        />
      )}

      {resourcesOpen && <PlannerResourcesModal onClose={() => setResourcesOpen(false)} />}

      {renaming && (
        <PromptModal
          title={`Rename schedule`}
          placeholder="Schedule name"
          initialValue={schedule.name}
          submitLabel="Rename"
          error={renameError}
          onClose={() => setRenaming(false)}
          onSubmit={(value) => {
            void (async () => {
              try {
                await renameSchedule(schedule.id, value)
                setRenameError('')
                setRenaming(false)
              } catch (e) {
                setRenameError(friendlyError(e))
              }
            })()
          }}
        />
      )}
    </div>
  )
}
