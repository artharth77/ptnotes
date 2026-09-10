import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'
import {
  defaultCalendar,
  estimatePercentComplete,
  formatDate,
  rollupChildren
} from '@shared/planner'

export function PlannerEstimateModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const schedule = useAppStore((s) => s.scheduleContent)
  const calendar = useAppStore((s) => s.calendar)
  const [date, setDate] = useState(formatDate(new Date()))

  const tasks = schedule?.tasks ?? []
  const current = rollupChildren(tasks, calendar ?? defaultCalendar()).percentComplete
  const estimated = estimatePercentComplete(tasks, date)

  return (
    <Modal title="Estimate %Completed" onClose={onClose}>
      <p className="hint">
        Assumes every leaf task planned to finish on or before the estimate date is 100% complete;
        other leaves keep their entered value. Parents are duration-weighted averages.
      </p>
      <div className="form-label">
        Current %Complete
        <div className="estimate-value">{current}%</div>
      </div>
      <div className="form-label">
        Estimate date
        <input
          type="date"
          className="text-field"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <div className="form-label">
        Estimated %Complete
        <div className="estimate-value">{estimated}%</div>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
