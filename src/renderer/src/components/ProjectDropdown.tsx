import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Modal, TextField } from './Modal'

export function ProjectDropdown(): React.JSX.Element {
  const projects = useAppStore((s) => s.projects)
  const activeProject = useAppStore((s) => s.activeProject)
  const selectProject = useAppStore((s) => s.selectProject)
  const createProject = useAppStore((s) => s.createProject)
  const recreateProject = useAppStore((s) => s.recreateProject)
  const renameProject = useAppStore((s) => s.renameProject)
  const deleteProject = useAppStore((s) => s.deleteProject)

  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [recreating, setRecreating] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const closeTimer = useRef<number | null>(null)
  const openRef = useRef(false)

  const closeDropdown = useCallback((): void => {
    if (!openRef.current) return
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 250)
  }, [])

  function toggleDropdown(): void {
    if (openRef.current) {
      closeDropdown()
    } else {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
      setOpen(true)
    }
  }

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) closeDropdown()
    }
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('mousedown', onClick)
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    }
  }, [open, closeDropdown])

  async function handleCreate(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    await createProject(trimmed)
    setName('')
    setCreating(false)
    closeDropdown()
  }

  async function handleRename(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || !renaming) return
    await renameProject(renaming, trimmed)
    setName('')
    setRenaming(null)
  }

  async function handleDelete(projectName: string): Promise<void> {
    if (window.confirm(`Delete project "${projectName}" and all its notes?`)) {
      await deleteProject(projectName)
    }
  }

  async function handleRecreate(projectName: string): Promise<void> {
    setRecreating(null)
    closeDropdown()
    await recreateProject(projectName)
  }

  const active = projects.find((p) => p.name === activeProject)
  const activeMissing = active ? !active.pathExists : false

  return (
    <div className="project-dropdown" ref={ref}>
      <button className="project-switcher" onClick={toggleDropdown}>
        <span className="project-icon">📁</span>
        <span className={`project-name ${activeMissing ? 'missing' : ''}`}>
          {activeProject ?? 'Select a project'}
        </span>
        <span className="chevron">{open ? '▲' : '▼'}</span>
      </button>

      {(open || closing) && (
        <div className={`dropdown-panel${closing ? ' closing' : ''}`}>
          <div className="dropdown-title">Projects</div>
          {projects.length === 0 && <div className="dropdown-empty">No projects yet</div>}
          {projects.map((p) => (
            <div
              key={p.name}
              className={`dropdown-item ${p.name === activeProject ? 'active' : ''} ${!p.pathExists ? 'missing' : ''}`}
              title={!p.pathExists ? 'Project path missing' : undefined}
              onClick={() => {
                if (!p.pathExists) {
                  setRecreating(p.name)
                  return
                }
                void selectProject(p.name)
                closeDropdown()
              }}
            >
              <span className="dropdown-item-name">
                {!p.pathExists && <span className="missing-icon">⚠️</span>}
                <span className="dropdown-item-label">{p.name}</span>
                <span className="dropdown-item-count">{p.noteCount}</span>
              </span>
              <span className="dropdown-actions">
                <button
                  className="icon-btn small"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation()
                    setName(p.name)
                    setRenaming(p.name)
                  }}
                >
                  ✎
                </button>
                <button
                  className="icon-btn small danger"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDelete(p.name)
                  }}
                >
                  🗑
                </button>
              </span>
            </div>
          ))}
          <button className="dropdown-new" onClick={() => setCreating(true)}>
            + New Project
          </button>
        </div>
      )}

      {creating && (
        <Modal title="New Project" onClose={() => setCreating(false)}>
          <TextField
            value={name}
            onChange={setName}
            onEnter={() => void handleCreate()}
            placeholder="Project name"
            autoFocus
          />
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
        <Modal title="Rename Project" onClose={() => setRenaming(null)}>
          <TextField
            value={name}
            onChange={setName}
            onEnter={() => void handleRename()}
            placeholder="New name"
            autoFocus
          />
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

      {recreating && (
        <Modal title="Project path missing" onClose={() => setRecreating(null)}>
          <p>
            The folder for <strong>{recreating}</strong> could not be found. Recreate a clean
            project path?
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setRecreating(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => void handleRecreate(recreating)}>
              Recreate
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
