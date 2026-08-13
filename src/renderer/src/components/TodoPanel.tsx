import { useEffect, useRef, useState } from 'react'
import {
  mdiDotsVertical,
  mdiEyeOffOutline,
  mdiToggleSwitch,
  mdiToggleSwitchOffOutline,
  mdiTrashCanOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'
import type { Todo } from '@shared/types'

export function TodoPanel(): React.JSX.Element {
  const todos = useAppStore((s) => s.todos)
  const activeProject = useAppStore((s) => s.activeProject)
  const refreshTodos = useAppStore((s) => s.refreshTodos)
  const [newTask, setNewTask] = useState('')
  const [hideCompleted, setHideCompleted] = useState(true)
  const [confirmClear, setConfirmClear] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const done = todos.filter((t) => t.done).length
  const pct = todos.length ? Math.round((done / todos.length) * 100) : 0
  const visible = hideCompleted ? todos.filter((t) => !t.done) : todos

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
    setMenuPos({ x: rect.right, y: rect.bottom })
    setMenuOpen(true)
  }

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
        <span className="todo-header-right">
          <span className="todo-progress-text">
            {done}/{todos.length}
          </span>
          <button
            className="icon-btn todo-menu-btn"
            title="Todo options"
            onClick={toggleMenu}
            aria-expanded={menuOpen}
          >
            <MdiIcon path={mdiDotsVertical} size={16} />
          </button>
        </span>
      </div>
      {menuOpen && menuPos && (
        <>
          <div className="menu-overlay" onClick={() => setMenuOpen(false)} />
          <div
            ref={menuRef}
            className="note-menu"
            style={{ left: menuPos.x, top: menuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="note-menu-item"
              title="Hide completed tasks from the list"
              onClick={() => {
                setHideCompleted((v) => !v)
                setMenuOpen(false)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiEyeOffOutline} size={16} />
              </span>
              Hide completed
              <span className="note-menu-toggle">
                <MdiIcon
                  path={hideCompleted ? mdiToggleSwitch : mdiToggleSwitchOffOutline}
                  size={28}
                />
              </span>
            </button>
            <button
              className="note-menu-item danger"
              disabled={done === 0}
              title="Delete all completed tasks"
              onClick={() => {
                setConfirmClear(true)
                setMenuOpen(false)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiTrashCanOutline} size={16} />
              </span>
              Delete completed
            </button>
          </div>
        </>
      )}
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
              <MdiIcon path={mdiTrashCanOutline} size={14} />
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
            <button className="btn danger" onClick={() => void clearCompleted()}>
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
