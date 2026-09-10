import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'
import { ownerStats } from '@shared/planner'

export function PlannerResourcesModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const schedule = useAppStore((s) => s.scheduleContent)
  const tasks = schedule?.tasks ?? []
  const stats = ownerStats(tasks)

  return (
    <Modal title="Resources" onClose={onClose} className="planner-resources-modal">
      {stats.length === 0 ? (
        <p className="hint">
          No owners assigned yet. Add owners to tasks to see their workload here.
        </p>
      ) : (
        <div className="resources-grid-scroll">
          <table className="resources-grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Assigned</th>
                <th>Not Started</th>
                <th>In Progress</th>
                <th>Completed</th>
                <th>%Completed</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.name.toLowerCase()}>
                  <td>{s.name}</td>
                  <td>{s.assigned}</td>
                  <td>{s.notStarted}</td>
                  <td>{s.inProgress}</td>
                  <td>{s.completed}</td>
                  <td>{s.percentComplete}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
