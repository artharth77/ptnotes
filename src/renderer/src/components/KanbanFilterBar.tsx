import { useState } from 'react'
import { mdiLabelOutline } from '@mdi/js'
import { MdiIcon } from './MdiIcon'
import {
  isKanbanFilterActive,
  matchesKanbanFilter,
  emptyKanbanCardFilter,
  type KanbanBoard,
  type KanbanCardFilter,
  type KanbanDueFilter,
  type KanbanPriority
} from '@shared/kanban'

const DUE_OPTIONS: { value: KanbanDueFilter; label: string }[] = [
  { value: 'any', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week1', label: 'Next 7 days' },
  { value: 'week2', label: 'Next 14 days' },
  { value: 'month1', label: 'Next 30 days' },
  { value: 'none', label: 'No due date' }
]

const PRIORITY_OPTIONS: { value: KanbanPriority | 'any'; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' }
]

export function KanbanFilterBar({
  kanban,
  filter,
  onChange
}: {
  kanban: KanbanBoard
  filter: KanbanCardFilter
  onChange: (filter: KanbanCardFilter) => void
}): React.JSX.Element {
  const [labelPopupOpen, setLabelPopupOpen] = useState(false)
  const [popupQuery, setPopupQuery] = useState('')
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false)
  const [assigneeActive, setAssigneeActive] = useState(0)

  const boardAssignees = Array.from(new Set(kanban.cards.map((c) => c.assignee.trim()))).filter(
    Boolean
  )
  const aq = filter.assignee.trim().toLowerCase()
  const assigneeSuggestions = boardAssignees
    .filter((a) => a.toLowerCase() !== aq)
    .filter((a) => aq === '' || a.toLowerCase().includes(aq))
    .slice(0, 8)

  const boardLabels = Array.from(new Set(kanban.cards.flatMap((c) => c.labels)))
    .map((l) => l.trim())
    .filter(Boolean)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  const pq = popupQuery.trim().toLowerCase()
  const visibleLabels = boardLabels.filter((l) => pq === '' || l.toLowerCase().includes(pq))

  const active = isKanbanFilterActive(filter)
  const matched = active
    ? kanban.cards.filter((c) => matchesKanbanFilter(c, filter)).length
    : kanban.cards.length

  function setAssignee(value: string): void {
    onChange({ ...filter, assignee: value })
    setAssigneeMenuOpen(false)
    setAssigneeActive(0)
  }

  function toggleLabel(value: string): void {
    const lower = value.toLowerCase()
    onChange(
      filter.labels.some((l) => l.toLowerCase() === lower)
        ? { ...filter, labels: filter.labels.filter((l) => l.toLowerCase() !== lower) }
        : { ...filter, labels: [...filter.labels, value] }
    )
  }

  function clear(): void {
    onChange({ ...emptyKanbanCardFilter, labels: [] })
    setLabelPopupOpen(false)
    setPopupQuery('')
    setAssigneeMenuOpen(false)
    setAssigneeActive(0)
  }

  function onAssigneeKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    const options = assigneeSuggestions
    if (e.key === 'Enter') {
      if (assigneeMenuOpen && options.length > 0) {
        e.preventDefault()
        setAssignee(options[assigneeActive] ?? filter.assignee)
      }
      return
    }
    if (e.key === 'Escape') {
      setAssigneeMenuOpen(false)
      return
    }
    if (assigneeMenuOpen && options.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAssigneeActive((prev) => (prev + 1) % options.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAssigneeActive((prev) => (prev - 1 + options.length) % options.length)
      }
    }
  }

  function onLabelKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') setLabelPopupOpen(false)
  }

  return (
    <div className="kanban-filter-bar">
      <div className="kanban-filter-item kanban-filter-search">
        <input
          type="text"
          className="note-filter"
          placeholder="Filter title or description"
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
        />
        {filter.query && (
          <button
            className="note-filter-clear"
            title="Clear filter"
            onClick={() => onChange({ ...filter, query: '' })}
          >
            ✕
          </button>
        )}
      </div>

      <div className="kanban-filter-item kanban-filter-assignee">
        <input
          type="text"
          className="note-filter"
          placeholder="Assignee"
          value={filter.assignee}
          onChange={(e) => {
            onChange({ ...filter, assignee: e.target.value })
            setAssigneeMenuOpen(true)
            setAssigneeActive(0)
          }}
          onFocus={() => setAssigneeMenuOpen(true)}
          onBlur={() => setAssigneeMenuOpen(false)}
          onKeyDown={onAssigneeKeyDown}
        />
        {filter.assignee && (
          <button
            className="note-filter-clear"
            title="Clear assignee"
            onClick={() => setAssignee('')}
          >
            ✕
          </button>
        )}
        {assigneeMenuOpen && assigneeSuggestions.length > 0 && (
          <div className="kanban-label-menu kanban-filter-menu">
            {assigneeSuggestions.map((a, i) => (
              <button
                key={a}
                className={`kanban-label-option${i === assigneeActive ? ' active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setAssignee(a)
                }}
                onMouseEnter={() => setAssigneeActive(i)}
              >
                {a}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="kanban-seg kanban-filter-seg">
        {PRIORITY_OPTIONS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`kanban-seg-btn${filter.priority === p.value ? ' active' : ''}`}
            onClick={() => onChange({ ...filter, priority: p.value })}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="kanban-filter-item kanban-filter-labels">
        <button
          type="button"
          className={`kanban-filter-label-btn${filter.labels.length > 0 ? ' active' : ''}`}
          title="Filter by labels — a card must have all selected labels"
          onClick={() => {
            setLabelPopupOpen((v) => !v)
            setPopupQuery('')
          }}
        >
          <MdiIcon path={mdiLabelOutline} size={14} />
          {filter.labels.length === 0
            ? 'No selected labels'
            : filter.labels.length === 1
              ? '1 label'
              : `${filter.labels.length} labels`}
        </button>
        {labelPopupOpen && (
          <>
            <div className="menu-overlay" onClick={() => setLabelPopupOpen(false)} />
            <div className="kanban-filter-popup">
              <input
                type="text"
                className="note-filter"
                placeholder="Filter labels"
                value={popupQuery}
                onChange={(e) => setPopupQuery(e.target.value)}
                onKeyDown={onLabelKeyDown}
                autoFocus
              />
              <div className="kanban-filter-popup-list">
                {visibleLabels.length === 0 && (
                  <div className="kanban-filter-popup-empty">
                    {boardLabels.length === 0 ? 'No labels on board' : 'No matching labels'}
                  </div>
                )}
                {visibleLabels.map((l) => {
                  const checked = filter.labels.some((x) => x.toLowerCase() === l.toLowerCase())
                  return (
                    <label key={l} className="kanban-filter-popup-option">
                      <input type="checkbox" checked={checked} onChange={() => toggleLabel(l)} />
                      {l}
                    </label>
                  )
                })}
              </div>
              {filter.labels.length > 0 && (
                <button
                  type="button"
                  className="kanban-filter-popup-clear"
                  onClick={() => onChange({ ...filter, labels: [] })}
                >
                  Clear selected
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <select
        className="kanban-filter-select"
        title="Filter by due date"
        value={filter.due}
        onChange={(e) => onChange({ ...filter, due: e.target.value as KanbanDueFilter })}
      >
        {DUE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {active && (
        <>
          <span className="kanban-filter-count" title="Matching cards / total cards">
            {matched}/{kanban.cards.length}
          </span>
          <button className="btn small" onClick={clear}>
            Clear
          </button>
        </>
      )}
    </div>
  )
}
