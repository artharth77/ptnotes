import { useRef, useState } from 'react'
import {
  mdiArchiveArrowDownOutline,
  mdiArchiveArrowUpOutline,
  mdiArrowDown,
  mdiArrowUp,
  mdiChevronDown,
  mdiChevronRight,
  mdiDrag,
  mdiEyeOutline,
  mdiMinus,
  mdiPencilOutline,
  mdiPlus,
  mdiTarget,
  mdiTrashCanOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { Modal, TextField } from './Modal'
import { MdiIcon } from './MdiIcon'
import { useFlip } from './useFlip'
import { slugify } from '@shared/slug'
import {
  formatDueDate,
  isOverdue,
  KANBAN_COLUMN_COLORS,
  type KanbanCard,
  type KanbanPriority
} from '@shared/kanban'

const PRIORITY_ICONS: Record<KanbanPriority, string> = {
  low: mdiArrowDown,
  medium: mdiMinus,
  high: mdiArrowUp
}

interface MenuState {
  kind: 'card' | 'column' | 'archived'
  id: string
  x: number
  y: number
}

export function KanbanPanel(): React.JSX.Element {
  const kanban = useAppStore((s) => s.kanban)
  const kanbanArchive = useAppStore((s) => s.kanbanArchive)
  const kanbanListView = useAppStore((s) => s.kanbanListView)
  const activeCardId = useAppStore((s) => s.activeKanbanCardId)
  const kanbanCollapsed = useAppStore((s) => s.kanbanCollapsed)
  const addKanbanColumn = useAppStore((s) => s.addKanbanColumn)
  const updateKanbanColumn = useAppStore((s) => s.updateKanbanColumn)
  const moveKanbanColumn = useAppStore((s) => s.moveKanbanColumn)
  const deleteKanbanColumn = useAppStore((s) => s.deleteKanbanColumn)
  const moveKanbanCard = useAppStore((s) => s.moveKanbanCard)
  const deleteKanbanCard = useAppStore((s) => s.deleteKanbanCard)
  const setKanbanListView = useAppStore((s) => s.setKanbanListView)
  const archiveKanbanCard = useAppStore((s) => s.archiveKanbanCard)
  const restoreKanbanCard = useAppStore((s) => s.restoreKanbanCard)
  const deleteArchivedKanbanCard = useAppStore((s) => s.deleteArchivedKanbanCard)
  const setActiveKanbanCard = useAppStore((s) => s.setActiveKanbanCard)
  const openKanbanEditor = useAppStore((s) => s.openKanbanEditor)
  const openKanbanViewer = useAppStore((s) => s.openKanbanViewer)
  const openKanbanCreate = useAppStore((s) => s.openKanbanCreate)
  const toggleKanbanColumn = useAppStore((s) => s.toggleKanbanColumn)

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [editColumn, setEditColumn] = useState<{
    id: string
    title: string
    color: string | null
    highlightOverdue: boolean
  } | null>(null)
  const [editColumnError, setEditColumnError] = useState<string | null>(null)
  const [addColumnOpen, setAddColumnOpen] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')
  const [newColumnColor, setNewColumnColor] = useState<string | null>(null)
  const [newColumnHighlightOverdue, setNewColumnHighlightOverdue] = useState(true)
  const [columnError, setColumnError] = useState<string | null>(null)
  const [deleteColumn, setDeleteColumn] = useState<{
    id: string
    title: string
    cardCount: number
  } | null>(null)
  const [deleteColumnMode, setDeleteColumnMode] = useState<'move' | 'delete'>('move')
  const [deleteCard, setDeleteCard] = useState<KanbanCard | null>(null)
  const [deleteArchived, setDeleteArchived] = useState<KanbanCard | null>(null)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const [dragColId, setDragColId] = useState<string | null>(null)
  const [overColId, setOverColId] = useState<string | null>(null)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const listRef = useRef<HTMLDivElement>(null)
  useFlip(rowRefs, listRef)

  if (!kanban) return <div className="kanban-panel" />

  function openMenu(kind: 'card' | 'column' | 'archived', id: string, e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ kind, id, x: e.clientX, y: e.clientY })
  }

  function applyEditColumn(): void {
    if (!kanban || !editColumn) return
    const trimmed = editColumn.title.trim()
    const slug = slugify(trimmed)
    if (!slug) {
      setEditColumnError('Enter a column name')
      return
    }
    if (kanban.columns.some((c) => c.id === slug && c.id !== editColumn.id)) {
      setEditColumnError(`A column named "${trimmed}" already exists`)
      return
    }
    void updateKanbanColumn(editColumn.id, {
      title: trimmed,
      color: editColumn.color,
      highlightOverdue: editColumn.highlightOverdue
    })
    setEditColumn(null)
    setEditColumnError(null)
  }

  function applyAddColumn(): void {
    if (!kanban) return
    const trimmed = newColumnTitle.trim()
    const slug = slugify(trimmed)
    if (!slug) {
      setColumnError('Enter a column name')
      return
    }
    if (kanban.columns.some((c) => c.id === slug)) {
      setColumnError(`A column named "${trimmed}" already exists`)
      return
    }
    void addKanbanColumn({
      title: trimmed,
      color: newColumnColor,
      highlightOverdue: newColumnHighlightOverdue
    })
    setAddColumnOpen(false)
    setNewColumnTitle('')
    setNewColumnColor(null)
    setNewColumnHighlightOverdue(true)
    setColumnError(null)
  }

  function applyDeleteColumn(): void {
    if (!kanban || !deleteColumn) return
    if (kanban.columns.length <= 4) return
    const target = kanban.columns.find((c) => c.id !== deleteColumn.id)
    if (!target) return
    void deleteKanbanColumn(deleteColumn.id, {
      mode: deleteColumnMode,
      targetColumnId: target.id
    })
    setDeleteColumn(null)
  }

  function applyDeleteCard(id: string): void {
    setDeleteCard(null)
    setRemovingIds((prev) => new Set(prev).add(id))
    setTimeout(() => {
      setRemovingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      void deleteKanbanCard(id)
    }, 200)
  }

  function applyMoveCard(cardId: string, columnId: string): void {
    if (!kanban) return
    const card = kanban.cards.find((c) => c.id === cardId)
    if (!card || card.columnId === columnId) return
    void moveKanbanCard(cardId, columnId)
    setMenu(null)
  }

  function moveColumn(colId: string, overColId: string): void {
    if (!kanban || colId === overColId) return
    const from = kanban.columns.findIndex((c) => c.id === colId)
    const over = kanban.columns.findIndex((c) => c.id === overColId)
    if (from === -1 || over === -1) return
    void moveKanbanColumn(colId, from < over ? over - 1 : over)
  }

  const menuCard = menu?.kind === 'card' ? kanban.cards.find((c) => c.id === menu.id) : null
  const menuArchivedCard =
    menu?.kind === 'archived' ? (kanbanArchive?.cards.find((c) => c.id === menu.id) ?? null) : null
  const menuColumn = menu?.kind === 'column' ? kanban.columns.find((c) => c.id === menu.id) : null
  const deleteColumnTarget = deleteColumn
    ? kanban.columns.find((c) => c.id !== deleteColumn.id)
    : null

  return (
    <div className="kanban-panel">
      <div className="list-header">
        <span>Kanban</span>
        {kanbanListView === 'active' && (
          <button
            className="icon-btn small"
            title="Add column"
            onClick={() => {
              setAddColumnOpen(true)
              setNewColumnTitle('')
              setNewColumnColor(null)
              setNewColumnHighlightOverdue(true)
              setColumnError(null)
            }}
          >
            <MdiIcon path={mdiPlus} size={16} />
          </button>
        )}
      </div>
      <div className="kanban-view-toggle view-toggle">
        <button
          type="button"
          className={`view-btn${kanbanListView === 'active' ? ' active' : ''}`}
          onClick={() => setKanbanListView('active')}
        >
          Active
        </button>
        <button
          type="button"
          className={`view-btn${kanbanListView === 'archived' ? ' active' : ''}`}
          onClick={() => setKanbanListView('archived')}
        >
          Archived
        </button>
      </div>
      {kanbanListView === 'archived' ? (
        <div className="list-scroll kanban-panel-scroll">
          {!kanbanArchive || kanbanArchive.cards.length === 0 ? (
            <div className="list-empty">No archived cards</div>
          ) : (
            kanbanArchive.cards.map((card) => (
              <div
                key={card.id}
                className="kanban-card-row kanban-archived-row"
                title={card.title}
                onDoubleClick={() => openKanbanViewer(card.id)}
                onContextMenu={(e) => openMenu('archived', card.id, e)}
              >
                <span className="kanban-card-row-title">{card.title}</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="list-scroll kanban-panel-scroll" ref={listRef}>
          {kanban.columns.length === 0 && <div className="list-empty">No columns yet</div>}
          {kanban.columns.map((col) => {
            const cards = kanban.cards.filter((c) => c.columnId === col.id)
            const collapsed = !!kanbanCollapsed[col.id]
            return (
              <div
                key={col.id}
                className={`kanban-col-section${dragColId ? ' dragging' : ''}${
                  overColId === col.id && dragColId !== col.id ? ' drag-over' : ''
                }`}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragColId && dragColId !== col.id) setOverColId(col.id)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  moveColumn(dragColId ?? '', col.id)
                  setOverColId(null)
                }}
              >
                <div
                  className="kanban-col-header"
                  onClick={() => toggleKanbanColumn(col.id)}
                  onContextMenu={(e) => openMenu('column', col.id, e)}
                >
                  <MdiIcon
                    path={collapsed ? mdiChevronRight : mdiChevronDown}
                    size={14}
                    className="kanban-col-chevron"
                  />
                  {col.color && (
                    <span className="kanban-col-swatch" style={{ background: col.color }} />
                  )}
                  <span className="kanban-col-title" title={col.title}>
                    {col.title}
                  </span>
                  <span className="kanban-col-count">{cards.length}</span>
                  <span
                    className="kanban-col-grip"
                    title="Drag to reorder column"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      setDragColId(col.id)
                    }}
                    onDragEnd={() => {
                      setDragColId(null)
                      setOverColId(null)
                    }}
                  >
                    <MdiIcon path={mdiDrag} size={14} />
                  </span>
                </div>
                {!collapsed &&
                  cards.map((card) => (
                    <div
                      key={card.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(card.id, el)
                        else rowRefs.current.delete(card.id)
                      }}
                      className={`kanban-card-row${card.id === activeCardId ? ' active' : ''}${
                        removingIds.has(card.id) ? ' removing' : ''
                      }`}
                      title={card.title}
                      onClick={() => setActiveKanbanCard(card.id)}
                      onDoubleClick={() => openKanbanEditor(card.id)}
                      onContextMenu={(e) => openMenu('card', card.id, e)}
                    >
                      {card.priority && (
                        <span
                          className={`kanban-priority kanban-priority-${card.priority}`}
                          title={`Priority: ${card.priority}`}
                        >
                          <MdiIcon path={PRIORITY_ICONS[card.priority]} size={12} />
                        </span>
                      )}
                      <span className="kanban-card-row-title">{card.title}</span>
                      {card.dueDate && (
                        <span
                          className={`kanban-due${
                            col.highlightOverdue && isOverdue(card.dueDate) ? ' overdue' : ''
                          }`}
                          title={card.dueDate}
                        >
                          {formatDueDate(card.dueDate)}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            )
          })}
        </div>
      )}

      {menu && (
        <>
          <div className="menu-overlay" onClick={() => setMenu(null)} />
          <div
            className="note-menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {menuCard && (
              <>
                <button
                  className="note-menu-item"
                  onClick={() => {
                    setActiveKanbanCard(menuCard.id)
                    setMenu(null)
                  }}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiTarget} size={16} />
                  </span>
                  Jump to card
                </button>
                <button
                  className="note-menu-item"
                  onClick={() => {
                    openKanbanEditor(menuCard.id)
                    setMenu(null)
                  }}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiPencilOutline} size={16} />
                  </span>
                  Edit
                </button>
                <button
                  className="note-menu-item"
                  onClick={() => {
                    void archiveKanbanCard(menuCard.id)
                    setMenu(null)
                  }}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiArchiveArrowDownOutline} size={16} />
                  </span>
                  Archive
                </button>
                <button
                  className="note-menu-item danger"
                  onClick={() => {
                    setDeleteCard(menuCard)
                    setMenu(null)
                  }}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiTrashCanOutline} size={16} />
                  </span>
                  Delete
                </button>
                <div className="note-menu-sep" />
                <div className="note-menu-label">Move to</div>
                {kanban.columns
                  .filter((c) => c.id !== menuCard.columnId)
                  .map((c) => (
                    <button
                      key={c.id}
                      className="note-menu-item sub"
                      onClick={() => applyMoveCard(menuCard.id, c.id)}
                    >
                      {c.title}
                    </button>
                  ))}
              </>
            )}
            {menuArchivedCard && (
              <>
                <button
                  className="note-menu-item"
                  onClick={() => {
                    openKanbanViewer(menuArchivedCard.id)
                    setMenu(null)
                  }}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiEyeOutline} size={16} />
                  </span>
                  View
                </button>
                <button
                  className="note-menu-item"
                  onClick={() => {
                    void restoreKanbanCard(menuArchivedCard.id)
                    setMenu(null)
                  }}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiArchiveArrowUpOutline} size={16} />
                  </span>
                  Restore
                </button>
                <button
                  className="note-menu-item danger"
                  onClick={() => {
                    setDeleteArchived(menuArchivedCard)
                    setMenu(null)
                  }}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiTrashCanOutline} size={16} />
                  </span>
                  Delete
                </button>
              </>
            )}
            {menuColumn && (
              <>
                <button
                  className="note-menu-item"
                  onClick={() => {
                    openKanbanCreate(menuColumn.id)
                    setMenu(null)
                  }}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiPlus} size={16} />
                  </span>
                  Add card
                </button>
                <button
                  className="note-menu-item"
                  onClick={() => {
                    setEditColumn({
                      id: menuColumn.id,
                      title: menuColumn.title,
                      color: menuColumn.color,
                      highlightOverdue: menuColumn.highlightOverdue
                    })
                    setEditColumnError(null)
                    setMenu(null)
                  }}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiPencilOutline} size={16} />
                  </span>
                  Edit column
                </button>
                <button
                  className="note-menu-item danger"
                  disabled={kanban.columns.length <= 4}
                  title={
                    kanban.columns.length <= 4 ? 'A board needs at least four columns' : undefined
                  }
                  onClick={() => {
                    const cardCount = kanban.cards.filter(
                      (c) => c.columnId === menuColumn.id
                    ).length
                    setDeleteColumn({ id: menuColumn.id, title: menuColumn.title, cardCount })
                    setDeleteColumnMode('move')
                    setMenu(null)
                  }}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiTrashCanOutline} size={16} />
                  </span>
                  Delete column
                </button>
              </>
            )}
          </div>
        </>
      )}

      {editColumn && (
        <Modal title="Edit column" onClose={() => setEditColumn(null)}>
          <TextField
            value={editColumn.title}
            onChange={(v) => setEditColumn({ ...editColumn, title: v })}
            onEnter={applyEditColumn}
            placeholder="Column name"
            autoFocus
          />
          <div className="kanban-color-picker">
            <button
              type="button"
              className={`kanban-color-swatch none${editColumn.color === null ? ' selected' : ''}`}
              title="No color"
              onClick={() => setEditColumn({ ...editColumn, color: null })}
            />
            {KANBAN_COLUMN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`kanban-color-swatch${editColumn.color === c ? ' selected' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => setEditColumn({ ...editColumn, color: c })}
              />
            ))}
          </div>
          <label className="kanban-col-option">
            <input
              type="checkbox"
              checked={editColumn.highlightOverdue}
              onChange={(e) => setEditColumn({ ...editColumn, highlightOverdue: e.target.checked })}
            />
            Highlight overdue cards
          </label>
          {editColumnError && <p className="form-error">{editColumnError}</p>}
          <div className="modal-actions">
            <button className="btn" onClick={() => setEditColumn(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={applyEditColumn}>
              Save
            </button>
          </div>
        </Modal>
      )}

      {addColumnOpen && (
        <Modal title="Add column" onClose={() => setAddColumnOpen(false)}>
          <TextField
            value={newColumnTitle}
            onChange={setNewColumnTitle}
            onEnter={applyAddColumn}
            placeholder="Column name"
            autoFocus
          />
          <div className="kanban-color-picker">
            <button
              type="button"
              className={`kanban-color-swatch none${newColumnColor === null ? ' selected' : ''}`}
              title="No color"
              onClick={() => setNewColumnColor(null)}
            />
            {KANBAN_COLUMN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`kanban-color-swatch${newColumnColor === c ? ' selected' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => setNewColumnColor(c)}
              />
            ))}
          </div>
          <label className="kanban-col-option">
            <input
              type="checkbox"
              checked={newColumnHighlightOverdue}
              onChange={(e) => setNewColumnHighlightOverdue(e.target.checked)}
            />
            Highlight overdue cards
          </label>
          {columnError && <p className="form-error">{columnError}</p>}
          <div className="modal-actions">
            <button className="btn" onClick={() => setAddColumnOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={applyAddColumn}>
              Add
            </button>
          </div>
        </Modal>
      )}

      {deleteColumn && (
        <Modal title="Delete column" onClose={() => setDeleteColumn(null)}>
          <p>
            Delete column “{deleteColumn.title}”
            {deleteColumn.cardCount > 0
              ? ` and its ${deleteColumn.cardCount} card${deleteColumn.cardCount === 1 ? '' : 's'}`
              : ''}
            ?
          </p>
          {deleteColumn.cardCount > 0 && (
            <div className="kanban-delete-options">
              <label>
                <input
                  type="radio"
                  name="kanban-delete-mode"
                  checked={deleteColumnMode === 'move'}
                  onChange={() => setDeleteColumnMode('move')}
                />
                Move cards to {deleteColumnTarget?.title ?? 'the first column'}
              </label>
              <label>
                <input
                  type="radio"
                  name="kanban-delete-mode"
                  checked={deleteColumnMode === 'delete'}
                  onChange={() => setDeleteColumnMode('delete')}
                />
                Delete cards
              </label>
            </div>
          )}
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeleteColumn(null)}>
              Cancel
            </button>
            <button className="btn danger" onClick={applyDeleteColumn}>
              Delete
            </button>
          </div>
        </Modal>
      )}

      {deleteCard && (
        <Modal title="Delete card" onClose={() => setDeleteCard(null)}>
          <p>Delete card “{deleteCard.title}”? This cannot be undone.</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeleteCard(null)}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => applyDeleteCard(deleteCard.id)}>
              Delete
            </button>
          </div>
        </Modal>
      )}

      {deleteArchived && (
        <Modal title="Delete archived card" onClose={() => setDeleteArchived(null)}>
          <p>Delete archived card “{deleteArchived.title}”? This cannot be undone.</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeleteArchived(null)}>
              Cancel
            </button>
            <button
              className="btn danger"
              onClick={() => {
                const id = deleteArchived.id
                setDeleteArchived(null)
                void deleteArchivedKanbanCard(id)
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
