import { useEffect, useRef, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { TopBar } from './components/TopBar'
import { NoteList } from './components/NoteList'
import { TodoPanel } from './components/TodoPanel'
import { MarkdownEditor } from './components/MarkdownEditor'
import { ChatDrawer } from './components/ChatDrawer'
import { SettingsDialog } from './components/SettingsDialog'
import { AskUserDialog } from './components/AskUserDialog'
import { ModulePanel } from './components/ModulePanel'
import { ModuleHistoryOverlay } from './components/ModuleHistoryOverlay'
import { PromptModal, Modal } from './components/Modal'
import { Resizer } from './components/Resizer'
import type { Tab, ToolCallInfo } from '@shared/types'

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 560
const CHAT_MIN = 280
const CHAT_MAX = 720
const NO_RUNS: never[] = []

function SideTabs(): React.JSX.Element {
  const tab = useAppStore((s) => s.tab)
  const setTab = useAppStore((s) => s.setTab)
  const moduleRuns = useAppStore((s) =>
    s.activeProject ? (s.moduleRuns[s.activeProject] ?? NO_RUNS) : NO_RUNS
  )
  const modulesBusy = moduleRuns.some((r) => !['done', 'failed', 'cancelled'].includes(r.status))

  return (
    <div className="side-tabs">
      {(['notes', 'todo', 'modules'] as Tab[]).map((t) => (
        <button
          key={t}
          className={`side-tab ${tab === t ? 'active' : ''}`}
          onClick={() => setTab(t)}
        >
          {t === 'notes' ? 'Notes' : t === 'todo' ? 'Todo' : 'Modules'}
          {t === 'modules' && modulesBusy && <span className="side-tab-spinner" />}
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

function ChatSkeleton(): React.JSX.Element {
  return (
    <div className="chat-skeleton">
      <div className="chat-skeleton-header">
        <span className="skeleton-bar w60" />
        <span className="skeleton-bar w20" />
      </div>
      <div className="chat-skeleton-body">
        <span className="skeleton-bar w80" />
        <span className="skeleton-bar w40" />
        <span className="skeleton-bar w65" />
        <span className="skeleton-bar w50" />
        <span className="skeleton-bar w75" />
        <span className="skeleton-bar w35" />
        <span className="skeleton-bar w60" />
      </div>
      <div className="chat-skeleton-input">
        <span className="skeleton-bar w70" />
        <span className="skeleton-bar w15" />
      </div>
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
  const askRequest = useAppStore((s) => s.askRequest)
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [chatWidth, setChatWidth] = useState(360)
  const [chatResizing, setChatResizing] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const chatColRef = useRef<HTMLDivElement>(null)

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
            if (evt.toolCall.name === 'start_module') {
              try {
                const res = JSON.parse(evt.toolCall.result ?? '{}') as {
                  ok?: boolean
                  runId?: string
                }
                if (res.ok && res.runId) {
                  state.updateLastAssistantMessage(project, (m) => ({
                    ...m,
                    moduleRunId: res.runId!
                  }))
                }
              } catch {
                // ignore unparseable start_module result
              }
            }
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
        case 'ask':
          if (evt.ask) {
            state.setAskRequest(evt.ask)
          }
          break
      }
    })
  }, [])

  // Handle module run events: upsert run state in the store in real time
  useEffect(() => {
    return window.ptnotes.modules.onEvent((evt) => {
      const state = useAppStore.getState()
      state.applyModuleEvent(evt)
      if (evt.type === 'output' || evt.type === 'done') {
        void state.refreshFiles()
      }
    })
  }, [])

  return (
    <div className="app">
      <TopBar />

      {activeProject ? (
        <div className="app-body">
          <aside
            ref={sidebarRef}
            className={`sidebar${sidebarVisible ? '' : ' collapsed'}`}
            style={{ width: sidebarVisible ? sidebarWidth : 0 }}
          >
            <SideTabs />
            {tab === 'todo' ? <TodoPanel /> : tab === 'modules' ? <ModulePanel /> : <NoteList />}
          </aside>
          {sidebarVisible && (
            <Resizer
              position="end"
              targetRef={sidebarRef}
              min={SIDEBAR_MIN}
              max={SIDEBAR_MAX}
              onCommit={setSidebarWidth}
            />
          )}
          <main className="main-area">
            {activeNoteId ? (
              <MarkdownEditor key={activeNoteId} noteId={activeNoteId} content={noteContent} />
            ) : (
              <EmptyNote />
            )}
          </main>
          {chatOpen && (
            <Resizer
              position="start"
              targetRef={chatColRef}
              min={CHAT_MIN}
              max={CHAT_MAX}
              onCommit={setChatWidth}
              onStart={() => setChatResizing(true)}
              onEnd={() => setChatResizing(false)}
            />
          )}
          <div
            ref={chatColRef}
            className={`chat-col${chatOpen ? '' : ' collapsed'}`}
            style={{ width: chatOpen ? chatWidth : 0 }}
          >
            {chatResizing ? <ChatSkeleton /> : <ChatDrawer width={chatWidth} />}
          </div>
        </div>
      ) : (
        <div className="app-body no-project">
          <EmptyProject />
          {chatOpen && (
            <Resizer
              position="start"
              targetRef={chatColRef}
              min={CHAT_MIN}
              max={CHAT_MAX}
              onCommit={setChatWidth}
              onStart={() => setChatResizing(true)}
              onEnd={() => setChatResizing(false)}
            />
          )}
          <div
            ref={chatColRef}
            className={`chat-col${chatOpen ? '' : ' collapsed'}`}
            style={{ width: chatOpen ? chatWidth : 0 }}
          >
            {chatResizing ? <ChatSkeleton /> : <ChatDrawer width={chatWidth} />}
          </div>
        </div>
      )}

      {settingsOpen && <SettingsDialog />}
      <ConfirmDeleteDialog />
      <AskUserDialog key={askRequest?.id ?? 'none'} />
      <ModuleHistoryOverlay />
    </div>
  )
}

export default App
