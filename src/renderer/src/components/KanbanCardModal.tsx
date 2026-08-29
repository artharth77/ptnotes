import { useRef, useState } from 'react'
import {
  mdiArrowDown,
  mdiArrowUp,
  mdiClose,
  mdiKey,
  mdiMinus,
  mdiPencil,
  mdiPlus,
  mdiTrashCanOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'
import { MarkdownContent } from './MarkdownContent'
import { newCommentId, type KanbanCardComment, type KanbanPriority } from '@shared/kanban'
import { slugify } from '@shared/slug'

interface AttrDraft {
  key: string
  value: string
  secret: boolean
}

function withEditedComment(
  comments: KanbanCardComment[],
  id: string,
  text: string
): KanbanCardComment[] {
  return comments.map((c) => (c.id === id ? { ...c, comment: text } : c))
}

function withoutComment(comments: KanbanCardComment[], id: string): KanbanCardComment[] {
  return comments.filter((c) => c.id !== id)
}

function makeComment(text: string): KanbanCardComment {
  return { id: newCommentId(), comment: text, commentBy: 'you', timestamp: Date.now() }
}

/** Normalize a typed attribute key to dash format (e.g. "My API Key" → "my-api-key").
 * Keeps a trailing separator while typing so the next word stays separated; invalid input clears. */
function slugKeyInput(value: string): string {
  const slug = slugify(value)
  if (slug === 'untitled') return ''
  return /[\s_-]$/.test(value) ? `${slug}-` : slug
}

export function KanbanCardModal(): React.JSX.Element {
  const kanban = useAppStore((s) => s.kanban)
  const kanbanArchive = useAppStore((s) => s.kanbanArchive)
  const editingId = useAppStore((s) => s.kanbanEditingId)
  const viewingId = useAppStore((s) => s.kanbanViewingId)
  const creatingColumnId = useAppStore((s) => s.kanbanCreatingColumnId)
  const createKanbanCard = useAppStore((s) => s.createKanbanCard)
  const updateKanbanCard = useAppStore((s) => s.updateKanbanCard)
  const deleteKanbanCard = useAppStore((s) => s.deleteKanbanCard)
  const addKanbanComment = useAppStore((s) => s.addKanbanComment)
  const updateKanbanComment = useAppStore((s) => s.updateKanbanComment)
  const deleteKanbanComment = useAppStore((s) => s.deleteKanbanComment)
  const closeKanbanEditor = useAppStore((s) => s.closeKanbanEditor)
  const closeKanbanViewer = useAppStore((s) => s.closeKanbanViewer)
  const closeKanbanCreate = useAppStore((s) => s.closeKanbanCreate)

  const archivedCard = viewingId
    ? (kanbanArchive?.cards.find((c) => c.id === viewingId) ?? null)
    : null
  const card =
    archivedCard ?? (editingId ? (kanban?.cards.find((c) => c.id === editingId) ?? null) : null)
  const isCreate = !card
  const readOnly = !!archivedCard

  const [title, setTitle] = useState(card?.title ?? '')
  const [columnId, setColumnId] = useState(card?.columnId ?? creatingColumnId ?? '')
  const [priority, setPriority] = useState<KanbanPriority | null>(card?.priority ?? null)
  const [dueDate, setDueDate] = useState(card?.dueDate ?? '')
  const [storyPoints, setStoryPoints] = useState(
    card?.storyPoints != null ? String(card.storyPoints) : ''
  )
  const [assignee, setAssignee] = useState(card?.assignee ?? '')
  const [labels, setLabels] = useState<string[]>(card?.labels ?? [])
  const [labelInput, setLabelInput] = useState('')
  const [labelMenuOpen, setLabelMenuOpen] = useState(false)
  const [labelActive, setLabelActive] = useState(0)
  const [description, setDescription] = useState(card?.description ?? '')
  const [comments, setComments] = useState<KanbanCardComment[]>(card?.comments ?? [])
  const [newComment, setNewComment] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [confirmCommentDelete, setConfirmCommentDelete] = useState<string | null>(null)
  const [attrs, setAttrs] = useState<AttrDraft[]>([
    ...Object.entries(card?.attributes ?? {}).map(([key, value]) => ({
      key,
      value,
      secret: card?.secretAttributes.includes(key) ?? false
    })),
    { key: '', value: '', secret: false }
  ])
  const [titleError, setTitleError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const labelInputRef = useRef<HTMLInputElement>(null)

  const attrKeyCounts = new Map<string, number>()
  for (const a of attrs) {
    const k = a.key.trim()
    if (k) attrKeyCounts.set(k, (attrKeyCounts.get(k) ?? 0) + 1)
  }
  const hasDupAttrs = Array.from(attrKeyCounts.values()).some((n) => n > 1)

  if (!kanban) return <></>

  const boardLabels = Array.from(new Set(kanban.cards.flatMap((c) => c.labels)))
    .map((l) => l.trim())
    .filter(Boolean)
  const q = labelInput.trim().toLowerCase()
  const labelSuggestions = boardLabels
    .filter((l) => !labels.includes(l))
    .filter((l) => q === '' || l.toLowerCase().includes(q))
    .slice(0, 8)
  const createNew = q !== '' && !boardLabels.some((l) => l.toLowerCase() === q)
  const labelOptions = [...labelSuggestions, ...(createNew ? [labelInput.trim()] : [])]

  function addLabel(raw: string): void {
    const value = raw.trim()
    if (!value) return
    if (!labels.includes(value)) setLabels((prev) => [...prev, value])
    setLabelInput('')
    setLabelMenuOpen(false)
    setLabelActive(0)
  }

  function removeLabel(value: string): void {
    setLabels((prev) => prev.filter((l) => l !== value))
  }

  function syncCommentsFromStore(): void {
    if (!card) return
    const latest = useAppStore.getState().kanban?.cards.find((c) => c.id === card.id)
    if (latest) setComments(latest.comments)
  }

  function addComment(): void {
    const text = newComment.trim()
    if (!text) return
    setNewComment('')
    if (card) {
      void addKanbanComment(card.id, text).then(syncCommentsFromStore)
      return
    }
    setComments((prev) => [...prev, makeComment(text)])
  }

  function saveCommentEdit(id: string): void {
    const text = commentDraft.trim()
    if (!text) return
    if (card) {
      setComments((prev) => withEditedComment(prev, id, text))
      setEditingCommentId(null)
      setCommentDraft('')
      void updateKanbanComment(card.id, id, text).then(syncCommentsFromStore)
      return
    }
    const nextComments = withEditedComment(comments, id, text)
    setComments(nextComments)
    setEditingCommentId(null)
    setCommentDraft('')
  }

  function cancelCommentEdit(): void {
    setEditingCommentId(null)
    setCommentDraft('')
  }

  function deleteComment(id: string): void {
    if (card) {
      setComments((prev) => withoutComment(prev, id))
      setConfirmCommentDelete(null)
      if (editingCommentId === id) cancelCommentEdit()
      void deleteKanbanComment(card.id, id).then(syncCommentsFromStore)
      return
    }
    const nextComments = withoutComment(comments, id)
    setComments(nextComments)
    setConfirmCommentDelete(null)
    if (editingCommentId === id) cancelCommentEdit()
  }

  function onLabelKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    const options = labelOptions
    if (e.key === 'Enter' || e.key === ',') {
      if (labelMenuOpen && options.length > 0) {
        e.preventDefault()
        addLabel(options[labelActive] ?? labelInput)
        return
      }
      if (labelInput.trim()) {
        e.preventDefault()
        addLabel(labelInput)
      }
      return
    }
    if (e.key === 'Backspace' && labelInput === '' && labels.length > 0) {
      removeLabel(labels[labels.length - 1])
      return
    }
    if (e.key === 'Escape') {
      setLabelMenuOpen(false)
      return
    }
    if (labelMenuOpen && options.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setLabelActive((prev) => (prev + 1) % options.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setLabelActive((prev) => (prev - 1 + options.length) % options.length)
      }
    }
  }

  function close(): void {
    if (readOnly) closeKanbanViewer()
    else if (isCreate) closeKanbanCreate()
    else closeKanbanEditor()
  }

  function fieldValues(): {
    title: string
    description: string
    labels: string[]
    dueDate: string | null
    storyPoints: number | null
    assignee: string
    attributes: Record<string, string>
    secretAttributes: string[]
  } {
    const trimmed = title.trim()
    const pts = storyPoints.trim() === '' ? null : Number.parseInt(storyPoints, 10)
    return {
      title: trimmed,
      description: description.trim(),
      labels: labels.map((l) => l.trim()).filter(Boolean),
      dueDate: dueDate || null,
      storyPoints: Number.isFinite(pts) && (pts as number) > 0 ? (pts as number) : null,
      assignee: assignee.trim(),
      attributes: Object.fromEntries(
        attrs.filter((a) => a.key.trim()).map((a) => [a.key.trim(), a.value.trim()])
      ),
      secretAttributes: attrs.filter((a) => a.key.trim() && a.secret).map((a) => a.key.trim())
    }
  }

  function save(): void {
    if (!kanban || hasDupAttrs) return
    const values = fieldValues()
    if (!values.title) {
      setTitleError('Enter a card title')
      return
    }
    if (isCreate) {
      void createKanbanCard({
        ...values,
        column: columnId,
        priority,
        comments: comments.map((c) => ({ ...c, comment: c.comment.trim() }))
      })
    } else if (card) {
      void updateKanbanCard(card.id, {
        ...values,
        columnId,
        priority
      })
    }
    close()
  }

  function remove(): void {
    if (!card || readOnly) return
    void deleteKanbanCard(card.id)
    close()
  }

  return (
    <Modal
      title={isCreate ? 'New card' : readOnly ? 'View card' : 'Edit card'}
      onClose={close}
      className="kanban-card-modal"
    >
      <fieldset className="kanban-form" disabled={readOnly}>
        <div className="kanban-form-row row-top">
          <div className="kanban-field grow3">
            <label>Title</label>
            <input
              className="text-field"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                if (titleError) setTitleError(null)
              }}
              onKeyDown={(e) => {
                if (!readOnly && e.key === 'Enter') save()
              }}
              placeholder="Card title"
              autoFocus
            />
            {titleError && <p className="form-error">{titleError}</p>}
          </div>
          <div className="kanban-field grow1">
            <label>Assignee</label>
            <input
              className="text-field"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="—"
            />
          </div>
        </div>

        <div className="kanban-form-row">
          <div className="kanban-field grow1">
            <label>Column</label>
            <select
              className="text-field"
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
            >
              {kanban.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div className="kanban-field grow1">
            <label>Due date</label>
            <input
              className="text-field"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="kanban-field grow1">
            <label>Story points</label>
            <input
              className="text-field"
              type="number"
              min="1"
              value={storyPoints}
              onChange={(e) => setStoryPoints(e.target.value)}
              placeholder="—"
            />
          </div>
          <div className="kanban-field grow1">
            <label>Priority</label>
            <div className="kanban-seg">
              <button
                type="button"
                className={`kanban-seg-btn${priority === null ? ' active' : ''}`}
                title="None"
                onClick={() => setPriority(null)}
              >
                <MdiIcon path={mdiClose} size={16} />
              </button>
              <button
                type="button"
                className={`kanban-seg-btn${priority === 'low' ? ' active' : ''}`}
                title="Low"
                onClick={() => setPriority('low')}
              >
                <MdiIcon path={mdiArrowDown} size={16} />
              </button>
              <button
                type="button"
                className={`kanban-seg-btn${priority === 'medium' ? ' active' : ''}`}
                title="Medium"
                onClick={() => setPriority('medium')}
              >
                <MdiIcon path={mdiMinus} size={16} />
              </button>
              <button
                type="button"
                className={`kanban-seg-btn${priority === 'high' ? ' active' : ''}`}
                title="High"
                onClick={() => setPriority('high')}
              >
                <MdiIcon path={mdiArrowUp} size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="kanban-field full">
          <label>Labels</label>
          <div className="kanban-label-input">
            <div className="kanban-label-chips">
              {labels.map((l) => (
                <span key={l} className="kanban-chip">
                  {l}
                  <button
                    className="kanban-chip-remove"
                    title="Remove label"
                    onClick={() => removeLabel(l)}
                  >
                    <MdiIcon path={mdiClose} size={12} />
                  </button>
                </span>
              ))}
              <input
                ref={labelInputRef}
                className="kanban-chip-input"
                value={labelInput}
                onChange={(e) => {
                  setLabelInput(e.target.value)
                  setLabelMenuOpen(true)
                  setLabelActive(0)
                }}
                onFocus={() => setLabelMenuOpen(true)}
                onBlur={() => setLabelMenuOpen(false)}
                onKeyDown={onLabelKeyDown}
                placeholder={labels.length === 0 ? 'Type to add a label…' : ''}
              />
            </div>
            {labelMenuOpen && labelOptions.length > 0 && (
              <div className="kanban-label-menu">
                {labelOptions.map((l, i) => (
                  <button
                    key={l}
                    className={`kanban-label-option${
                      i === labelActive ? ' active' : ''
                    }${i === labelOptions.length - 1 && createNew ? ' create' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      addLabel(l)
                    }}
                    onMouseEnter={() => setLabelActive(i)}
                  >
                    {l}
                    {i === labelOptions.length - 1 && createNew && (
                      <span className="kanban-label-new">new</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="kanban-field full">
          <label>Description</label>
          <textarea
            className="text-area"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional details…"
          />
        </div>

        <div className="kanban-field full kanban-comments">
          <label>Comments{comments.length > 0 ? ` (${comments.length})` : ''}</label>
          {comments.length > 0 && (
            <div className="kanban-comments-list">
              {comments.map((c) =>
                editingCommentId === c.id ? (
                  <div key={c.id} className="kanban-comment editing">
                    <textarea
                      className="text-area"
                      rows={4}
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="Write a comment… (markdown)"
                      autoFocus
                    />
                    <div className="kanban-comment-actions">
                      <button className="btn small" onClick={cancelCommentEdit}>
                        Cancel
                      </button>
                      <button
                        className="btn primary small"
                        onClick={() => saveCommentEdit(c.id)}
                        disabled={!commentDraft.trim()}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={c.id} className="kanban-comment">
                    <div className="kanban-comment-head">
                      <span className="kanban-comment-by">{c.commentBy}</span>
                      <span className="kanban-comment-time">
                        {new Date(c.timestamp).toLocaleString()}
                      </span>
                      <span className="kanban-comment-spacer" />
                      {!readOnly &&
                        (confirmCommentDelete === c.id ? (
                          <button
                            className="btn small danger"
                            onMouseLeave={() => setConfirmCommentDelete(null)}
                            onClick={() => deleteComment(c.id)}
                          >
                            Confirm delete?
                          </button>
                        ) : (
                          <>
                            <button
                              className="icon-btn small"
                              title="Edit comment"
                              onClick={() => {
                                setConfirmCommentDelete(null)
                                setEditingCommentId(c.id)
                                setCommentDraft(c.comment)
                              }}
                            >
                              <MdiIcon path={mdiPencil} size={14} />
                            </button>
                            <button
                              className="icon-btn small danger"
                              title="Delete comment"
                              onClick={() => setConfirmCommentDelete(c.id)}
                            >
                              <MdiIcon path={mdiTrashCanOutline} size={14} />
                            </button>
                          </>
                        ))}
                    </div>
                    <div className="kanban-comment-body">
                      <MarkdownContent content={c.comment} />
                    </div>
                  </div>
                )
              )}
            </div>
          )}
          {!readOnly && editingCommentId === null && (
            <div className="kanban-comment-composer">
              <textarea
                className="text-area"
                rows={2}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write a comment… (markdown)"
              />
              <div className="kanban-comment-actions">
                <button
                  className="btn primary small"
                  onClick={addComment}
                  disabled={!newComment.trim()}
                >
                  Add comment
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="kanban-field full kanban-attrs">
          <div className="kanban-attrs-head">
            <label>Attributes</label>
            {!readOnly && (
              <button
                className="icon-btn small"
                title="Add attribute"
                onClick={() => setAttrs([...attrs, { key: '', value: '', secret: false }])}
              >
                <MdiIcon path={mdiPlus} size={14} />
              </button>
            )}
          </div>
          {hasDupAttrs && <p className="form-error">Duplicate attribute keys</p>}
          <div className="kanban-attrs-scroll">
            {attrs
              .filter((a) => !readOnly || a.key.trim() !== '' || a.value.trim() !== '')
              .map((a, i) => (
                <div key={i} className="kanban-attr-row">
                  <input
                    className={`text-field kanban-attr-key${
                      (a.key.trim() && (attrKeyCounts.get(a.key.trim()) ?? 0) > 1) ||
                      (!a.key.trim() && a.value.trim() !== '')
                        ? ' invalid'
                        : ''
                    }`}
                    value={a.key}
                    onChange={(e) =>
                      setAttrs(
                        attrs.map((x, j) =>
                          j === i ? { ...x, key: slugKeyInput(e.target.value) } : x
                        )
                      )
                    }
                    placeholder="Key"
                    title={
                      !a.key.trim() && a.value.trim() !== ''
                        ? 'Enter a key — attributes without a key are dropped on save'
                        : undefined
                    }
                  />
                  <input
                    className="text-field"
                    value={a.value}
                    onChange={(e) =>
                      setAttrs(attrs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                    }
                    placeholder="Value"
                  />
                  <button
                    type="button"
                    className={`icon-btn small kanban-secret${a.secret ? ' active' : ''}`}
                    title={
                      a.secret
                        ? 'Secret — value will not be sent to the AI'
                        : 'Mark as secret — value will not be sent to the AI'
                    }
                    onClick={() =>
                      setAttrs(attrs.map((x, j) => (j === i ? { ...x, secret: !x.secret } : x)))
                    }
                  >
                    <MdiIcon path={mdiKey} size={14} />
                  </button>
                  {!readOnly && (
                    <button
                      className="icon-btn small danger"
                      title="Remove attribute"
                      onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}
                    >
                      <MdiIcon path={mdiTrashCanOutline} size={14} />
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      </fieldset>
      <div className="modal-actions">
        {readOnly ? (
          <button className="btn" onClick={close}>
            Close
          </button>
        ) : (
          <>
            {!isCreate && (
              <button
                className={`btn${confirmDelete ? ' danger' : ''}`}
                onClick={() => {
                  if (confirmDelete) remove()
                  else setConfirmDelete(true)
                }}
                onMouseLeave={() => setConfirmDelete(false)}
              >
                {confirmDelete ? 'Confirm delete?' : 'Delete'}
              </button>
            )}
            <span className="kanban-modal-spacer" />
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={save}
              disabled={hasDupAttrs}
              title={hasDupAttrs ? 'Resolve duplicate attribute keys to save' : undefined}
            >
              {isCreate ? 'Add card' : 'Save'}
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
