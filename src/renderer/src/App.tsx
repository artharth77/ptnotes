import { useEffect, useRef, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { friendlyError } from './errors'
import { TopBar } from './components/TopBar'
import { NoteList } from './components/NoteList'
import { TodoPanel } from './components/TodoPanel'
import { PlannerPanel } from './components/PlannerPanel'
import { PlannerEditor } from './components/PlannerEditor'
import { MarkdownEditor } from './components/MarkdownEditor'
import { ChatDrawer } from './components/ChatDrawer'
import { SettingsDialog } from './components/SettingsDialog'
import { AskUserDialog } from './components/AskUserDialog'
import { ModulePanel } from './components/ModulePanel'
import { ModuleHistoryOverlay } from './components/ModuleHistoryOverlay'
import { TraceViewerModal } from './components/TraceViewerModal'
import { PromptModal, Modal } from './components/Modal'
import { Resizer } from './components/Resizer'
import type { Tab, ToolCallInfo } from '@shared/types'
import { addUsage, normalizeUsage } from '@shared/usage'

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 560
const CHAT_MIN = 280
const CHAT_MAX = 720

function SideTabs(): React.JSX.Element {
  const tab = useAppStore((s) => s.tab)
  const setTab = useAppStore((s) => s.setTab)

  return (
    <div className="side-tabs">
      {(['notes', 'todo', 'planner'] as Tab[]).map((t) => (
        <button
          key={t}
          className={`side-tab ${tab === t ? 'active' : ''}`}
          onClick={() => setTab(t)}
        >
          {t === 'notes' ? 'Notes' : t === 'todo' ? 'Todo' : t === 'planner' ? 'Planner' : ''}
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

function EmptyPlanner(): React.JSX.Element {
  const createSchedule = useAppStore((s) => s.createSchedule)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  return (
    <div className="empty-state">
      <p>Select a schedule or create a new one.</p>
      <button
        className="btn primary"
        onClick={() => {
          setCreateError('')
          setCreating(true)
        }}
      >
        + New Schedule
      </button>
      {creating && (
        <PromptModal
          title="New Schedule"
          placeholder="Schedule name"
          submitLabel="Create"
          error={createError}
          onClose={() => setCreating(false)}
          onSubmit={(name) => {
            void (async () => {
              try {
                await createSchedule(name)
                setCreateError('')
                setCreating(false)
              } catch (e) {
                setCreateError(friendlyError(e))
              }
            })()
          }}
        />
      )}
    </div>
  )
}

function ModuleSkeleton(): React.JSX.Element {
  return (
    <div className="module-skeleton">
      <div className="module-skeleton-card">
        <div className="module-skeleton-row">
          <span className="skeleton-bar w30" />
          <span className="skeleton-bar w10" />
        </div>
        <span className="skeleton-bar w55" />
        <span className="skeleton-bar w85" />
        <span className="skeleton-bar w70" />
      </div>
      <div className="module-skeleton-card">
        <div className="module-skeleton-row">
          <span className="skeleton-bar w35" />
          <span className="skeleton-bar w15" />
        </div>
        <span className="skeleton-bar w65" />
        <span className="skeleton-bar w80" />
      </div>
      <div className="module-skeleton-card">
        <div className="module-skeleton-row">
          <span className="skeleton-bar w25" />
          <span className="skeleton-bar w10" />
        </div>
        <span className="skeleton-bar w75" />
        <span className="skeleton-bar w60" />
        <span className="skeleton-bar w90" />
      </div>
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

function upsertToolCall(list: ToolCallInfo[], tc: ToolCallInfo): ToolCallInfo[] {
  const idx = list.findIndex((t) => t.id === tc.id)
  return idx === -1 ? [...list, tc] : list.map((t, i) => (i === idx ? tc : t))
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
  const activeScheduleId = useAppStore((s) => s.activeScheduleId)
  const noteContent = useAppStore((s) => s.noteContent)
  const tab = useAppStore((s) => s.tab)
  const chatOpen = useAppStore((s) => s.chatOpen)
  const moduleOpen = useAppStore((s) => s.moduleOpen)
  const rightView = useAppStore((s) => s.rightView)
  const rightOpen = chatOpen || moduleOpen
  const setRightView = useAppStore((s) => s.setRightView)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const sidebarVisible = useAppStore((s) => s.sidebarVisible)
  const askRequest = useAppStore((s) => s.askRequest)
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [chatWidth, setChatWidth] = useState(360)
  const [chatResizing, setChatResizing] = useState(false)
  const [moduleResizing, setModuleResizing] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const chatColRef = useRef<HTMLDivElement>(null)
  const chatNewTurnRef = useRef(false)
  const chatLastMsgIdRef = useRef<string | null>(null)

  useEffect(() => {
    void init()
  }, [init])

  // Handle AI stream events: update chat store, auto-refresh notes/todos on tool calls
  useEffect(() => {
    const NOTE_TOOLS = new Set(['create_note', 'update_note', 'delete_note'])
    const TODO_TOOLS = new Set(['create_todos', 'toggle_todo', 'delete_todo'])
    const PLANNER_TOOLS = new Set([
      'list_schedules',
      'read_schedule',
      'create_schedule',
      'update_schedule',
      'add_task',
      'update_task',
      'set_calendar'
    ])
    return window.ptnotes.ai.onStreamEvent((evt) => {
      const state = useAppStore.getState()
      const project = state.chatStreamProject
      switch (evt.type) {
        case 'message-start':
          state.setChatBusy(true)
          if (evt.messageId && evt.messageId !== chatLastMsgIdRef.current) {
            chatLastMsgIdRef.current = evt.messageId
            chatNewTurnRef.current = false
          }
          break
        case 'content':
          if (project) {
            if (chatNewTurnRef.current) {
              chatNewTurnRef.current = false
              state.appendChatMessage(project, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: '',
                toolCalls: []
              })
            }
            state.updateLastAssistantMessage(project, (m) => ({
              ...m,
              content: m.content + (evt.content ?? '')
            }))
          }
          break
        case 'tool':
          if (evt.toolCall) {
            const tc = evt.toolCall
            const done = tc.ok !== undefined
            if (project) {
              state.updateLastAssistantMessage(project, (m) => ({
                ...m,
                toolCalls: upsertToolCall(m.toolCalls ?? [], tc)
              }))
              if (done) {
                chatNewTurnRef.current = true
              }
            }
            if (done) {
              if (NOTE_TOOLS.has(tc.name)) {
                void state.refreshNotes()
                if (tc.name === 'create_note' || tc.name === 'update_note') {
                  reloadActiveNoteIfUpdated(tc)
                }
              }
              if (TODO_TOOLS.has(tc.name)) {
                void state.refreshTodos()
              }
              if (PLANNER_TOOLS.has(tc.name)) {
                void state.refreshSchedules()
                if (
                  (tc.name === 'add_task' || tc.name === 'update_task') &&
                  state.activeScheduleId
                ) {
                  void state.selectSchedule(state.activeScheduleId)
                }
                if (tc.name === 'set_calendar') {
                  void state.loadCalendar()
                }
              }
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
                content: m.content ? `${m.content}\n\n⚠️ ${evt.error}` : evt.error!,
                toolCalls: (m.toolCalls ?? []).map((t) =>
                  t.ok === undefined ? { ...t, status: undefined } : t
                )
              }))
            }
            state.setChatBusy(false)
            state.setChatStreamProject(null)
            state.setChatWaitRuns([])
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
        case 'waiting':
          if (evt.runIds) {
            state.setChatWaitRuns(evt.runIds)
          }
          break
        case 'message-end': {
          state.setChatWaitRuns([])
          if (project && evt.usage !== undefined) {
            const u = normalizeUsage(evt.usage)
            if (u) {
              state.updateLastAssistantMessage(project, (m) => ({
                ...m,
                usage: addUsage(m.usage, u)
              }))
            }
          }
          break
        }
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

  // Global panel shortcuts: Cmd/Ctrl+Shift+C toggles chat, Cmd/Ctrl+Shift+M toggles modules
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const mod =
        (window.electron.process.platform === 'darwin' ? e.metaKey : e.ctrlKey) && e.shiftKey
      if (!mod || e.altKey) return
      const key = e.key.toLowerCase()
      if (key !== 'c' && key !== 'm') return
      const modalOpen = document.querySelector('.modal-overlay, .module-history-backdrop') !== null
      if (modalOpen) return
      e.preventDefault()
      const view = key === 'c' ? 'chat' : 'modules'
      if (view === 'modules' && !activeProject) return
      setRightView(view)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeProject, setRightView])

  // Show a skeleton briefly while the module panel animates open/close or switches to it
  const moduleWasOpen = useRef(rightOpen && rightView === 'modules')
  useEffect(() => {
    const isOpen = rightOpen && rightView === 'modules'
    const opened = isOpen && !moduleWasOpen.current
    const closed = !isOpen && moduleWasOpen.current
    moduleWasOpen.current = isOpen
    if (opened || closed) {
      setModuleResizing(true)
      const t = setTimeout(() => setModuleResizing(false), 300)
      return () => clearTimeout(t)
    }
    return undefined
  }, [rightOpen, rightView])

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
            {tab === 'todo' ? <TodoPanel /> : tab === 'planner' ? <PlannerPanel /> : <NoteList />}
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
            {tab === 'planner' ? (
              activeScheduleId ? (
                <PlannerEditor key={activeScheduleId} />
              ) : (
                <EmptyPlanner />
              )
            ) : activeNoteId ? (
              <MarkdownEditor key={activeNoteId} noteId={activeNoteId} content={noteContent} />
            ) : (
              <EmptyNote />
            )}
          </main>
          {rightOpen && (
            <Resizer
              position="start"
              targetRef={chatColRef}
              min={CHAT_MIN}
              max={CHAT_MAX}
              onCommit={setChatWidth}
              onStart={() => {
                setChatResizing(true)
                setModuleResizing(true)
              }}
              onEnd={() => {
                setChatResizing(false)
                setModuleResizing(false)
              }}
            />
          )}
          <div
            ref={chatColRef}
            className={`chat-col${rightOpen ? '' : ' collapsed'}`}
            style={{ width: rightOpen ? chatWidth : 0 }}
          >
            {rightView === 'modules' ? (
              moduleResizing ? (
                <ModuleSkeleton />
              ) : (
                <div className="module-drawer">
                  <ModulePanel />
                </div>
              )
            ) : chatResizing ? (
              <ChatSkeleton />
            ) : (
              <ChatDrawer width={chatWidth} />
            )}
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
      <TraceViewerModal />
    </div>
  )
}

export default App
