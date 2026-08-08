import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { ModuleCard } from './ModuleCard'
import { Modal } from './Modal'

const NO_RUNS: never[] = []

/** Sidebar tab that lists module runs for the active project with live status. */
export function ModulePanel(): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const runs = useAppStore((s) =>
    s.activeProject ? (s.moduleRuns[s.activeProject] ?? NO_RUNS) : NO_RUNS
  )
  const loadModules = useAppStore((s) => s.loadModules)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [deleteOutputFiles, setDeleteOutputFiles] = useState(false)

  useEffect(() => {
    if (activeProject) void loadModules(activeProject)
  }, [activeProject, loadModules])

  const activeRuns = runs.filter((r) => !['done', 'failed', 'cancelled'].includes(r.status))
  const doneRuns = runs.filter((r) => ['done', 'failed', 'cancelled'].includes(r.status))

  async function clearHistory(): Promise<void> {
    if (!activeProject) return
    setClearing(true)
    try {
      await window.ptnotes.modules.clearHistory(activeProject, deleteOutputFiles)
      await loadModules(activeProject)
    } finally {
      setClearing(false)
      setConfirmClear(false)
      setDeleteOutputFiles(false)
    }
  }

  return (
    <div className="module-panel">
      <div className="list-header">
        <span>Modules</span>
        <div className="module-header-actions">
          {doneRuns.length > 0 && (
            <button
              className="btn small ghost danger module-clear-btn"
              title="Delete all finished module runs"
              onClick={() => setConfirmClear(true)}
            >
              Clear all
            </button>
          )}
        </div>
      </div>
      <div className="list-scroll module-list-scroll">
        {runs.length === 0 && (
          <div className="list-empty">
            No module runs yet.
            <p className="module-hint">
              Ask the AI assistant to generate something (e.g. &quot;make a PowerPoint about…&quot;)
              and it will run in the background here.
            </p>
          </div>
        )}
        {activeRuns.map((r) => (
          <ModuleCard key={r.runId} run={r} />
        ))}
        {doneRuns.length > 0 && <div className="module-section">History</div>}
        {doneRuns.map((r) => (
          <ModuleCard key={r.runId} run={r} />
        ))}
      </div>
      {confirmClear && (
        <Modal title="Clear module history" onClose={() => setConfirmClear(false)}>
          <p className="confirm-message">
            Delete all {doneRuns.length} finished module runs (done / failed / cancelled)? Active
            runs are kept.
          </p>
          <label className="confirm-checkbox">
            <input
              type="checkbox"
              checked={deleteOutputFiles}
              onChange={(e) => setDeleteOutputFiles(e.target.checked)}
            />
            Also delete related output files
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => void clearHistory()} disabled={clearing}>
              {clearing ? 'Deleting…' : 'Delete all'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
