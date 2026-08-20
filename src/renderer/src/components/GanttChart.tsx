import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { mdiCalendarRemove, mdiChevronDown, mdiChevronRight, mdiClose } from '@mdi/js'
import { computeDuration, formatDate, isWorkingDay, parseDate } from '@shared/planner'
import type { ProjectCalendar, ScheduleTask } from '@shared/types'
import { MdiIcon } from './MdiIcon'

const DAY_MS = 24 * 60 * 60 * 1000
export const GANTT_DAY_WIDTH_MIN = 8
export const GANTT_DAY_WIDTH_MAX = 32
export const GANTT_DAY_WIDTH_DEFAULT = 24
const PADDING_DAYS = 7
const TOGGLE_WIDTH = 28
const NO_WIDTH = 46
const TITLE_WIDTH = 220

interface GanttChartProps {
  tasks: ScheduleTask[]
  calendar: ProjectCalendar
  collapsed: Set<string>
  dayWidth: number
  onToggle: (id: string) => void
  onResize: (
    id: string,
    start: string | null,
    end: string | null,
    mode: 'start' | 'end' | 'move'
  ) => void
  onSetDates: (id: string, date: string) => void
  onClearPlan: (id: string) => void
  bodyRef?: React.RefObject<HTMLDivElement | null>
}

interface Timeline {
  start: Date
  days: Date[]
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

function collectTasks(tasks: ScheduleTask[], out: ScheduleTask[]): ScheduleTask[] {
  for (const t of tasks) {
    out.push(t)
    collectTasks(t.children, out)
  }
  return out
}

function buildTimeline(tasks: ScheduleTask[]): Timeline {
  let min: string | null = null
  let max: string | null = null
  for (const task of collectTasks(tasks, [])) {
    if (task.planStart && (!min || task.planStart < min)) min = task.planStart
    if (task.planEnd && (!max || task.planEnd > max)) max = task.planEnd
  }
  const today = parseDate(formatDate(new Date()))
  const anchorStart = min ? parseDate(min) : today
  const anchorEnd = max ? parseDate(max) : today
  const start = addDays(anchorStart, -PADDING_DAYS)
  const end = addDays(anchorEnd, PADDING_DAYS)
  const days: Date[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return { start, days }
}

function deriveTaskNo(parentNo: string | null, i: number): string {
  return parentNo ? `${parentNo}.${i + 1}` : `${i + 1}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface MonthBand {
  key: string
  label: string
  dayCount: number
  left: number
}

function buildMonths(days: Date[], dayWidth: number): MonthBand[] {
  const bands: MonthBand[] = []
  let left = 0
  for (const day of days) {
    const key = `${day.getFullYear()}-${day.getMonth()}`
    const last = bands[bands.length - 1]
    if (last && last.key === key) {
      last.dayCount++
    } else {
      bands.push({ key, label: MONTHS[day.getMonth()], dayCount: 1, left })
    }
    left += dayWidth
  }
  return bands
}

function dayOffset(timeline: Timeline, date: string): number {
  const d = parseDate(date)
  return Math.round((d.getTime() - timeline.start.getTime()) / DAY_MS)
}

function formatDuration(task: ScheduleTask, calendar: ProjectCalendar): number {
  if (task.planStart && task.planEnd) {
    return computeDuration(task.planStart, task.planEnd, calendar)
  }
  return task.duration ?? 0
}

type DragMode = 'start' | 'end' | 'move'

interface DragSession {
  id: string
  mode: DragMode
  planStart: string
  planEnd: string
  startOffset: number
  widthDays: number
  startClientX: number
}

interface DragState {
  id: string
  mode: DragMode
  startOffset: number
  widthDays: number
  deltaDays: number
}

/** Clamp a day delta so the bar stays in range and start never passes end. */
function clampDelta(
  mode: DragMode,
  startOffset: number,
  widthDays: number,
  deltaDays: number,
  daysLength: number
): number {
  const maxOffset = daysLength - 1
  const endOffset = startOffset + widthDays - 1
  let lo = -Infinity
  let hi = Infinity
  if (mode === 'move') {
    lo = -startOffset
    hi = maxOffset - endOffset
  } else if (mode === 'start') {
    lo = -startOffset
    hi = widthDays - 1
  } else {
    lo = -(widthDays - 1)
    hi = maxOffset - endOffset
  }
  return Math.max(lo, Math.min(hi, deltaDays))
}

function buildNoMap(
  tasks: ScheduleTask[],
  parentNo: string | null,
  out: Map<string, string>
): void {
  tasks.forEach((t, i) => {
    const no = deriveTaskNo(parentNo, i)
    out.set(t.id, no)
    buildNoMap(t.children, no, out)
  })
}

export function GanttChart({
  tasks,
  calendar,
  collapsed,
  dayWidth,
  onToggle,
  onResize,
  onSetDates,
  onClearPlan,
  bodyRef
}: GanttChartProps): React.JSX.Element {
  const timeline = useMemo(() => buildTimeline(tasks), [tasks])
  const months = useMemo(() => buildMonths(timeline.days, dayWidth), [timeline, dayWidth])
  const timelineWidth = timeline.days.length * dayWidth
  const leftWidth = TOGGLE_WIDTH + NO_WIDTH + TITLE_WIDTH
  const todayKey = formatDate(new Date())
  const [currentMonth, setCurrentMonth] = useState(months[0].label)
  const [prevMonths, setPrevMonths] = useState(months)
  if (prevMonths !== months) {
    setPrevMonths(months)
    setCurrentMonth(months[0].label)
  }
  const [drag, setDrag] = useState<DragState | null>(null)
  const [popup, setPopup] = useState<{
    id: string
    left: number
    top: number
    bottom: number
  } | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const dragCleanup = useRef<(() => void) | null>(null)
  const noMap = useMemo(() => {
    const m = new Map<string, string>()
    buildNoMap(tasks, null, m)
    return m
  }, [tasks])
  const taskMap = useMemo(() => {
    const m = new Map<string, ScheduleTask>()
    for (const t of collectTasks(tasks, [])) m.set(t.id, t)
    return m
  }, [tasks])

  useEffect(() => {
    return () => {
      dragCleanup.current?.()
    }
  }, [])

  useEffect(() => {
    if (!popup) return
    const onDocMouseDown = (e: MouseEvent): void => {
      const el = e.target as HTMLElement
      if (el.closest('.gantt-popup')) return
      setPopup(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPopup(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [popup])

  useLayoutEffect(() => {
    if (!popup) return
    const el = popupRef.current
    if (!el) return
    const margin = 8
    const gap = 6
    const width = el.offsetWidth
    const height = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.max(margin, Math.min(popup.left, vw - width - margin))
    let top = popup.bottom + gap
    if (top + height > vh - margin && popup.top - gap - height >= margin) {
      top = popup.top - gap - height
    } else {
      top = Math.max(margin, Math.min(top, vh - height - margin))
    }
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [popup])

  function handleScroll(e: React.UIEvent<HTMLDivElement>): void {
    const idx = Math.min(
      timeline.days.length - 1,
      Math.max(0, Math.floor(e.currentTarget.scrollLeft / dayWidth))
    )
    const label = MONTHS[timeline.days[idx].getMonth()]
    setCurrentMonth((prev) => (prev === label ? prev : label))
  }

  function commitDrag(session: DragSession, deltaDays: number): void {
    let start: string | null = session.planStart
    let end: string | null = session.planEnd
    if (session.mode === 'move') {
      start = formatDate(addDays(parseDate(session.planStart), deltaDays))
      end = formatDate(addDays(parseDate(session.planEnd), deltaDays))
    } else if (session.mode === 'start') {
      start = formatDate(addDays(parseDate(session.planStart), deltaDays))
    } else {
      end = formatDate(addDays(parseDate(session.planEnd), deltaDays))
    }
    onResize(session.id, start, end, session.mode)
  }

  function startDrag(e: React.PointerEvent, task: ScheduleTask, mode: DragMode): void {
    if (e.button !== 0) return
    if (!task.planStart || !task.planEnd) return
    e.preventDefault()
    e.stopPropagation()
    const startOffset = dayOffset(timeline, task.planStart)
    const endOffset = dayOffset(timeline, task.planEnd)
    const widthDays = endOffset - startOffset + 1
    const session: DragSession = {
      id: task.id,
      mode,
      planStart: task.planStart,
      planEnd: task.planEnd,
      startOffset,
      widthDays,
      startClientX: e.clientX
    }
    setDrag({ id: task.id, mode, startOffset, widthDays, deltaDays: 0 })

    const onMove = (ev: PointerEvent): void => {
      const raw = Math.round((ev.clientX - session.startClientX) / dayWidth)
      const clamped = clampDelta(
        session.mode,
        session.startOffset,
        session.widthDays,
        raw,
        timeline.days.length
      )
      setDrag({
        id: session.id,
        mode: session.mode,
        startOffset: session.startOffset,
        widthDays: session.widthDays,
        deltaDays: clamped
      })
    }
    const onUp = (ev: PointerEvent): void => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      dragCleanup.current = null
      const raw = Math.round((ev.clientX - session.startClientX) / dayWidth)
      const clamped = clampDelta(
        session.mode,
        session.startOffset,
        session.widthDays,
        raw,
        timeline.days.length
      )
      setDrag(null)
      if (clamped !== 0) commitDrag(session, clamped)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    dragCleanup.current = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }

  function openPopupFromBar(e: React.MouseEvent, task: ScheduleTask): void {
    e.preventDefault()
    const barEl = (e.currentTarget as HTMLElement).closest('.gantt-bar') as HTMLElement | null
    const rect = barEl?.getBoundingClientRect()
    if (!rect) return
    setPopup({ id: task.id, left: rect.left, top: rect.top, bottom: rect.bottom })
  }

  function renderRow(task: ScheduleTask, no: string, depth: number): React.JSX.Element {
    const isParent = task.children.length > 0
    const isCollapsed = collapsed.has(task.id)
    const hasDates = !!task.planStart && !!task.planEnd
    const canSetDates = !isParent && !task.planStart && !task.planEnd
    const startOffset = hasDates ? dayOffset(timeline, task.planStart!) : null
    const barWidth = hasDates
      ? (dayOffset(timeline, task.planEnd!) - startOffset! + 1) * dayWidth
      : 0
    let barLeft = 0
    let barW = 0
    if (hasDates && startOffset !== null) {
      barLeft = startOffset * dayWidth
      barW = barWidth
      if (drag?.id === task.id) {
        const d = drag.deltaDays
        if (drag.mode === 'move') {
          barLeft = (drag.startOffset + d) * dayWidth
          barW = drag.widthDays * dayWidth
        } else if (drag.mode === 'start') {
          barLeft = (drag.startOffset + d) * dayWidth
          barW = (drag.widthDays - d) * dayWidth
        } else {
          barLeft = drag.startOffset * dayWidth
          barW = (drag.widthDays + d) * dayWidth
        }
      }
    }
    return (
      <div key={task.id} className="gantt-task-group">
        <div className="gantt-row" style={{ width: leftWidth + timelineWidth }}>
          <div className="gantt-row-left" style={{ width: leftWidth }}>
            <div className="gantt-col-toggle">
              {isParent ? (
                <button
                  className="icon-btn small planner-toggle"
                  title={isCollapsed ? 'Expand' : 'Collapse'}
                  onClick={() => onToggle(task.id)}
                >
                  <MdiIcon path={isCollapsed ? mdiChevronRight : mdiChevronDown} size={15} />
                </button>
              ) : (
                <span className="planner-toggle-spacer" />
              )}
            </div>
            <div className="gantt-col-no">{no}</div>
            <div
              className={`gantt-col-title${isParent ? ' gantt-title-parent' : ''}${
                canSetDates ? ' gantt-title-dim' : ''
              }`}
              style={{ paddingLeft: depth * 14 }}
            >
              {task.title || (isParent ? 'Group task' : 'Task title')}
            </div>
          </div>
          <div
            className="gantt-row-grid"
            style={{ width: timelineWidth }}
            title={hasDates ? undefined : `${no} ${task.title || ''}\nNo plan dates set`}
          >
            {timeline.days.map((day) => (
              <div
                key={formatDate(day)}
                className={`gantt-day-cell${isWorkingDay(day, calendar) ? '' : ' gantt-nonwork'}${
                  canSetDates ? ' gantt-day-cell-settable' : ''
                }${formatDate(day) === todayKey ? ' gantt-today' : ''}`}
                style={{ width: dayWidth }}
                title={canSetDates ? `Set plan start & end to ${formatDate(day)}` : undefined}
                onClick={canSetDates ? () => onSetDates(task.id, formatDate(day)) : undefined}
              />
            ))}
            {hasDates && (
              <div
                className={`gantt-bar${isParent ? ' gantt-bar-parent' : ' gantt-bar-leaf'}`}
                style={{ left: barLeft, width: barW }}
                onPointerDown={isParent ? undefined : (e) => startDrag(e, task, 'move')}
                onContextMenu={(e) => openPopupFromBar(e, task)}
              >
                {isParent ? (
                  <>
                    <span className="gantt-bar-arrow gantt-bar-arrow-left" />
                    <span className="gantt-bar-arrow gantt-bar-arrow-right" />
                  </>
                ) : (
                  <>
                    <span
                      className="gantt-bar-handle gantt-bar-handle-left"
                      onPointerDown={(e) => startDrag(e, task, 'start')}
                    />
                    <span
                      className="gantt-bar-handle gantt-bar-handle-right"
                      onPointerDown={(e) => startDrag(e, task, 'end')}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {isParent && (
          <div className={`gantt-children-collapse${isCollapsed ? '' : ' open'}`}>
            <div className="gantt-children-collapse-inner">
              {renderTree(task.children, no, depth + 1)}
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderTree(
    list: ScheduleTask[],
    parentNo: string | null,
    depth: number
  ): React.JSX.Element[] {
    return list.map((task, i) => renderRow(task, deriveTaskNo(parentNo, i), depth))
  }

  const popupTask = popup ? taskMap.get(popup.id) : undefined
  const popupNo = popup ? (noMap.get(popup.id) ?? '') : ''
  const popupDuration = popupTask ? formatDuration(popupTask, calendar) : 0

  return (
    <div className="gantt-chart">
      <div className="gantt-body" ref={bodyRef} onScroll={handleScroll}>
        <div className="gantt-header" style={{ width: leftWidth + timelineWidth }}>
          <div className="gantt-header-left" style={{ width: leftWidth }}>
            <div className="gantt-col-toggle" />
            <div className="gantt-col-no">No.</div>
            <div className="gantt-col-title">Title</div>
          </div>
          <div className="gantt-header-days" style={{ width: timelineWidth }}>
            <div className="gantt-month-band">
              <div className="gantt-month-current" style={{ left: leftWidth }}>
                {currentMonth}
              </div>
              {months.map((month) => (
                <div
                  key={month.key}
                  className="gantt-month-head"
                  style={{ width: month.dayCount * dayWidth, left: month.left }}
                >
                  {month.label}
                </div>
              ))}
            </div>
            <div className="gantt-day-band">
              {timeline.days.map((day) => (
                <div
                  key={formatDate(day)}
                  className={`gantt-day-head${isWorkingDay(day, calendar) ? '' : ' gantt-nonwork'}${
                    formatDate(day) === todayKey ? ' gantt-today' : ''
                  }${dayWidth <= 12 ? ' gantt-day-head-compact' : ''}`}
                  style={{ width: dayWidth }}
                >
                  <div className="gantt-day-weekday">
                    {dayWidth <= 12 ? WEEKDAYS[day.getDay()][0] : WEEKDAYS[day.getDay()]}
                  </div>
                  {dayWidth > 12 || day.getDay() === 1 ? (
                    <div className="gantt-day-date">{day.getDate()}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        {renderTree(tasks, null, 0)}
      </div>
      {popup && popupTask && (
        <div
          ref={popupRef}
          className="gantt-popup"
          style={{ left: popup.left, top: popup.bottom + 6 }}
        >
          <div className="gantt-popup-title">
            <span className="gantt-popup-name">
              {popupNo}{' '}
              {popupTask.title || (popupTask.children.length > 0 ? 'Group task' : 'Task title')}
            </span>
            <button className="icon-btn small" onClick={() => setPopup(null)}>
              <MdiIcon path={mdiClose} size={14} />
            </button>
          </div>
          <div className="gantt-popup-row">
            <span className="gantt-popup-label">Plan Start</span>
            <span className="gantt-popup-value">{popupTask.planStart ?? '—'}</span>
          </div>
          <div className="gantt-popup-row">
            <span className="gantt-popup-label">Plan End</span>
            <span className="gantt-popup-value">{popupTask.planEnd ?? '—'}</span>
          </div>
          <div className="gantt-popup-row">
            <span className="gantt-popup-label">Duration</span>
            <span className="gantt-popup-value">
              {popupDuration} working day{popupDuration === 1 ? '' : 's'}
            </span>
          </div>
          {popupTask.children.length === 0 && !!popupTask.planStart && !!popupTask.planEnd && (
            <div className="gantt-popup-actions">
              <button
                className="btn small danger"
                onClick={() => {
                  onClearPlan(popupTask.id)
                  setPopup(null)
                }}
              >
                <MdiIcon path={mdiCalendarRemove} size={14} /> Clear Plan
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
