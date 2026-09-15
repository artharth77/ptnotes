import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from './store/useAppStore'
import { friendlyError } from './errors'
import { TopBar } from './components/TopBar'
import { MdiIcon } from './components/MdiIcon'
import {
  mdiFolderOpenOutline,
  mdiFolderOutline,
  mdiBulletinBoard,
  mdiChartTimeline,
  mdiNotebookOutline,
  mdiViewDashboardOutline
} from '@mdi/js'
import { NoteList } from './components/NoteList'
import { KanbanPanel } from './components/KanbanPanel'
import { KanbanBoard } from './components/KanbanBoard'
import { KanbanCardModal } from './components/KanbanCardModal'
import { PlannerPanel } from './components/PlannerPanel'
import { PlannerEditor } from './components/PlannerEditor'
import { MarkdownEditor } from './components/MarkdownEditor'
import { FileTreePanel, FileListPanel } from './components/FileExplorer'
import { ChatDrawer } from './components/ChatDrawer'
import { GroupChatPanel } from './components/GroupChatPanel'
import { BotTasksPanel } from './components/BotTasksPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { CommandPalette } from './components/CommandPalette'
import { GlobalFind } from './components/GlobalFind'
import { AskUserDialog } from './components/AskUserDialog'
import { ModulePanel } from './components/ModulePanel'
import { ModuleHistoryOverlay } from './components/ModuleHistoryOverlay'
import { TraceViewerModal } from './components/TraceViewerModal'
import { PromptModal, ConfirmModal } from './components/Modal'
import { Resizer } from './components/Resizer'
import { DashboardPage } from './DashboardPage'
import type { Tab, ToolCallInfo } from '@shared/types'
import { addUsage, normalizeUsage } from '@shared/usage'

function isMacPlatform(): boolean {
  try {
    if (typeof window !== 'undefined' && window.electron?.process?.platform) {
      return window.electron.process.platform === 'darwin'
    }
  } catch {
    /* ignore */
  }
  if (typeof navigator !== 'undefined') {
    return navigator.userAgent.includes('Mac')
  }
  return false
}

const SIDEBAR_MIN = 240
const SIDEBAR_MAX = 560
const CHAT_MIN = 280
const CHAT_MAX = 720

function hasOpenOverlay(): boolean {
  const s = useAppStore.getState()
  return (
    document.querySelector('.modal-overlay') !== null ||
    s.commandPaletteOpen ||
    s.globalFindOpen ||
    s.moduleHistoryRunId !== null
  )
}

const KANBAN_TOOLS = new Set([
  'list_kanban_cards',
  'create_kanban_card',
  'update_kanban_card',
  'add_kanban_comment',
  'move_kanban_card',
  'delete_kanban_card'
])

const NOTE_TOOLS = new Set(['create_note', 'update_note', 'delete_note'])

const PLANNER_TOOLS = new Set([
  'list_schedules',
  'read_schedule',
  'create_schedule',
  'update_schedule',
  'add_task',
  'update_task',
  'set_calendar'
])

const VTAB_BAR_WIDTH = 48

function VTabs({
  onDashboard,
  onTab
}: {
  onDashboard: () => void
  onTab: (id: Tab) => void
}): React.JSX.Element {
  const tab = useAppStore((s) => s.tab)
  const activeProject = useAppStore((s) => s.activeProject)
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!tip) return
    const hide = (): void => setTip(null)
    window.addEventListener('scroll', hide, true)
    return () => window.removeEventListener('scroll', hide, true)
  }, [tip])

  function showTip(e: React.MouseEvent<HTMLElement>, label: string): void {
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ label, x: r.right + 8, y: r.top + r.height / 2 })
  }

  function hideTip(e: React.MouseEvent<HTMLElement>): void {
    if (e.relatedTarget) setTip(null)
  }

  const tabs: Array<{ id: Tab; icon: string; title: string }> = [
    { id: 'notes', icon: mdiNotebookOutline, title: 'Notes' },
    { id: 'kanban', icon: mdiBulletinBoard, title: 'Kanban' },
    { id: 'planner', icon: mdiChartTimeline, title: 'Planner' },
    { id: 'files', icon: tab === 'files' ? mdiFolderOpenOutline : mdiFolderOutline, title: 'Files' }
  ]

  const tipHandlers = (
    label: string
  ): {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => void
  } => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showTip(e, label),
    onMouseLeave: hideTip
  })

  return (
    <>
      <div className="vtabs-inner">
        <button
          className={`vtabs-btn ${tab === 'dashboard' ? 'active' : ''} ${!activeProject ? 'disabled' : ''}`}
          onClick={onDashboard}
          {...tipHandlers('Dashboard')}
        >
          <MdiIcon path={mdiViewDashboardOutline} size={18} />
        </button>
        <div className="vtabs-sep" />
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`vtabs-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => onTab(t.id)}
            {...tipHandlers(t.title)}
          >
            <MdiIcon path={t.icon} size={18} />
          </button>
        ))}
      </div>
      {tip &&
        createPortal(
          <div className="vtabs-tip" style={{ left: tip.x, top: tip.y }}>
            {tip.label}
          </div>,
          document.body
        )}
    </>
  )
}

function EmptyProject(): React.JSX.Element {
  const createProject = useAppStore((s) => s.createProject)
  const [creating, setCreating] = useState(false)

  return (
    <div className="empty-state">
      <h1>Welcome to PTNotes</h1>
      <p>Create your first project to start writing notes and managing tasks.</p>
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
  const createNote = useAppStore((s) => s.createNote)
  const [creating, setCreating] = useState(false)

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
    <ConfirmModal
      title="Confirm Delete"
      onClose={() => void respond(false)}
      onConfirm={() => void respond(true)}
      message={req.message}
    >
      <ul className="confirm-list">
        {req.items.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </ConfirmModal>
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
  const botsOpen = useAppStore((s) => s.botsOpen)
  const rightView = useAppStore((s) => s.rightView)
  const rightOpen = chatOpen || moduleOpen || botsOpen
  const setRightView = useAppStore((s) => s.setRightView)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const snapshotsOpen = useAppStore((s) => s.snapshotsOpen)
  const storeSidebarVisible = useAppStore((s) => s.sidebarVisible)
  // Temporary show state: panelPeek reveals a closed sidebar panel while the
  // mouse is over the tab strip (auto-hidden on leave).
  const [panelPeek, setPanelPeek] = useState(false)
  /** Keeps the panel overlay-positioned while its hide animation runs so the
      static re-flow hits it already collapsed and the main area never shifts. */
  const [panelPeekClosing, setPanelPeekClosing] = useState(false)
  const hidePeekTimer = useRef<number | null>(null)
  const peekCloseTimer = useRef<number | null>(null)
  const peekEnabled = !storeSidebarVisible
  const sidebarVisible = tab === 'dashboard' ? false : storeSidebarVisible || panelPeek
  const panelPeekClass =
    (panelPeek || panelPeekClosing) && tab !== 'dashboard' && !storeSidebarVisible
  const askRequest = useAppStore((s) => s.askRequest)
  const kanbanEditingId = useAppStore((s) => s.kanbanEditingId)
  const kanbanViewingId = useAppStore((s) => s.kanbanViewingId)
  const kanbanCreatingColumnId = useAppStore((s) => s.kanbanCreatingColumnId)
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
    const theme = useAppStore.getState().theme
    document.documentElement.setAttribute('data-theme', theme)
    const fontSize = useAppStore.getState().fontSize
    document.documentElement.setAttribute('data-font-size', fontSize)
    const density = useAppStore.getState().uiDensity
    document.documentElement.setAttribute('data-ui-density', density)
    const editorFont = useAppStore.getState().editorFontFamily
    document.documentElement.setAttribute('data-editor-font', editorFont)
    const translucent = useAppStore.getState().surfaceTranslucent
    document.documentElement.setAttribute('data-surface-translucent', translucent ? 'on' : 'off')
  }, [init])

  // V-tab strip hover peek: reveal a closed sidebar panel while the mouse is
  // over the strip; auto-hide shortly after the mouse leaves.
  function showPeek(): void {
    if (!peekEnabled || snapshotsOpen) return
    if (hidePeekTimer.current !== null) {
      window.clearTimeout(hidePeekTimer.current)
      hidePeekTimer.current = null
    }
    if (peekCloseTimer.current !== null) {
      window.clearTimeout(peekCloseTimer.current)
      peekCloseTimer.current = null
      setPanelPeekClosing(false)
    }
    if (!storeSidebarVisible && tab !== 'dashboard') setPanelPeek(true)
  }

  function scheduleHidePeek(): void {
    if (hidePeekTimer.current !== null) window.clearTimeout(hidePeekTimer.current)
    hidePeekTimer.current = window.setTimeout(() => {
      hidePeekTimer.current = null
      setPanelPeek(false)
      if (tab !== 'dashboard' && !storeSidebarVisible) {
        setPanelPeekClosing(true)
        peekCloseTimer.current = window.setTimeout(() => {
          peekCloseTimer.current = null
          setPanelPeekClosing(false)
        }, 260)
      }
    }, 200)
  }

  useEffect(() => {
    return () => {
      if (hidePeekTimer.current !== null) window.clearTimeout(hidePeekTimer.current)
      if (peekCloseTimer.current !== null) window.clearTimeout(peekCloseTimer.current)
    }
  }, [])

  // Opening a modal that renders over the whole app (e.g. planner snapshots, which
  // lives in the sidebar panel) must not keep the peek panel visible — drop it.
  useEffect(() => {
    return useAppStore.subscribe((state, prev) => {
      if (!state.snapshotsOpen || prev.snapshotsOpen) return
      if (hidePeekTimer.current !== null) {
        window.clearTimeout(hidePeekTimer.current)
        hidePeekTimer.current = null
      }
      if (peekCloseTimer.current !== null) {
        window.clearTimeout(peekCloseTimer.current)
        peekCloseTimer.current = null
      }
      setPanelPeek(false)
      setPanelPeekClosing(false)
    })
  }, [])

  // Switching to the dashboard while the panel is peeking drops the overlay
  // instantly (no hide animation), since the dashboard owns the full main area.
  const [sidebarInstant, setSidebarInstant] = useState(false)
  function goDashboard(): void {
    const dropping = panelPeek || panelPeekClosing
    if (hidePeekTimer.current !== null) {
      window.clearTimeout(hidePeekTimer.current)
      hidePeekTimer.current = null
    }
    if (peekCloseTimer.current !== null) {
      window.clearTimeout(peekCloseTimer.current)
      peekCloseTimer.current = null
    }
    setPanelPeek(false)
    setPanelPeekClosing(false)
    if (dropping) {
      setSidebarInstant(true)
      window.setTimeout(() => setSidebarInstant(false), 260)
    }
    useAppStore.getState().setTab('dashboard')
  }

  // Tab switch: re-arm the peek so the destination panel is temporarily shown
  // even when the mouse never left the strip (e.g. returning from dashboard).
  function goTab(id: Tab): void {
    if (hidePeekTimer.current !== null) {
      window.clearTimeout(hidePeekTimer.current)
      hidePeekTimer.current = null
    }
    if (peekCloseTimer.current !== null) {
      window.clearTimeout(peekCloseTimer.current)
      peekCloseTimer.current = null
      setPanelPeekClosing(false)
    }
    useAppStore.getState().setTab(id)
    if (!useAppStore.getState().sidebarVisible) setPanelPeek(true)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const remote = await window.ptnotes.settings.getAppearance()
        const state = useAppStore.getState()
        if (!cancelled) {
          const patch: Array<() => void> = []
          if (remote.theme && remote.theme !== state.theme)
            patch.push(() => state.setTheme(remote.theme))
          if (remote.fontSize && remote.fontSize !== state.fontSize)
            patch.push(() => state.setFontSize(remote.fontSize))
          if (remote.uiDensity && remote.uiDensity !== state.uiDensity)
            patch.push(() => state.setUiDensity(remote.uiDensity))
          if (remote.editorFontFamily && remote.editorFontFamily !== state.editorFontFamily) {
            patch.push(() => state.setEditorFontFamily(remote.editorFontFamily))
          }
          if (remote.surfaceTranslucent !== state.surfaceTranslucent) {
            patch.push(() => state.setSurfaceTranslucent(remote.surfaceTranslucent))
          }
          if (remote.sidebarVisible !== state.sidebarVisible) {
            state.setSidebarVisible(remote.sidebarVisible)
          }
          patch.forEach((fn) => fn())
        }
      } catch {
        /* preload IPC unavailable in isolated renderer/HMR; safe to ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Handle AI stream events: update chat store, auto-refresh notes/kanban on tool calls
  useEffect(() => {
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
              if (KANBAN_TOOLS.has(tc.name)) {
                void state.refreshKanban()
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

  // Handle bots group chat events: append messages, typing indicators
  useEffect(() => {
    return window.ptnotes.bots.onEvent((evt) => {
      useAppStore.getState().applyBotGroupEvent(evt)
    })
  }, [])

  // Handle module run events: upsert run state in the store in real time
  useEffect(() => {
    return window.ptnotes.modules.onEvent((evt) => {
      const state = useAppStore.getState()
      state.applyModuleEvent(evt)
      if (evt.type === 'output' || evt.type === 'done') {
        void state.refreshFiles()
        if (state.tab === 'files') void state.loadExplorer()
      }
      // Background module runs (e.g. the subagent) can mutate notes, the kanban
      // board and planner schedules; keep the UI in sync so a later save cannot
      // wipe their changes.
      const doneTool =
        evt.type === 'tool' && evt.toolCall && evt.toolCall.ok !== undefined ? evt.toolCall : null
      if (doneTool && evt.project === state.activeProject) {
        if (KANBAN_TOOLS.has(doneTool.name)) {
          void state.refreshKanban()
        }
        if (NOTE_TOOLS.has(doneTool.name)) {
          void state.refreshNotes()
          reloadActiveNoteIfUpdated(doneTool)
        }
        if (PLANNER_TOOLS.has(doneTool.name)) {
          void state.refreshSchedules()
          if (
            (doneTool.name === 'add_task' || doneTool.name === 'update_task') &&
            state.activeScheduleId
          ) {
            void state.selectSchedule(state.activeScheduleId)
          }
          if (doneTool.name === 'set_calendar') {
            void state.loadCalendar()
          }
        }
      }
    })
  }, [])

  // Global panel shortcuts: Cmd/Ctrl+Shift+C toggles chat, Cmd/Ctrl+Shift+M toggles modules,
  // Cmd/Ctrl+Shift+G toggles the bots group chat
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const mod = (isMacPlatform() ? e.metaKey : e.ctrlKey) && e.shiftKey
      if (!mod || e.altKey) return
      const key = e.key.toLowerCase()
      if (key !== 'c' && key !== 'm' && key !== 'g') return
      if (hasOpenOverlay()) return
      e.preventDefault()
      const view = key === 'c' ? 'chat' : key === 'm' ? 'modules' : 'bots'
      if (view !== 'chat' && !activeProject) return
      setRightView(view)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeProject, setRightView])

  // Global command palette shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const toggleCommandPalette = useAppStore.getState().toggleCommandPalette
    function onKeyDown(e: KeyboardEvent): void {
      const isMac = isMacPlatform()
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (!mod || e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== 'k') return
      if (hasOpenOverlay()) return
      e.preventDefault()
      toggleCommandPalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const openFind = useAppStore.getState().setGlobalFindOpen
    const dispose = window.ptnotes.onOpenFind(() => {
      const state = useAppStore.getState()
      if (state.globalFindOpen) {
        const input = document.querySelector('.global-find-input') as HTMLInputElement | null
        input?.focus()
        input?.select()
        return
      }
      if (hasOpenOverlay()) return
      openFind(true)
    })
    return dispose
  }, [])

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
          <div
            className={`left-strip${peekEnabled ? ' peek-enabled' : ''}`}
            onMouseEnter={showPeek}
            onMouseLeave={scheduleHidePeek}
          >
            <div className="vtabs">
              <VTabs onDashboard={goDashboard} onTab={goTab} />
            </div>
            <aside
              ref={sidebarRef}
              className={`sidebar${sidebarVisible ? '' : ' collapsed'}${panelPeekClass ? ' peek' : ''}${sidebarInstant ? ' instant' : ''}`}
              style={{ width: sidebarVisible ? sidebarWidth : 0, left: VTAB_BAR_WIDTH }}
            >
              <div key={tab} className="sidebar-panel">
                {tab === 'kanban' ? (
                  <KanbanPanel />
                ) : tab === 'planner' ? (
                  <PlannerPanel />
                ) : tab === 'files' ? (
                  <FileTreePanel />
                ) : (
                  <NoteList />
                )}
              </div>
            </aside>
          </div>
          {sidebarVisible && !panelPeek && (
            <Resizer
              position="end"
              targetRef={sidebarRef}
              min={SIDEBAR_MIN}
              max={SIDEBAR_MAX}
              onCommit={setSidebarWidth}
            />
          )}
          <main className="main-area">
            {tab === 'dashboard' ? (
              <DashboardPage />
            ) : tab === 'files' ? (
              <FileListPanel key={activeProject} />
            ) : tab === 'planner' ? (
              activeScheduleId ? (
                <PlannerEditor key={activeScheduleId} />
              ) : (
                <EmptyPlanner />
              )
            ) : tab === 'kanban' ? (
              <KanbanBoard />
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
            ) : rightView === 'botTasks' ? (
              moduleResizing ? (
                <ModuleSkeleton />
              ) : (
                <div className="module-drawer">
                  <BotTasksPanel />
                </div>
              )
            ) : rightView === 'bots' ? (
              chatResizing ? (
                <ChatSkeleton />
              ) : (
                <GroupChatPanel />
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
      <CommandPalette />
      <GlobalFind />
      {(kanbanEditingId || kanbanCreatingColumnId || kanbanViewingId) && (
        <KanbanCardModal key={kanbanEditingId ?? kanbanCreatingColumnId ?? kanbanViewingId} />
      )}
      <ConfirmDeleteDialog />
      <AskUserDialog key={askRequest?.id ?? 'none'} />
      <ModuleHistoryOverlay />
      <TraceViewerModal />
    </div>
  )
}

export default App
