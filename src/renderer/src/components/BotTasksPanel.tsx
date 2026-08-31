import { useEffect, useState } from 'react'
import { mdiArrowLeft, mdiDotsVertical, mdiTrashCanOutline } from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { ModuleCard } from './ModuleCard'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'

const NO_RUNS: never[] = []

/** Bot background tasks — same layout as the Modules panel, filtered to bot-task runs. */
export function BotTasksPanel(): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const runs = useAppStore((s) =>
    activeProject ? (s.botTaskRuns[activeProject] ?? NO_RUNS) : NO_RUNS
  )
  const loadBotTasks = useAppStore((s) => s.loadBotTasks)
  const setRightView = useAppStore((s) => s.setRightView)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [deleteOutputFiles, setDeleteOutputFiles] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (activeProject) void loadBotTasks(activeProject)
  }, [activeProject, loadBotTasks])

  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent): void {
      const target = e.target as HTMLElement
      if (!target.closest('.gc-task-menu')) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const activeRuns = runs.filter((r) => !['done', 'failed', 'cancelled'].includes(r.status))
  const doneRuns = runs.filter((r) => ['done', 'failed', 'cancelled'].includes(r.status))

  async function clearHistory(): Promise<void> {
    if (!activeProject) return
    setClearing(true)
    try {
      await window.ptnotes.bots.clearTaskHistory(activeProject, deleteOutputFiles)
      await loadBotTasks(activeProject)
    } finally {
      setClearing(false)
      setConfirmClear(false)
      setDeleteOutputFiles(false)
    }
  }

  return (
    <div className="module-panel">
      <div className="list-header">
        <span className="gc-tasks-header">
          <button
            className="icon-btn"
            title="Back to group chat"
            onClick={() => setRightView('bots')}
          >
            <MdiIcon path={mdiArrowLeft} size={16} />
          </button>
          Bot Tasks
        </span>
        <button className="icon-btn" title="Task options" onClick={() => setMenuOpen(!menuOpen)}>
          <MdiIcon path={mdiDotsVertical} size={16} />
        </button>
      </div>
      {menuOpen && (
        <div className="note-menu gc-task-menu" style={{ top: 40, right: 8, position: 'absolute' }}>
          <button
            className="note-menu-item danger"
            disabled={doneRuns.length === 0}
            onClick={() => {
              setConfirmClear(true)
              setMenuOpen(false)
            }}
          >
            <span className="note-menu-icon">
              <MdiIcon path={mdiTrashCanOutline} size={16} />
            </span>
            Delete all
          </button>
        </div>
      )}
      <div className="list-scroll module-list-scroll">
        {runs.length === 0 && (
          <div className="list-empty">
            No background bot tasks yet.
            <p className="module-hint">
              When a bot in a group chat takes on work (or another bot assigns it), the task runs in
              the background here and the bot reports back in the chat.
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
        <Modal title="Delete task history" onClose={() => setConfirmClear(false)}>
          <p className="confirm-message">
            Delete all {doneRuns.length} finished bot tasks (done / failed / cancelled)? Active
            tasks are kept.
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
