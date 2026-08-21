import { useEffect, useRef, useState } from 'react'
import { mdiDotsVertical, mdiTrashCanOutline } from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { ModuleCard } from './ModuleCard'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'

const NO_RUNS: never[] = []

/** Sidebar tab that lists module runs for the active project with live status. */
export function ModulePanel(): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const runs = useAppStore((s) =>
    s.activeProject ? (s.moduleRuns[s.activeProject] ?? NO_RUNS) : NO_RUNS
  )
  const loadModules = useAppStore((s) => s.loadModules)
  const openSettings = useAppStore((s) => s.openSettings)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [deleteOutputFiles, setDeleteOutputFiles] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeProject) void loadModules(activeProject)
  }, [activeProject, loadModules])

  useEffect(() => {
    if (!menuOpen) return
    function onClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  function toggleMenu(e: React.MouseEvent): void {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuPos({ top: rect.bottom + 4, right: Math.max(0, window.innerWidth - rect.right) })
    setMenuOpen(true)
  }

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
        <button
          className="icon-btn todo-menu-btn"
          title="Module options"
          onClick={toggleMenu}
          aria-expanded={menuOpen}
        >
          <MdiIcon path={mdiDotsVertical} size={16} />
        </button>
      </div>
      {menuOpen && menuPos && (
        <>
          <div className="menu-overlay" onClick={() => setMenuOpen(false)} />
          <div
            ref={menuRef}
            className="note-menu"
            style={{ top: menuPos.top, right: menuPos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="note-menu-item danger"
              disabled={doneRuns.length === 0}
              title="Delete all finished module runs"
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
        </>
      )}
      <div className="list-scroll module-list-scroll">
        {runs.length === 0 && (
          <div className="list-empty">
            No module runs yet.
            <p className="module-hint">
              Ask the AI assistant to generate something (e.g. &quot;make a PowerPoint about…&quot;)
              and it will run in the background here.
            </p>
            <p className="module-hint">
              You can enable or disable modules in{' '}
              <button className="inline-link" onClick={() => openSettings('modules')}>
                Module settings
              </button>
              .
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
        <Modal title="Delete module history" onClose={() => setConfirmClear(false)}>
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
