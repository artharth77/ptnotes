import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'
import { nameTipFrom, NameTip, type NameTipState } from './NameTip'
import { ownerStats } from '@shared/planner'

export function PlannerResourcesModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const schedule = useAppStore((s) => s.scheduleContent)
  const tasks = schedule?.tasks ?? []
  const stats = ownerStats(tasks)
  const [tip, setTip] = useState<NameTipState | null>(null)

  /** Show the full name over a truncated name cell, at the very same spot. */
  const showNameTip = (e: React.MouseEvent<HTMLDivElement>, name: string): void =>
    setTip(nameTipFrom(e, name, 'planner-name-tip', 10, 7))

  return (
    <Modal title="Resources" onClose={onClose} className="planner-resources-modal">
      {stats.length === 0 ? (
        <p className="hint">
          No owners assigned yet. Add owners to tasks to see their workload here.
        </p>
      ) : (
        <div className="resources-grid-scroll" onScroll={() => setTip(null)}>
          <div className="resources-grid">
            <div className="resources-grid-row resources-grid-head">
              <div>Name</div>
              <div>Assigned</div>
              <div>Not Started</div>
              <div>In Progress</div>
              <div>Completed</div>
              <div>%Complete</div>
            </div>
            <div className="resources-grid-body">
              {stats.map((s) => (
                <div className="resources-grid-row" key={s.name.toLowerCase()}>
                  <div
                    onMouseEnter={(e) => showNameTip(e, s.name)}
                    onMouseLeave={() => setTip(null)}
                  >
                    {s.name}
                  </div>
                  <div>{s.assigned}</div>
                  <div>{s.notStarted}</div>
                  <div>{s.inProgress}</div>
                  <div>{s.completed}</div>
                  <div>{s.percentComplete}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <NameTip tip={tip} onDismiss={() => setTip(null)} />
    </Modal>
  )
}
