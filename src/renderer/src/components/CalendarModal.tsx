import { useState } from 'react'
import { mdiPlus } from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'
import { defaultCalendar } from '@shared/planner'
import type { ProjectCalendar } from '@shared/types'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export function CalendarModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const calendar = useAppStore((s) => s.calendar)
  const saveCalendar = useAppStore((s) => s.saveCalendar)

  const [draft, setDraft] = useState<ProjectCalendar>(calendar ?? defaultCalendar())
  const [newHoliday, setNewHoliday] = useState('')

  function addHoliday(): void {
    if (!newHoliday) return
    setDraft((d) => ({
      ...d,
      holidays: d.holidays.includes(newHoliday)
        ? d.holidays
        : [...d.holidays, newHoliday].sort()
    }))
    setNewHoliday('')
  }

  function removeHoliday(date: string): void {
    setDraft((d) => ({ ...d, holidays: d.holidays.filter((h) => h !== date) }))
  }

  async function handleSave(): Promise<void> {
    await saveCalendar(draft)
    onClose()
  }

  return (
    <Modal title="Project Calendar" onClose={onClose}>
      <p className="hint">
        Working days drive plan start/end computation (parent rollups and date rules). Actual dates
        are never computed. Defaults to Monday–Friday with no holidays.
      </p>
      <div className="form-label">
        Week
        <div className="calendar-week-row">
          <select
            className="text-field calendar-select"
            value={draft.weekStart}
            onChange={(e) => setDraft((d) => ({ ...d, weekStart: Number(e.target.value) }))}
          >
            {WEEKDAYS.map((day, i) => (
              <option key={day} value={i}>
                {day}
              </option>
            ))}
          </select>
          <span className="calendar-week-to">to</span>
          <select
            className="text-field calendar-select"
            value={draft.weekEnd}
            onChange={(e) => setDraft((d) => ({ ...d, weekEnd: Number(e.target.value) }))}
          >
            {WEEKDAYS.map((day, i) => (
              <option key={day} value={i}>
                {day}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-label">
        Holidays
        <div className="calendar-holiday-add">
          <input
            type="date"
            className="text-field"
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addHoliday()
            }}
          />
          <button className="btn small" onClick={addHoliday} disabled={!newHoliday}>
            <MdiIcon path={mdiPlus} size={14} /> Add
          </button>
        </div>
        {draft.holidays.length === 0 && (
          <div className="calendar-holiday-list">
            <div className="list-empty">No holidays set</div>
          </div>
        )}
        {draft.holidays.length > 0 && (
          <div className="calendar-holiday-list">
            {draft.holidays.map((h) => (
              <div key={h} className="calendar-holiday-item">
                <span className="calendar-holiday-date">{h}</span>
                <button
                  className="icon-btn small danger"
                  title="Remove holiday"
                  onClick={() => removeHoliday(h)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void handleSave()}>
          Save
        </button>
      </div>
    </Modal>
  )
}
