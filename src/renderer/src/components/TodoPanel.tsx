import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'
import type { Todo } from '@shared/types'

export function TodoPanel(): React.JSX.Element {
  const todos = useAppStore((s) => s.todos)
  const activeProject = useAppStore((s) => s.activeProject)
  const refreshTodos = useAppStore((s) => s.refreshTodos)
  const [newTask, setNewTask] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const done = todos.filter((t) => t.done).length
  const pct = todos.length ? Math.round((done / todos.length) * 100) : 0
  const visible = showAll ? todos : todos.filter((t) => !t.done)

  async function toggle(todo: Todo): Promise<void> {
    if (!activeProject) return
    await window.ptnotes.todos.toggle(activeProject, todo.id)
    await refreshTodos()
  }

  async function remove(todo: Todo): Promise<void> {
    if (!activeProject) return
    await window.ptnotes.todos.delete(activeProject, todo.id)
    await refreshTodos()
  }

  async function add(): Promise<void> {
    const text = newTask.trim()
    if (!text || !activeProject) return
    await window.ptnotes.todos.add(activeProject, [text])
    setNewTask('')
    await refreshTodos()
  }

  async function clearCompleted(): Promise<void> {
    if (!activeProject) return
    setConfirmClear(false)
    await window.ptnotes.todos.deleteCompleted(activeProject)
    await refreshTodos()
  }

  function orderedIds(fromId: string, toId: string): string[] {
    const from = todos.findIndex((t) => t.id === fromId)
    const to = todos.findIndex((t) => t.id === toId)
    if (from === -1 || to === -1 || from === to) return todos.map((t) => t.id)
    const moved = todos[from]!
    const next = todos.filter((t) => t.id !== fromId)
    next.splice(to, 0, moved)
    return next.map((t) => t.id)
  }

  async function drop(fromId: string, toId: string): Promise<void> {
    if (!activeProject || fromId === toId) return
    await window.ptnotes.todos.reorder(activeProject, orderedIds(fromId, toId))
    await refreshTodos()
  }

  function endDrag(): void {
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className="todo-panel">
      <div className="list-header">
        <span>Todo</span>
        <span className="todo-progress-text">
          {done}/{todos.length}
        </span>
      </div>
      <div className="todo-add">
        <input
          className="text-field"
          value={newTask}
          placeholder="Add a task…"
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add()
          }}
        />
        <button className="btn primary" onClick={() => void add()} disabled={!newTask.trim()}>
          Add
        </button>
      </div>
      <div className="todo-toolbar">
        <label className="todo-showall" title="Show all tasks including completed">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show All
        </label>
        <button
          className="btn small danger"
          onClick={() => setConfirmClear(true)}
          disabled={done === 0}
          title="Delete all completed tasks"
        >
          Delete completed
        </button>
      </div>
      <div className="todo-progress">
        <div className="todo-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="list-scroll">
        {visible.length === 0 && (
          <div className="list-empty">
            {todos.length === 0 ? 'No tasks yet' : 'No tasks to show'}
          </div>
        )}
        {visible.map((todo) => (
          <div
            key={todo.id}
            className={`todo-item ${todo.done ? 'done' : ''} ${dragId === todo.id ? 'dragging' : ''} ${overId === todo.id ? 'drag-over' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              setDragId(todo.id)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragId !== todo.id) setOverId(todo.id)
            }}
            onDragLeave={() => {
              if (overId === todo.id) setOverId(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId) void drop(dragId, todo.id)
              endDrag()
            }}
            onDragEnd={endDrag}
          >
            <span className="todo-drag" title="Drag to reorder">
              ⋮⋮
            </span>
            <label className="todo-check">
              <input type="checkbox" checked={todo.done} onChange={() => void toggle(todo)} />
            </label>
            <span className="todo-text" title={todo.text}>
              {todo.text}
            </span>
            <button
              className="icon-btn small danger"
              title="Delete"
              onClick={() => void remove(todo)}
            >
              🗑
            </button>
          </div>
        ))}
      </div>

      {confirmClear && (
        <Modal title="Delete completed tasks" onClose={() => setConfirmClear(false)}>
          <p>
            Delete {done} completed task{done === 1 ? '' : 's'}? This cannot be undone.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
            <button className="btn primary danger" onClick={() => void clearCompleted()}>
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
