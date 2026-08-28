import { useEffect, useRef, useState } from 'react'
import {
  mdiArchiveArrowDownOutline,
  mdiArrowDown,
  mdiArrowUp,
  mdiDrag,
  mdiMinus,
  mdiPencilOutline,
  mdiPlus,
  mdiTrashCanOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { KanbanFilterBar } from './KanbanFilterBar'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'
import { useFlip } from './useFlip'
import {
  emptyKanbanCardFilter,
  formatDueDate,
  isKanbanFilterActive,
  isOverdue,
  matchesKanbanFilter,
  type KanbanBoard,
  type KanbanCard,
  type KanbanCardFilter,
  type KanbanPriority
} from '@shared/kanban'

const PRIORITY_ICONS: Record<KanbanPriority, string> = {
  low: mdiArrowDown,
  medium: mdiMinus,
  high: mdiArrowUp
}

export function KanbanBoard(): React.JSX.Element {
  const kanban = useAppStore((s) => s.kanban)
  const activeCardId = useAppStore((s) => s.activeKanbanCardId)
  const setActiveKanbanCard = useAppStore((s) => s.setActiveKanbanCard)
  const openKanbanEditor = useAppStore((s) => s.openKanbanEditor)
  const openKanbanCreate = useAppStore((s) => s.openKanbanCreate)
  const saveKanban = useAppStore((s) => s.saveKanban)
  const archiveKanbanCard = useAppStore((s) => s.archiveKanbanCard)

  const [dragId, setDragId] = useState<string | null>(null)
  const [dragColId, setDragColId] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [deleteCard, setDeleteCard] = useState<KanbanCard | null>(null)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<KanbanCardFilter>({ ...emptyKanbanCardFilter, labels: [] })
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  useFlip(cardRefs)

  useEffect(() => {
    if (!activeCardId) return
    cardRefs.current.get(activeCardId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    })
  }, [activeCardId])

  if (!kanban) {
    return (
      <div className="kanban-board">
        <div className="list-empty">No board yet</div>
      </div>
    )
  }

  function commit(board: KanbanBoard): void {
    void saveKanban(board)
  }

  function moveCard(cardId: string, toColumnId: string, beforeCardId: string | null): void {
    if (!kanban) return
    const card = kanban.cards.find((c) => c.id === cardId)
    if (!card) return
    const rest = kanban.cards.filter((c) => c.id !== cardId)
    const moved = { ...card, columnId: toColumnId }
    if (beforeCardId) {
      const idx = rest.findIndex((c) => c.id === beforeCardId)
      if (idx === -1) rest.push(moved)
      else rest.splice(idx, 0, moved)
    } else {
      let lastIdx = -1
      for (let i = rest.length - 1; i >= 0; i--) {
        if (rest[i]!.columnId === toColumnId) {
          lastIdx = i
          break
        }
      }
      if (lastIdx === -1) rest.push(moved)
      else rest.splice(lastIdx + 1, 0, moved)
    }
    commit({ ...kanban, cards: rest })
  }

  function moveColumn(colId: string, overColId: string): void {
    if (!kanban || colId === overColId) return
    const from = kanban.columns.findIndex((c) => c.id === colId)
    const over = kanban.columns.findIndex((c) => c.id === overColId)
    if (from === -1 || over === -1) return
    const columns = [...kanban.columns]
    const [moved] = columns.splice(from, 1)
    columns.splice(from < over ? over - 1 : over, 0, moved!)
    commit({ ...kanban, columns })
  }

  function endDrag(): void {
    setDragId(null)
    setDragColId(null)
    setOverKey(null)
  }

  function openMenu(cardId: string, e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ id: cardId, x: e.clientX, y: e.clientY })
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
      const latest = useAppStore.getState().kanban
      if (latest) commit({ ...latest, cards: latest.cards.filter((c) => c.id !== id) })
    }, 200)
  }

  const menuCard = menu ? kanban.cards.find((c) => c.id === menu.id) : null
  const filterActive = isKanbanFilterActive(filter)

  return (
    <div className="kanban-view">
      <KanbanFilterBar kanban={kanban} filter={filter} onChange={setFilter} />
      <div
        className="kanban-board"
        onClick={(e) => {
          if (activeCardId && !(e.target as HTMLElement).closest('.kanban-card')) {
            setActiveKanbanCard(null)
          }
        }}
      >
        {kanban.columns.map((col) => {
          const total = kanban.cards.filter((c) => c.columnId === col.id).length
          const cards = kanban.cards.filter(
            (c) => c.columnId === col.id && matchesKanbanFilter(c, filter)
          )
          const colKey = `col:${col.id}`
          return (
            <div
              key={col.id}
              className={`kanban-col${overKey === colKey ? ' drag-over' : ''}${
                dragColId === col.id ? ' dragging' : ''
              }`}
              style={
                col.color ? ({ '--kanban-col-color': col.color } as React.CSSProperties) : undefined
              }
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dragColId && dragColId === col.id) return
                if ((dragId || dragColId) && overKey !== colKey) setOverKey(colKey)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragColId) moveColumn(dragColId, col.id)
                else if (dragId) moveCard(dragId, col.id, null)
                endDrag()
              }}
            >
              <div className="kanban-col-head">
                <span
                  className="kanban-col-grip"
                  title="Drag to reorder column"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    setDragColId(col.id)
                  }}
                  onDragEnd={endDrag}
                >
                  <MdiIcon path={mdiDrag} size={16} />
                </span>
                <span className="kanban-col-name">{col.title}</span>
                <span
                  className="kanban-col-count"
                  title={filterActive ? `${total} total` : undefined}
                >
                  {cards.length}
                </span>
              </div>
              <div className="kanban-col-cards">
                {cards.length === 0 && (
                  <div className="kanban-col-empty">
                    {filterActive && total > 0 ? 'No matching cards' : 'No cards'}
                  </div>
                )}
                {cards.map((card) => (
                  <CardView
                    key={card.id}
                    card={card}
                    highlightOverdue={col.highlightOverdue}
                    active={card.id === activeCardId}
                    dragging={dragId === card.id}
                    over={overKey === `card:${card.id}`}
                    removing={removingIds.has(card.id)}
                    refCb={(el) => {
                      if (el) cardRefs.current.set(card.id, el)
                      else cardRefs.current.delete(card.id)
                    }}
                    onDragStart={() => setDragId(card.id)}
                    onDragOver={(e) => {
                      if (!dragId) return
                      e.preventDefault()
                      e.stopPropagation()
                      e.dataTransfer.dropEffect = 'move'
                      if (dragId !== card.id) setOverKey(`card:${card.id}`)
                    }}
                    onDrop={(e) => {
                      if (!dragId) return
                      e.preventDefault()
                      e.stopPropagation()
                      moveCard(dragId, col.id, card.id)
                      endDrag()
                    }}
                    onDragEnd={endDrag}
                    onClick={() => setActiveKanbanCard(card.id)}
                    onDoubleClick={() => openKanbanEditor(card.id)}
                    onContextMenu={(e) => openMenu(card.id, e)}
                  />
                ))}
                <button
                  className="kanban-col-add"
                  onClick={() => openKanbanCreate(col.id)}
                  onDragOver={(e) => {
                    if (!dragId) return
                    e.preventDefault()
                    e.stopPropagation()
                    e.dataTransfer.dropEffect = 'move'
                    setOverKey(colKey)
                  }}
                  onDrop={(e) => {
                    if (!dragId) return
                    e.preventDefault()
                    e.stopPropagation()
                    moveCard(dragId, col.id, null)
                    endDrag()
                  }}
                >
                  <MdiIcon path={mdiPlus} size={14} />
                  Add card
                </button>
              </div>
            </div>
          )
        })}

        {menu && menuCard && (
          <>
            <div
              className="menu-overlay"
              onClick={(e) => {
                e.stopPropagation()
                setMenu(null)
              }}
            />
            <div
              className="note-menu"
              style={{ left: menu.x, top: menu.y }}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
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
                    onClick={() => {
                      moveCard(menuCard.id, c.id, null)
                      setMenu(null)
                    }}
                  >
                    {c.title}
                  </button>
                ))}
            </div>
          </>
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
      </div>
    </div>
  )
}

function CardView({
  card,
  highlightOverdue,
  active,
  dragging,
  over,
  removing,
  refCb,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onClick,
  onDoubleClick,
  onContextMenu
}: {
  card: KanbanCard
  highlightOverdue: boolean
  active: boolean
  dragging: boolean
  over: boolean
  removing: boolean
  refCb: (el: HTMLDivElement | null) => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  onClick: () => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <div
      ref={refCb}
      className={`kanban-card${active ? ' active' : ''}${dragging ? ' dragging' : ''}${
        over ? ' drag-over' : ''
      }${removing ? ' removing' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div className="kanban-card-title">{card.title}</div>
      {card.description && <div className="kanban-card-desc">{card.description}</div>}
      <div className="kanban-card-meta">
        {card.priority && (
          <span
            className={`kanban-priority kanban-priority-${card.priority}`}
            title={`Priority: ${card.priority}`}
          >
            <MdiIcon path={PRIORITY_ICONS[card.priority]} size={12} />
          </span>
        )}
        {card.dueDate && (
          <span
            className={`kanban-due${highlightOverdue && isOverdue(card.dueDate) ? ' overdue' : ''}`}
          >
            {formatDueDate(card.dueDate)}
          </span>
        )}
        {card.storyPoints != null && <span className="kanban-pts">{card.storyPoints} pts</span>}
        {card.assignee && <span className="kanban-assignee">{card.assignee}</span>}
      </div>
      {card.labels.length > 0 && (
        <div className="kanban-card-labels">
          {card.labels.map((l) => (
            <span key={l} className="kanban-pill">
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
