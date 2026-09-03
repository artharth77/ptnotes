import { useEffect, useMemo, useRef, useState } from 'react'
import {
  mdiArrowDown,
  mdiArrowUp,
  mdiDotsVertical,
  mdiFolderOpenOutline,
  mdiPencil,
  mdiRefresh,
  mdiSort,
  mdiStar,
  mdiStarOutline,
  mdiTrashCanOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { Modal, TextField } from './Modal'
import { MdiIcon } from './MdiIcon'
import { NOTE_TEMPLATES, getNoteTemplate } from '../noteTemplates'

function formatDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function NoteList(): React.JSX.Element {
  const notes = useAppStore((s) => s.notes)
  const activeProject = useAppStore((s) => s.activeProject)
  const activeNoteId = useAppStore((s) => s.activeNoteId)
  const notesSort = useAppStore((s) => s.notesSort)
  const notesSortDir = useAppStore((s) => s.notesSortDir)
  const selectNote = useAppStore((s) => s.selectNote)
  const createNote = useAppStore((s) => s.createNote)
  const saveNote = useAppStore((s) => s.saveNote)
  const renameNote = useAppStore((s) => s.renameNote)
  const deleteNote = useAppStore((s) => s.deleteNote)
  const refreshNotes = useAppStore((s) => s.refreshNotes)
  const setNotesSort = useAppStore((s) => s.setNotesSort)
  const toggleNotesSortDir = useAppStore((s) => s.toggleNotesSortDir)
  const toggleNoteStarred = useAppStore((s) => s.toggleNoteStarred)

  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string>('blank')
  const [filter, setFilter] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)

  const filteredAndSortedNotes = useMemo(() => {
    const filtered = notes.filter((note) =>
      note.name.toLowerCase().includes(filter.trim().toLowerCase())
    )
    const sortKey = notesSort
    const dirMul = notesSortDir === 'asc' ? 1 : -1
    const compare = (a: (typeof filtered)[number], b: (typeof filtered)[number]): number => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dirMul
      if (sortKey === 'created') return (a.createdAt - b.createdAt) * dirMul
      return (a.updatedAt - b.updatedAt) * dirMul
    }
    return [...filtered].sort(compare)
  }, [notes, filter, notesSort, notesSortDir])

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

  useEffect(() => {
    if (!sortMenuOpen) return
    function onClick(e: MouseEvent): void {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node))
        setSortMenuOpen(false)
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setSortMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [sortMenuOpen])

  async function handleCreate(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    const templateId = selectedTemplate
    await createNote(trimmed)
    const template = getNoteTemplate(templateId)
    if (template && template.id !== 'blank') {
      await saveNote(template.content(trimmed, new Date()))
    }
    setName('')
    setSelectedTemplate('blank')
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
    setConfirmDeleteId(id)
  }

  async function doDelete(): Promise<void> {
    if (!confirmDeleteId) return
    await deleteNote(confirmDeleteId)
    setConfirmDeleteId(null)
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
    const menuW = 180
    const menuH = 160
    const x = Math.min(rect.right, window.innerWidth - menuW - 8)
    const y = Math.min(rect.bottom, window.innerHeight - menuH - 8)
    setMenuPos({ x: Math.max(8, x), y: Math.max(8, y) })
    setMenuFor(id)
  }

  function toggleSortMenu(e: React.MouseEvent): void {
    e.stopPropagation()
    setSortMenuOpen((o) => !o)
  }

  const sortLabel = notesSort === 'name' ? 'Name' : notesSort === 'created' ? 'Created' : 'Modified'
  const dateKey = notesSort === 'created' ? 'createdAt' : 'updatedAt'

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
          <div style={{ position: 'relative' }}>
            <button
              className="icon-btn refresh-btn"
              title={`Sort by ${sortLabel} (${notesSortDir})`}
              onClick={toggleSortMenu}
            >
              <MdiIcon path={mdiSort} size={16} />
            </button>
            {sortMenuOpen && (
              <>
                <div className="menu-overlay" onClick={() => setSortMenuOpen(false)} />
                <div
                  ref={sortMenuRef}
                  className="note-menu"
                  style={{ right: 8, top: 36, width: 180 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {(['modified', 'created', 'name'] as const).map((k) => {
                    const active = notesSort === k
                    const label =
                      k === 'modified' ? 'Modified' : k === 'created' ? 'Created' : 'Name'
                    return (
                      <button
                        key={k}
                        className={`note-menu-item${active ? ' active' : ''}`}
                        onClick={() => {
                          if (active) {
                            toggleNotesSortDir()
                          } else {
                            setNotesSort(k)
                          }
                          setSortMenuOpen(false)
                        }}
                      >
                        <span className="note-menu-icon">
                          {active ? (
                            notesSortDir === 'asc' ? (
                              <MdiIcon path={mdiArrowUp} size={14} />
                            ) : (
                              <MdiIcon path={mdiArrowDown} size={14} />
                            )
                          ) : (
                            <span style={{ display: 'inline-block', width: 14 }} />
                          )}
                        </span>{' '}
                        {label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          <button
            className="icon-btn refresh-btn"
            title={`Sort direction: ${notesSortDir}. Click to flip.`}
            onClick={() => toggleNotesSortDir()}
          >
            <MdiIcon path={notesSortDir === 'asc' ? mdiArrowUp : mdiArrowDown} size={16} />
          </button>
          <button
            className="icon-btn refresh-btn"
            title="Refresh notes list"
            onClick={() => void refreshNotes()}
          >
            <MdiIcon path={mdiRefresh} size={16} />
          </button>
          <button className="btn small" onClick={() => setCreating(true)}>
            + New
          </button>
        </div>
      </div>
      <div className="list-scroll">
        {filteredAndSortedNotes.length === 0 && (
          <div className="list-empty">
            {notes.length === 0 ? 'No notes yet' : 'No matching notes'}
          </div>
        )}
        {filteredAndSortedNotes.map((note) => (
          <div
            key={note.id}
            className={`note-item ${note.id === activeNoteId ? 'active' : ''} ${note.starred ? 'starred' : ''}`}
            onClick={() => void selectNote(note.id)}
            onContextMenu={(e) => openMenu(e, note.id)}
          >
            <button
              className="icon-btn small note-star-btn"
              title={note.starred ? 'Unpin note' : 'Pin / Star note'}
              onClick={(e) => {
                e.stopPropagation()
                void toggleNoteStarred(note.id, !note.starred)
              }}
            >
              <MdiIcon
                path={note.starred ? mdiStar : mdiStarOutline}
                size={14}
                style={note.starred ? { color: 'var(--accent)' } : undefined}
              />
            </button>
            <span className="note-item-title">{note.name}</span>
            <span className="note-item-actions">
              <span className="note-item-date">{formatDate(note[dateKey])}</span>
              <button
                className="icon-btn small note-menu-btn"
                title="More actions"
                onClick={(e) => openMenu(e, note.id)}
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
              const note = notes.find((n) => n.id === menuFor)
              return (
                <>
                  <button
                    className="note-menu-item"
                    onClick={() => {
                      if (!note) return
                      void toggleNoteStarred(note.id, !note.starred)
                      setMenuFor(null)
                    }}
                  >
                    <span className="note-menu-icon">
                      <MdiIcon path={note?.starred ? mdiStar : mdiStarOutline} size={15} />
                    </span>{' '}
                    {note?.starred ? 'Unpin' : 'Pin / Star'}
                  </button>
                  <button
                    className="note-menu-item"
                    onClick={() => {
                      if (!note) return
                      setName(note.name)
                      setRenaming(note.id)
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
                    className="note-menu-item danger"
                    onClick={() => void handleDelete(menuFor)}
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
        <Modal
          title="New Note"
          onClose={() => {
            setCreating(false)
            setSelectedTemplate('blank')
          }}
        >
          <TextField
            value={name}
            onChange={setName}
            onEnter={() => void handleCreate()}
            placeholder="Note title"
            autoFocus
          />
          <div className="form-label" style={{ marginTop: 12, marginBottom: 6 }}>
            Template
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 8,
              maxHeight: 260,
              overflowY: 'auto',
              padding: 4
            }}
          >
            {NOTE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTemplate(t.id)}
                className={`note-template-card${selectedTemplate === t.id ? ' active' : ''}`}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  background: selectedTemplate === t.id ? 'var(--accent-soft)' : 'var(--bg)',
                  cursor: 'pointer',
                  color: 'var(--text)'
                }}
              >
                <div style={{ fontSize: 16, marginBottom: 2 }}>
                  <span style={{ marginRight: 6 }}>{t.icon}</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-dim)',
                    lineHeight: 1.4
                  }}
                >
                  {t.description}
                </div>
              </button>
            ))}
          </div>
          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                setCreating(false)
                setSelectedTemplate('blank')
              }}
            >
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

      {confirmDeleteId && (
        <Modal title="Delete Note" onClose={() => setConfirmDeleteId(null)}>
          <p className="confirm-message">
            Delete note &quot;{confirmDeleteId}&quot;? This cannot be undone.
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
