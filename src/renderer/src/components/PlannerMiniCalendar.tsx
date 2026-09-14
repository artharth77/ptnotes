import { useEffect, useRef, useState } from 'react'
import { mdiCalendarMonth, mdiChevronLeft, mdiChevronRight, mdiClose } from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { defaultCalendar, formatDate, isWorkingDay } from '@shared/planner'
import { MdiIcon } from './MdiIcon'

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

function buildMonthCells(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const cells: (Date | null)[] = []
  for (let i = 0; i < first.getDay(); i++) cells.push(null)
  const days = new Date(year, month + 1, 0).getDate()
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d))
  while (cells.length < 42) cells.push(null)
  return cells
}

export function PlannerMiniCalendar(): React.JSX.Element {
  const calendar = useAppStore((s) => s.calendar) ?? defaultCalendar()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [yearPickerOpen, setYearPickerOpen] = useState(false)
  const activeYearRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (yearPickerOpen) activeYearRef.current?.scrollIntoView({ block: 'center' })
  }, [yearPickerOpen])

  const openCalendar = (): void => {
    const now = new Date()
    setView({ year: now.getFullYear(), month: now.getMonth() })
    setYearPickerOpen(false)
    setOpen(true)
  }

  const cells = buildMonthCells(view.year, view.month)
  const todayKey = formatDate(new Date())
  const yearMin = view.year - 10
  const yearMax = view.year + 10

  const shiftMonth = (delta: number): void => {
    setView((v) => {
      const m = v.month + delta
      if (m < 0) return { year: v.year - 1, month: 11 }
      if (m > 11) return { year: v.year + 1, month: 0 }
      return { ...v, month: m }
    })
  }

  const onWheel = (e: React.WheelEvent): void => {
    if (yearPickerOpen) return
    if (e.deltaY < 0) shiftMonth(-1)
    else if (e.deltaY > 0) shiftMonth(1)
  }

  return (
    <>
      {open && (
        <div className="planner-cal-popup" onWheel={onWheel}>
          <div className="planner-cal-head">
            <button
              className="icon-btn small planner-cal-nav"
              title="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              <MdiIcon path={mdiChevronLeft} size={16} />
            </button>
            <span className="planner-cal-title">
              {MONTH_NAMES[view.month]}{' '}
              <button
                className="planner-cal-year-btn"
                title="Pick year"
                onClick={() => setYearPickerOpen((o) => !o)}
              >
                {view.year}
              </button>
            </span>
            <button
              className="icon-btn small planner-cal-nav"
              title="Next month"
              onClick={() => shiftMonth(1)}
            >
              <MdiIcon path={mdiChevronRight} size={16} />
            </button>
            <button
              className="icon-btn small planner-cal-close"
              title="Close calendar"
              onClick={() => {
                setYearPickerOpen(false)
                setOpen(false)
              }}
            >
              <MdiIcon path={mdiClose} size={16} />
            </button>
          </div>
          <div className="planner-cal-body">
            <div className="planner-cal-weekdays">
              {WEEKDAY_LABELS.map((label, i) => (
                <span key={i} className="planner-cal-weekday">
                  {label}
                </span>
              ))}
            </div>
            <div className="planner-cal-grid">
              {cells.map((date, i) =>
                date ? (
                  <span
                    key={i}
                    className={`planner-cal-day ${
                      formatDate(date) === todayKey ? 'planner-cal-today' : ''
                    } ${!isWorkingDay(date, calendar) ? 'planner-cal-off' : ''}`}
                  >
                    {date.getDate()}
                  </span>
                ) : (
                  <span key={i} className="planner-cal-day planner-cal-empty" />
                )
              )}
            </div>
            <button
              className="planner-cal-today-btn"
              title="Go to current date"
              onClick={() => {
                const now = new Date()
                setView({ year: now.getFullYear(), month: now.getMonth() })
              }}
            >
              Today
            </button>
            {yearPickerOpen && (
              <div className="planner-cal-years">
                {Array.from({ length: yearMax - yearMin + 1 }, (_, i) => yearMax - i).map((y) => (
                  <button
                    key={y}
                    ref={y === view.year ? activeYearRef : undefined}
                    className={`planner-cal-year-item ${y === view.year ? 'active' : ''}`}
                    onClick={() => {
                      setView((v) => ({ ...v, year: y }))
                      setYearPickerOpen(false)
                    }}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <button
        className="planner-cal-fab"
        title="Calendar"
        onClick={() => (open ? setOpen(false) : openCalendar())}
      >
        <MdiIcon path={mdiCalendarMonth} size={18} />
      </button>
    </>
  )
}
