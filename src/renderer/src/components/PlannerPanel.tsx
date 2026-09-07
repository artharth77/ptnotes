import { useEffect, useRef, useState } from 'react'
import {
  mdiContentCopy,
  mdiDotsVertical,
  mdiFolderOpenOutline,
  mdiPencil,
  mdiPlus,
  mdiRefresh,
  mdiTrashCanOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { friendlyError } from '../errors'
import { Modal, TextField } from './Modal'
import { MdiIcon } from './MdiIcon'

function formatDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function PlannerPanel(): React.JSX.Element {
  const schedules = useAppStore((s) => s.schedules)
  const activeScheduleId = useAppStore((s) => s.activeScheduleId)
  const selectSchedule = useAppStore((s) => s.selectSchedule)
  const createSchedule = useAppStore((s) => s.createSchedule)
  const renameSchedule = useAppStore((s) => s.renameSchedule)
  const duplicateSchedule = useAppStore((s) => s.duplicateSchedule)
  const deleteSchedule = useAppStore((s) => s.deleteSchedule)
  const refreshSchedules = useAppStore((s) => s.refreshSchedules)

  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [formError, setFormError] = useState('')
  const [filter, setFilter] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const filtered = schedules.filter((s) =>
    s.name.toLowerCase().includes(filter.trim().toLowerCase())
  )

  useEffect(() => {
    if (!menuFor) return
    function onClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null)
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenuFor(null)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuFor])

  async function handleCreate(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await createSchedule(trimmed)
      setName('')
      setFormError('')
      setCreating(false)
    } catch (e) {
      setFormError(friendlyError(e))
    }
  }

  async function handleRename(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || !renaming) return
    try {
      await renameSchedule(renaming, trimmed)
      setName('')
      setFormError('')
      setRenaming(null)
    } catch (e) {
      setFormError(friendlyError(e))
    }
  }

  async function doDelete(): Promise<void> {
    if (!confirmDeleteId) return
    await deleteSchedule(confirmDeleteId)
    setConfirmDeleteId(null)
  }

  const activeProject = useAppStore((s) => s.activeProject)

  async function handleReveal(id: string): Promise<void> {
    setMenuFor(null)
    if (activeProject) {
      await window.ptnotes.planner.reveal(activeProject, id)
    }
  }

  function openMenu(e: React.MouseEvent, id: string): void {
    e.stopPropagation()
    if (menuFor === id) {
      setMenuFor(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const menuW = 180
    const menuH = 168
    const x = Math.min(rect.right, window.innerWidth - menuW - 8)
    const y = Math.min(rect.bottom, window.innerHeight - menuH - 8)
    setMenuPos({ x: Math.max(8, x), y: Math.max(8, y) })
    setMenuFor(id)
  }

  return (
    <div className="note-list planner-panel">
      <div className="list-header">
        <div className="note-filter-wrap">
          <input
            type="text"
            className="note-filter"
            placeholder="Filter schedules"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              className="note-filter-clear"
              title="Clear filter"
              onClick={() => setFilter('')}
            >
              ✕
            </button>
          )}
        </div>
        <div className="note-header-actions">
          <button
            className="icon-btn refresh-btn"
            title="Refresh schedule list"
            onClick={() => void refreshSchedules()}
          >
            <MdiIcon path={mdiRefresh} size={16} />
          </button>
          <button
            className="icon-btn"
            title="New schedule"
            onClick={() => {
              setFormError('')
              setCreating(true)
            }}
          >
            <MdiIcon path={mdiPlus} size={16} />
          </button>
        </div>
      </div>
      <div className="list-scroll">
        {filtered.length === 0 && (
          <div className="list-empty">
            {schedules.length === 0 ? 'No schedules yet' : 'No matching schedules'}
          </div>
        )}
        {filtered.map((schedule) => (
          <div
            key={schedule.id}
            className={`note-item ${schedule.id === activeScheduleId ? 'active' : ''}`}
            onClick={() => void selectSchedule(schedule.id)}
            onContextMenu={(e) => openMenu(e, schedule.id)}
          >
            <span className="note-item-title">{schedule.name}</span>
            <span className="note-item-actions">
              <span className="note-item-meta">
                <span className="note-item-date">{formatDate(schedule.updatedAt)}</span>
                <span className="note-item-count">
                  {schedule.taskCount} task{schedule.taskCount === 1 ? '' : 's'}
                </span>
              </span>
              <button
                className="icon-btn small note-menu-btn"
                title="More actions"
                onClick={(e) => openMenu(e, schedule.id)}
              >
                <MdiIcon path={mdiDotsVertical} size={16} />
              </button>
            </span>
          </div>
        ))}
      </div>

      {menuFor && menuPos && (
        <>
          <div className="menu-overlay" onClick={() => setMenuFor(null)} />
          <div
            ref={menuRef}
            className="note-menu"
            style={{ left: menuPos.x, top: menuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const schedule = schedules.find((s) => s.id === menuFor)
              return (
                <>
                  <button
                    className="note-menu-item"
                    onClick={() => {
                      if (!schedule) return
                      setName(schedule.name)
                      setFormError('')
                      setRenaming(schedule.id)
                      setMenuFor(null)
                    }}
                  >
                    <span className="note-menu-icon">
                      <MdiIcon path={mdiPencil} size={15} />
                    </span>{' '}
                    Rename
                  </button>
                  <button className="note-menu-item" onClick={() => void handleReveal(menuFor)}>
                    <span className="note-menu-icon">
                      <MdiIcon path={mdiFolderOpenOutline} size={15} />
                    </span>{' '}
                    Show in Folder
                  </button>
                  <button
                    className="note-menu-item"
                    onClick={() => {
                      setMenuFor(null)
                      void duplicateSchedule(menuFor)
                    }}
                  >
                    <span className="note-menu-icon">
                      <MdiIcon path={mdiContentCopy} size={15} />
                    </span>{' '}
                    Duplicate
                  </button>
                  <button
                    className="note-menu-item danger"
                    onClick={() => {
                      setMenuFor(null)
                      setConfirmDeleteId(menuFor)
                    }}
                  >
                    <span className="note-menu-icon">
                      <MdiIcon path={mdiTrashCanOutline} size={15} />
                    </span>{' '}
                    Delete
                  </button>
                </>
              )
            })()}
          </div>
        </>
      )}

      {creating && (
        <Modal title="New Schedule" onClose={() => setCreating(false)}>
          <TextField
            value={name}
            onChange={setName}
            onEnter={() => void handleCreate()}
            placeholder="Schedule name"
            autoFocus
          />
          {formError && <p className="form-error">{formError}</p>}
          <div className="modal-actions">
            <button className="btn" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => void handleCreate()}
              disabled={!name.trim()}
            >
              Create
            </button>
          </div>
        </Modal>
      )}

      {renaming && (
        <Modal title="Rename Schedule" onClose={() => setRenaming(null)}>
          <p className="confirm-message">
            Rename file &quot;{renaming}.json&quot; — type the new name below.
          </p>
          <TextField
            value={name}
            onChange={setName}
            onEnter={() => void handleRename()}
            placeholder="New name"
            autoFocus
          />
          {formError && <p className="form-error">{formError}</p>}
          <div className="modal-actions">
            <button className="btn" onClick={() => setRenaming(null)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => void handleRename()}
              disabled={!name.trim()}
            >
              Rename
            </button>
          </div>
        </Modal>
      )}

      {confirmDeleteId && (
        <Modal title="Delete Schedule" onClose={() => setConfirmDeleteId(null)}>
          <p className="confirm-message">
            Delete schedule &quot;{confirmDeleteId}&quot;? This cannot be undone.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => void doDelete()}>
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
