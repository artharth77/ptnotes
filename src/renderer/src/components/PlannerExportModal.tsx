import { useState } from 'react'
import { Modal } from './Modal'
import { formatDate } from '@shared/planner'
import type { PlannerGanttMode, PlannerProgressMode } from '@shared/types'

export interface PlannerExportOptions {
  progressDate: string
  progressMode: PlannerProgressMode
  ganttMode: PlannerGanttMode
}

const PROGRESS_OPTIONS: Array<{ value: PlannerProgressMode; label: string; desc: string }> = [
  { value: 'percent', label: 'Progress', desc: 'Write "Progress: N%" to the sheet' },
  {
    value: 'percent-plan',
    label: 'Progress + plan',
    desc: 'Write "Progress: N% (plan M%)" using the estimate for the planner date'
  }
]

const GANTT_OPTIONS: Array<{ value: PlannerGanttMode; label: string; desc: string }> = [
  { value: 'none', label: 'None', desc: 'Table only, no timeline' },
  { value: 'day', label: 'Day', desc: 'One column per day' },
  { value: 'week', label: 'Week', desc: 'One column per week (W1, W2, …)' }
]

export function PlannerExportModal({
  onClose,
  onExport
}: {
  onClose: () => void
  onExport: (opts: PlannerExportOptions) => void
}): React.JSX.Element {
  const [date, setDate] = useState(formatDate(new Date()))
  const [progressMode, setProgressMode] = useState<PlannerProgressMode>('percent-plan')
  const [ganttMode, setGanttMode] = useState<PlannerGanttMode>('day')

  return (
    <Modal title="Export to Excel" onClose={onClose}>
      <div className="form-label">
        Planner date
        <input
          type="date"
          className="text-field"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
          Highlights the planner date in the Gantt and is written to the sheet.
        </p>
      </div>
      <div className="form-label">
        Progress line
        <div className="seg block" role="radiogroup" aria-label="Progress line">
          {PROGRESS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="radio"
              aria-checked={progressMode === opt.value}
              className={`seg-btn${progressMode === opt.value ? ' active' : ''}`}
              onClick={() => setProgressMode(opt.value)}
              title={opt.desc}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-label">
        Gantt chart
        <div className="seg block" role="radiogroup" aria-label="Gantt chart">
          {GANTT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="radio"
              aria-checked={ganttMode === opt.value}
              className={`seg-btn${ganttMode === opt.value ? ' active' : ''}`}
              onClick={() => setGanttMode(opt.value)}
              title={opt.desc}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!date}
          onClick={() => onExport({ progressDate: date, progressMode, ganttMode })}
        >
          Export
        </button>
      </div>
    </Modal>
  )
}
