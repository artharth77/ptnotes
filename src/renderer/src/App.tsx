import { useEffect, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { TopBar } from './components/TopBar'
import { NoteList } from './components/NoteList'
import { TodoPanel } from './components/TodoPanel'
import { MarkdownEditor } from './components/MarkdownEditor'
import { ChatDrawer } from './components/ChatDrawer'
import { AISettingsDialog } from './components/AISettingsDialog'
import { PromptModal, Modal } from './components/Modal'
import { Resizer } from './components/Resizer'
import type { Tab, ToolCallInfo } from '@shared/types'

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 560
const CHAT_MIN = 280
const CHAT_MAX = 720

function SideTabs(): React.JSX.Element {
  const tab = useAppStore((s) => s.tab)
  const setTab = useAppStore((s) => s.setTab)

  return (
    <div className="side-tabs">
      {(['notes', 'todo'] as Tab[]).map((t) => (
        <button
          key={t}
          className={`side-tab ${tab === t ? 'active' : ''}`}
          onClick={() => setTab(t)}
        >
          {t === 'notes' ? 'Notes' : 'Todo'}
        </button>
      ))}
    </div>
  )
}

function EmptyProject(): React.JSX.Element {
  const createProject = useAppStore((s) => s.createProject)
  const [creating, setCreating] = useState(false)

  return (
    <div className="empty-state">
      <h1>Welcome to PTNotes</h1>
      <p>Create your first project to start writing notes and managing todos.</p>
      <button className="btn primary" onClick={() => setCreating(true)}>
        + New Project
      </button>
      {creating && (
        <PromptModal
          title="New Project"
          placeholder="Project name"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={(name) => {
            setCreating(false)
            void createProject(name)
          }}
        />
      )}
    </div>
  )
}

function EmptyNote(): React.JSX.Element {
  const tab = useAppStore((s) => s.tab)
  const createNote = useAppStore((s) => s.createNote)
  const [creating, setCreating] = useState(false)

  if (tab !== 'notes') {
    return (
      <div className="empty-state">
        <p>Manage your tasks on the Todo tab.</p>
      </div>
    )
  }
  return (
    <div className="empty-state">
      <p>Select a note or create a new one.</p>
      <button className="btn primary" onClick={() => setCreating(true)}>
        + New Note
      </button>
      {creating && (
        <PromptModal
          title="New Note"
          placeholder="Note title"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={(title) => {
            setCreating(false)
            void createNote(title)
          }}
        />
      )}
    </div>
  )
}

function reloadActiveNoteIfUpdated(toolCall: ToolCallInfo): void {
  if (!toolCall.ok || !toolCall.result) return
  try {
    const res = JSON.parse(toolCall.result) as { note?: string; project?: string }
    const state = useAppStore.getState()
    if (
      res.note &&
      res.note === state.activeNoteId &&
      (!res.project || res.project === state.activeProject)
    ) {
      void state.selectNote(res.note)
    }
  } catch {
    // ignore unparseable tool result
  }
}

function ConfirmDeleteDialog(): React.JSX.Element {
  const confirmRequest = useAppStore((s) => s.confirmRequest)
  const setConfirmRequest = useAppStore((s) => s.setConfirmRequest)

  if (!confirmRequest) return <></>
  const req = confirmRequest

  async function respond(approved: boolean): Promise<void> {
    await window.ptnotes.ai.confirmResponse({ id: req.id, approved })
    setConfirmRequest(null)
  }

  return (
    <Modal title="Confirm Delete" onClose={() => void respond(false)}>
      <p className="confirm-message">{req.message}</p>
      <ul className="confirm-list">
        {req.items.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <div className="modal-actions">
        <button className="btn" onClick={() => void respond(false)}>
          Cancel
        </button>
        <button className="btn danger" onClick={() => void respond(true)}>
          Delete
        </button>
      </div>
    </Modal>
  )
}

function App(): React.JSX.Element {
  const init = useAppStore((s) => s.init)
  const activeProject = useAppStore((s) => s.activeProject)
  const activeNoteId = useAppStore((s) => s.activeNoteId)
  const noteContent = useAppStore((s) => s.noteContent)
  const tab = useAppStore((s) => s.tab)
  const chatOpen = useAppStore((s) => s.chatOpen)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const sidebarVisible = useAppStore((s) => s.sidebarVisible)
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [chatWidth, setChatWidth] = useState(360)

  function resizeSidebar(delta: number): void {
    setSidebarWidth((w) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w + delta)))
  }

  function resizeChat(delta: number): void {
    setChatWidth((w) => Math.min(CHAT_MAX, Math.max(CHAT_MIN, w + delta)))
  }

  useEffect(() => {
    void init()
  }, [init])

  // Handle AI stream events: update chat store, auto-refresh notes/todos on tool calls
  useEffect(() => {
    const NOTE_TOOLS = new Set(['create_note', 'update_note', 'delete_note'])
    const TODO_TOOLS = new Set(['create_todos', 'toggle_todo', 'delete_todo'])
    return window.ptnotes.ai.onStreamEvent((evt) => {
      const state = useAppStore.getState()
      const project = state.chatStreamProject
      switch (evt.type) {
        case 'message-start':
          state.setChatBusy(true)
          break
        case 'content':
          if (project) {
            state.updateLastAssistantMessage(project, (m) => ({
              ...m,
              content: m.content + (evt.content ?? '')
            }))
          }
          break
        case 'tool':
          if (project && evt.toolCall) {
            state.updateLastAssistantMessage(project, (m) => ({
              ...m,
              toolCalls: [...(m.toolCalls ?? []), evt.toolCall!]
            }))
          }
          if (evt.toolCall) {
            if (NOTE_TOOLS.has(evt.toolCall.name)) {
              void state.refreshNotes()
              if (evt.toolCall.name === 'update_note') {
                reloadActiveNoteIfUpdated(evt.toolCall)
              }
            }
            if (TODO_TOOLS.has(evt.toolCall.name)) {
              void state.refreshTodos()
            }
          }
          break
        case 'error':
          {
            const target = project ?? state.activeProject
            if (target && evt.error) {
              state.updateLastAssistantMessage(target, (m) => ({
                ...m,
                error: true,
                content: m.content ? `${m.content}\n\n⚠️ ${evt.error}` : evt.error!
              }))
            }
            state.setChatBusy(false)
            state.setChatStreamProject(null)
          }
          break
        case 'confirm':
          if (evt.confirm) {
            state.setConfirmRequest(evt.confirm)
          }
          break
      }
    })
  }, [])

  return (
    <div className="app">
      <TopBar />

      {activeProject ? (
        <div className="app-body">
          <aside
            className={`sidebar${sidebarVisible ? '' : ' collapsed'}`}
            style={{ width: sidebarVisible ? sidebarWidth : 0 }}
          >
            <SideTabs />
            <div className="sidebar-content">{tab === 'todo' ? <TodoPanel /> : <NoteList />}</div>
          </aside>
          {sidebarVisible && <Resizer position="end" onResize={resizeSidebar} />}
          <main className="main-area">
            {activeNoteId ? (
              <MarkdownEditor key={activeNoteId} noteId={activeNoteId} content={noteContent} />
            ) : (
              <EmptyNote />
            )}
          </main>
          {chatOpen && <Resizer position="start" onResize={resizeChat} />}
          <div
            className={`chat-col${chatOpen ? '' : ' collapsed'}`}
            style={{ width: chatOpen ? chatWidth : 0 }}
          >
            <ChatDrawer width={chatWidth} />
          </div>
        </div>
      ) : (
        <div className="app-body no-project">
          <EmptyProject />
          {chatOpen && <Resizer position="start" onResize={resizeChat} />}
          <div
            className={`chat-col${chatOpen ? '' : ' collapsed'}`}
            style={{ width: chatOpen ? chatWidth : 0 }}
          >
            <ChatDrawer width={chatWidth} />
          </div>
        </div>
      )}

      {settingsOpen && <AISettingsDialog />}
      <ConfirmDeleteDialog />
    </div>
  )
}

export default App
