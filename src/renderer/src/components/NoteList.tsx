import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Modal, TextField } from './Modal'

function formatDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function NoteList(): React.JSX.Element {
  const notes = useAppStore((s) => s.notes)
  const activeProject = useAppStore((s) => s.activeProject)
  const activeNoteId = useAppStore((s) => s.activeNoteId)
  const selectNote = useAppStore((s) => s.selectNote)
  const createNote = useAppStore((s) => s.createNote)
  const renameNote = useAppStore((s) => s.renameNote)
  const deleteNote = useAppStore((s) => s.deleteNote)
  const refreshNotes = useAppStore((s) => s.refreshNotes)

  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [filter, setFilter] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const filteredNotes = notes.filter((note) =>
    note.name.toLowerCase().includes(filter.trim().toLowerCase())
  )

  useEffect(() => {
    if (!menuFor) return
    function onClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuFor])

  async function handleCreate(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    await createNote(trimmed)
    setName('')
    setCreating(false)
  }

  async function handleRename(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || !renaming) return
    await renameNote(renaming, trimmed)
    setName('')
    setRenaming(null)
  }

  async function handleDelete(id: string): Promise<void> {
    setMenuFor(null)
    if (window.confirm(`Delete note "${id}"?`)) {
      await deleteNote(id)
    }
  }

  async function handleReveal(id: string): Promise<void> {
    setMenuFor(null)
    if (activeProject) {
      await window.ptnotes.notes.reveal(activeProject, id)
    }
  }

  function openMenu(e: React.MouseEvent, id: string): void {
    e.stopPropagation()
    if (menuFor === id) {
      setMenuFor(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuPos({ x: rect.right, y: rect.bottom })
    setMenuFor(id)
  }

  return (
    <div className="note-list">
      <div className="list-header">
        <div className="note-filter-wrap">
          <input
            type="text"
            className="note-filter"
            placeholder="Filter notes"
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
            title="Refresh notes list"
            onClick={() => void refreshNotes()}
          >
            ⟳
          </button>
          <button className="btn small" onClick={() => setCreating(true)}>
            + New
          </button>
        </div>
      </div>
      <div className="list-scroll">
        {filteredNotes.length === 0 && (
          <div className="list-empty">
            {notes.length === 0 ? 'No notes yet' : 'No matching notes'}
          </div>
        )}
        {filteredNotes.map((note) => (
          <div
            key={note.id}
            className={`note-item ${note.id === activeNoteId ? 'active' : ''}`}
            onClick={() => void selectNote(note.id)}
          >
            <span className="note-item-title">{note.name}</span>
            <span className="note-item-actions">
              <span className="note-item-date">{formatDate(note.updatedAt)}</span>
              <button
                className="icon-btn small note-menu-btn"
                title="More actions"
                onClick={(e) => openMenu(e, note.id)}
              >
                ⋮
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
              const note = notes.find((n) => n.id === menuFor)
              return (
                <>
                  <button
                    className="note-menu-item"
                    onClick={() => {
                      if (!note) return
                      setName(note.name)
                      setRenaming(note.id)
                      setMenuFor(null)
                    }}
                  >
                    <span className="note-menu-icon">✎</span> Rename
                  </button>
                  <button className="note-menu-item" onClick={() => void handleReveal(menuFor)}>
                    <span className="note-menu-icon">📂</span> Show in Folder
                  </button>
                  <button
                    className="note-menu-item danger"
                    onClick={() => void handleDelete(menuFor)}
                  >
                    <span className="note-menu-icon">🗑</span> Delete
                  </button>
                </>
              )
            })()}
          </div>
        </>
      )}

      {creating && (
        <Modal title="New Note" onClose={() => setCreating(false)}>
          <TextField
            value={name}
            onChange={setName}
            onEnter={() => void handleCreate()}
            placeholder="Note title"
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
        <Modal title="Rename Note" onClose={() => setRenaming(null)}>
          <TextField
            value={name}
            onChange={setName}
            onEnter={() => void handleRename()}
            placeholder="New title"
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
    </div>
  )
}
