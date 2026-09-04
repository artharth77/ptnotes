import { create } from 'zustand'
import { rollupScheduleTasks } from '@shared/planner'
import { GROUP_CHAT_PAGE_SIZE } from '@shared/bots'
import { ancestorsOf } from '@shared/filesExplorer'
import type {
  BotGroupEvent,
  BotProfile,
  BotUpsertInput,
  GroupChatMeta,
  GroupMessage,
  GroupPatch,
  NewGroupInput
} from '@shared/bots'

/** Loaded-window bookkeeping for a paged group chat (the store holds only the loaded slice). */
interface BotGroupWindow {
  hasMore: boolean
  oldestSeq: number | null
  total: number
}
import type {
  AskAnswer,
  AskRequest,
  ChatMessage,
  ChatSessionMeta,
  ConfirmRequest,
  KanbanArchive,
  KanbanBoard,
  KanbanCardPatch,
  KanbanColumnPatch,
  ModuleEvent,
  ModuleRun,
  NewKanbanCardInput,
  NewKanbanColumnInput,
  NoteMeta,
  NoteSearchMatch,
  Project,
  ProjectCalendar,
  Schedule,
  ScheduleMeta,
  Tab,
  ToolCallInfo,
  FileEntry,
  ExplorerEntry,
  ExplorerFolderNode
} from '@shared/types'

function readKanbanCollapsed(project: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(`ptnotes:kanban-collapsed:${project}`)
    const data = raw ? (JSON.parse(raw) as unknown) : {}
    return data && typeof data === 'object' ? (data as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

interface AppState {
  projects: Project[]
  activeProject: string | null
  notes: NoteMeta[]
  activeNoteId: string | null
  noteContent: string
  kanban: KanbanBoard | null
  kanbanArchive: KanbanArchive | null
  kanbanListView: 'active' | 'archived'
  activeKanbanCardId: string | null
  kanbanEditingId: string | null
  kanbanViewingId: string | null
  kanbanCreatingColumnId: string | null
  kanbanCollapsed: Record<string, boolean>
  projectFiles: string[]
  projectFileEntries: FileEntry[]
  schedules: ScheduleMeta[]
  activeScheduleId: string | null
  scheduleContent: Schedule | null
  calendar: ProjectCalendar | null
  plannerUndo: Record<string, Schedule[]>
  plannerRedo: Record<string, Schedule[]>
  tab: Tab
  chatOpen: boolean
  moduleOpen: boolean
  botsOpen: boolean
  rightView: 'chat' | 'bots' | 'modules' | 'botTasks'
  // ---- Bots group chat ----
  botProfiles: BotProfile[]
  botGroups: Record<string, GroupChatMeta[]>
  activeBotGroupId: Record<string, string | null>
  botGroupMessages: Record<string, GroupMessage[]>
  botGroupWindowMeta: Record<string, BotGroupWindow>
  botGroupBusy: Record<string, boolean>
  /** Bot currently composing, per group id. */
  botTyping: Record<string, string | null>
  botTaskRuns: Record<string, ModuleRun[]>
  chatMessages: Record<string, ChatMessage[]>
  chatSessionIds: Record<string, string>
  chatSessions: Record<string, ChatSessionMeta[]>
  chatTitles: Record<string, string>
  moduleRuns: Record<string, ModuleRun[]>
  /** Live subagent tool-call lifecycle per run id (transient; never persisted). */
  moduleToolCalls: Record<string, ToolCallInfo[]>
  moduleHistoryRunId: string | null
  traceViewer: { kind: 'chat' | 'module' | 'bots'; key: string; title: string } | null
  chatBusy: boolean
  chatStreamProject: string | null
  chatWaitRuns: string[]
  confirmRequest: ConfirmRequest | null
  askRequest: AskRequest | null
  settingsOpen: boolean
  settingsCategory:
    'storage' | 'ai' | 'modules' | 'about' | 'skills' | 'toolsets' | 'bots' | 'appearance'
  skillEditRequest: string | null
  sidebarVisible: boolean
  /** File explorer location: path relative to the project files root ('' = root). */
  explorerCwd: string
  explorerTree: ExplorerFolderNode | null
  explorerEntries: ExplorerEntry[]
  explorerSelected: string[]
  explorerLastClicked: string | null
  /** Folder paths the user manually expanded ('' = files root). */
  explorerExpanded: string[]
  /** Manual collapse overrides — win over the auto-expand of the cwd's ancestor chain. */
  explorerCollapsed: string[]
  formatHelperEnabled: boolean
  theme: 'light' | 'dark' | 'system'
  fontSize: 'small' | 'default' | 'large' | 'xlarge'
  uiDensity: 'compact' | 'cozy'
  editorFontFamily: 'sans' | 'serif' | 'mono'
  commandPaletteOpen: boolean
  commandPaletteQuery: string
  commandPaletteActiveIndex: number
  notesSort: 'name' | 'created' | 'modified'
  notesSortDir: 'asc' | 'desc'
  globalFindOpen: boolean
  globalFindQuery: string
  globalFindMatches: NoteSearchMatch[]
  globalFindLoading: boolean
  loading: boolean

  init: () => Promise<void>
  refreshProjects: () => Promise<Project[]>
  createProject: (name: string) => Promise<void>
  recreateProject: (name: string) => Promise<void>
  renameProject: (oldName: string, newName: string) => Promise<void>
  deleteProject: (name: string) => Promise<void>
  changeRoot: (newRoot: string) => Promise<void>
  selectProject: (name: string) => Promise<void>
  refreshNotes: () => Promise<void>
  toggleNoteStarred: (noteId: string, starred: boolean) => Promise<void>
  setNotesSort: (sort: 'name' | 'created' | 'modified') => void
  toggleNotesSortDir: () => void
  setGlobalFindOpen: (open: boolean) => void
  setGlobalFindQuery: (q: string) => void
  runGlobalFind: (q: string) => Promise<void>
  clearGlobalFind: () => void
  refreshKanban: () => Promise<void>
  createKanbanCard: (input: NewKanbanCardInput) => Promise<void>
  updateKanbanCard: (cardId: string, patch: KanbanCardPatch) => Promise<void>
  moveKanbanCard: (cardId: string, columnId: string, index?: number) => Promise<void>
  deleteKanbanCard: (cardId: string) => Promise<void>
  addKanbanComment: (cardId: string, comment: string, commentBy?: string) => Promise<void>
  updateKanbanComment: (cardId: string, commentId: string, comment: string) => Promise<void>
  deleteKanbanComment: (cardId: string, commentId: string) => Promise<void>
  addKanbanColumn: (input: NewKanbanColumnInput) => Promise<void>
  updateKanbanColumn: (columnId: string, patch: KanbanColumnPatch) => Promise<void>
  moveKanbanColumn: (columnId: string, toIndex: number) => Promise<void>
  deleteKanbanColumn: (
    columnId: string,
    options: { mode: 'move' | 'delete'; targetColumnId?: string }
  ) => Promise<void>
  setKanbanListView: (view: 'active' | 'archived') => void
  archiveKanbanCard: (cardId: string) => Promise<void>
  restoreKanbanCard: (cardId: string) => Promise<void>
  deleteArchivedKanbanCard: (cardId: string) => Promise<void>
  setActiveKanbanCard: (id: string | null) => void
  openKanbanEditor: (id: string) => void
  closeKanbanEditor: () => void
  openKanbanViewer: (id: string) => void
  closeKanbanViewer: () => void
  openKanbanCreate: (columnId: string) => void
  closeKanbanCreate: () => void
  toggleKanbanColumn: (columnId: string) => void
  refreshFiles: () => Promise<void>
  refreshSchedules: () => Promise<void>
  loadCalendar: () => Promise<void>
  selectSchedule: (id: string) => Promise<void>
  updateScheduleContent: (schedule: Schedule) => void
  saveSchedule: (schedule: Schedule) => Promise<void>
  createSchedule: (name: string) => Promise<void>
  renameSchedule: (id: string, newName: string) => Promise<void>
  deleteSchedule: (id: string) => Promise<void>
  saveCalendar: (calendar: ProjectCalendar) => Promise<void>
  plannerPushUndo: (scheduleId: string, snapshot: Schedule) => void
  plannerClearRedo: (scheduleId: string) => void
  plannerTruncateUndo: (scheduleId: string, length: number) => void
  plannerClearHistory: (scheduleId: string) => void
  undoPlanner: () => Schedule | null
  redoPlanner: () => Schedule | null
  loadModules: (project: string) => Promise<void>
  applyModuleEvent: (evt: ModuleEvent) => void
  setModuleHistoryRunId: (runId: string | null) => void
  openTraceViewer: (v: { kind: 'chat' | 'module' | 'bots'; key: string; title: string }) => void
  closeTraceViewer: () => void
  // ---- Bots group chat ----
  loadBotProfiles: () => Promise<void>
  saveBotProfile: (input: BotUpsertInput) => Promise<void>
  deleteBotProfile: (id: string) => Promise<void>
  loadBotGroups: (project: string) => Promise<void>
  openBotGroup: (project: string, groupId: string) => Promise<void>
  loadOlderBotGroupMessages: (project: string, groupId: string) => Promise<void>
  createBotGroup: (project: string, input: NewGroupInput) => Promise<GroupChatMeta>
  updateBotGroup: (project: string, groupId: string, patch: GroupPatch) => Promise<void>
  deleteBotGroup: (project: string, groupId: string) => Promise<void>
  clearBotGroupHistory: (project: string, groupId: string) => Promise<void>
  sendBotGroupMessage: (text: string) => Promise<void>
  stopBotGroup: () => Promise<void>
  respondBotGroupAsk: (
    project: string,
    groupId: string,
    messageId: string,
    answers: AskAnswer[],
    cancelled: boolean
  ) => Promise<void>
  applyBotGroupEvent: (evt: BotGroupEvent) => void
  loadBotTasks: (project: string) => Promise<void>
  selectNote: (id: string) => Promise<void>
  saveNote: (content: string) => Promise<void>
  createNote: (title: string) => Promise<void>
  renameNote: (id: string, newTitle: string) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  setTab: (tab: Tab) => void
  setChatOpen: (open: boolean) => void
  setRightView: (view: 'chat' | 'bots' | 'modules' | 'botTasks') => void
  appendChatMessage: (project: string, msg: ChatMessage) => void
  updateLastAssistantMessage: (project: string, updater: (msg: ChatMessage) => ChatMessage) => void
  clearChatMessages: (project: string) => void
  setChatBusy: (busy: boolean) => void
  setChatStreamProject: (project: string | null) => void
  setChatWaitRuns: (runIds: string[]) => void
  setConfirmRequest: (req: ConfirmRequest | null) => void
  setAskRequest: (req: AskRequest | null) => void
  setSettingsOpen: (open: boolean) => void
  setSettingsCategory: (
    category: 'storage' | 'ai' | 'modules' | 'about' | 'skills' | 'toolsets' | 'bots' | 'appearance'
  ) => void
  openSettings: (
    category?:
      'storage' | 'ai' | 'modules' | 'about' | 'skills' | 'toolsets' | 'bots' | 'appearance'
  ) => void
  openSkillEditor: (name: string) => void
  clearSkillEditRequest: () => void
  setSidebarVisible: (visible: boolean) => void
  /** Load the explorer tree + listing for `dir` (or the current `explorerCwd`). */
  loadExplorer: (dir?: string) => Promise<void>
  selectExplorerFolder: (path: string) => void
  toggleExplorerFolder: (path: string) => void
  selectExplorerEntry: (path: string, mode: 'single' | 'toggle' | 'range') => void
  setExplorerSelected: (paths: string[]) => void
  setFormatHelperEnabled: (enabled: boolean) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setFontSize: (size: 'small' | 'default' | 'large' | 'xlarge') => void
  setUiDensity: (density: 'compact' | 'cozy') => void
  setEditorFontFamily: (family: 'sans' | 'serif' | 'mono') => void
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  setCommandPaletteQuery: (q: string) => void
  setCommandPaletteActiveIndex: (i: number) => void
  newChat: (project: string) => Promise<void>
  openChat: (project: string, sessionId: string) => Promise<void>
  deleteChat: (project: string, sessionId: string) => Promise<void>
  loadChatSessions: (project: string) => Promise<void>
  getActiveSessionId: (project: string | null) => string | undefined
  setChatTitle: (project: string, title: string) => void
  renameChat: (project: string, sessionId: string, title: string) => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  activeProject: null,
  notes: [],
  activeNoteId: null,
  noteContent: '',
  kanban: null,
  kanbanArchive: null,
  kanbanListView: 'active',
  activeKanbanCardId: null,
  kanbanEditingId: null,
  kanbanViewingId: null,
  kanbanCreatingColumnId: null,
  kanbanCollapsed: {},
  projectFiles: [],
  projectFileEntries: [],
  schedules: [],
  activeScheduleId: null,
  scheduleContent: null,
  calendar: null,
  plannerUndo: {},
  plannerRedo: {},
  tab: 'notes',
  chatOpen: false,
  moduleOpen: false,
  botsOpen: false,
  rightView: 'chat',
  botProfiles: [],
  botGroups: {},
  activeBotGroupId: {},
  botGroupMessages: {},
  botGroupWindowMeta: {},
  botGroupBusy: {},
  botTyping: {},
  botTaskRuns: {},
  chatMessages: {},
  chatSessionIds: {},
  chatSessions: {},
  chatTitles: {},
  moduleRuns: {},
  moduleToolCalls: {},
  moduleHistoryRunId: null,
  traceViewer: null,
  chatBusy: false,
  chatStreamProject: null,
  chatWaitRuns: [],
  confirmRequest: null,
  askRequest: null,
  settingsOpen: false,
  settingsCategory: 'storage',
  skillEditRequest: null,
  sidebarVisible: true,
  explorerCwd: '',
  explorerTree: null,
  explorerEntries: [],
  explorerSelected: [],
  explorerLastClicked: null,
  explorerExpanded: [''],
  explorerCollapsed: [],
  formatHelperEnabled: localStorage.getItem('ptnotes:formatHelper') !== '0',
  theme: (localStorage.getItem('ptnotes:theme') as 'light' | 'dark' | 'system' | null) ?? 'system',
  fontSize:
    (localStorage.getItem('ptnotes:fontSize') as 'small' | 'default' | 'large' | 'xlarge' | null) ??
    'default',
  uiDensity: (localStorage.getItem('ptnotes:uiDensity') as 'compact' | 'cozy' | null) ?? 'cozy',
  editorFontFamily:
    (localStorage.getItem('ptnotes:editorFont') as 'sans' | 'serif' | 'mono' | null) ?? 'sans',
  commandPaletteOpen: false,
  commandPaletteQuery: '',
  commandPaletteActiveIndex: 0,
  notesSort:
    (localStorage.getItem('ptnotes:notesSort') as 'name' | 'created' | 'modified' | null) ??
    'modified',
  notesSortDir: (localStorage.getItem('ptnotes:notesSortDir') as 'asc' | 'desc' | null) ?? 'desc',
  globalFindOpen: false,
  globalFindQuery: '',
  globalFindMatches: [],
  globalFindLoading: false,
  loading: false,

  async init() {
    const projects = await window.ptnotes.projects.list()
    set({ projects })
    const saved = localStorage.getItem('ptnotes:activeProject')
    const target = projects.find((p) => p.name === saved)?.name ?? projects[0]?.name ?? null
    if (target) {
      await get().selectProject(target)
    } else {
      set({ activeProject: null })
    }
  },

  async refreshProjects() {
    const projects = await window.ptnotes.projects.list()
    set({ projects })
    return projects
  },

  async createProject(name) {
    const project = await window.ptnotes.projects.create(name)
    const projects = await get().refreshProjects()
    set({ projects: projects.length ? projects : [project] })
    await get().selectProject(project.name)
    if (project.welcomeCreated) {
      await get().selectNote('welcome')
    }
  },

  async recreateProject(name) {
    const project = await window.ptnotes.projects.recreate(name)
    const projects = await get().refreshProjects()
    set({ projects: projects.length ? projects : [project] })
    await get().selectProject(project.name)
    if (project.welcomeCreated) {
      await get().selectNote('welcome')
    }
  },

  async renameProject(oldName, newName) {
    await window.ptnotes.projects.rename(oldName, newName)
    const projects = await get().refreshProjects()
    set({ projects })
    if (get().activeProject === oldName) {
      await get().selectProject(newName)
    }
  },

  async deleteProject(name) {
    await window.ptnotes.projects.delete(name)
    const projects = await get().refreshProjects()
    set((state) => {
      const chatMessages = { ...state.chatMessages }
      delete chatMessages[name]
      return {
        projects,
        chatMessages,
        chatStreamProject: state.chatStreamProject === name ? null : state.chatStreamProject,
        moduleHistoryRunId: state.activeProject === name ? null : state.moduleHistoryRunId
      }
    })
    if (get().activeProject === name) {
      const next = projects[0]?.name ?? null
      if (next) {
        await get().selectProject(next)
      } else {
        set({
          activeProject: null,
          notes: [],
          kanban: null,
          kanbanArchive: null,
          kanbanListView: 'active',
          activeKanbanCardId: null,
          kanbanEditingId: null,
          kanbanViewingId: null,
          kanbanCreatingColumnId: null,
          kanbanCollapsed: {},
          activeNoteId: null,
          noteContent: ''
        })
      }
    }
  },

  async changeRoot(newRoot) {
    await window.ptnotes.settings.changeRoot(newRoot)
    await get().refreshProjects()
    const active = get().activeProject
    if (active) {
      await get().selectProject(active)
    }
  },

  async selectProject(name) {
    localStorage.setItem('ptnotes:activeProject', name)
    set({
      activeProject: name,
      activeNoteId: null,
      noteContent: '',
      activeScheduleId: null,
      scheduleContent: null,
      activeKanbanCardId: null,
      kanbanEditingId: null,
      kanbanViewingId: null,
      kanbanCreatingColumnId: null,
      kanbanListView: 'active',
      loading: true,
      moduleHistoryRunId: null,
      explorerCwd: '',
      explorerTree: null,
      explorerEntries: []
    })
    await Promise.all([
      get().refreshNotes(),
      get().refreshKanban(),
      get().refreshFiles(),
      get().refreshSchedules(),
      get().loadCalendar(),
      get().loadModules(name),
      get().loadChatSessions(name)
    ])
    set((state) => {
      if (!state.chatSessionIds[name]) {
        return {
          loading: false,
          chatSessionIds: { ...state.chatSessionIds, [name]: crypto.randomUUID() },
          chatTitles: { ...state.chatTitles, [name]: '' }
        }
      }
      return { loading: false }
    })
    if (get().tab === 'files') await get().loadExplorer()
  },

  async refreshNotes() {
    const project = get().activeProject
    if (!project) return set({ notes: [] })
    const notes = await window.ptnotes.notes.list(project)
    const { activeNoteId } = get()
    if (activeNoteId && !notes.some((n) => n.id === activeNoteId)) {
      set({ notes, activeNoteId: null, noteContent: '' })
    } else {
      set({ notes })
    }
  },

  async toggleNoteStarred(noteId, starred) {
    const project = get().activeProject
    if (!project) return
    const existing = get().notes.find((n) => n.id === noteId)
    if (existing) {
      set({
        notes: get().notes.map((n) => (n.id === noteId ? { ...n, starred: !!starred } : n))
      })
    }
    try {
      const notes = await window.ptnotes.notes.setStarred(project, noteId, !!starred)
      set({ notes })
    } catch {
      void get().refreshNotes()
    }
  },

  setNotesSort(sort) {
    localStorage.setItem('ptnotes:notesSort', sort)
    set({ notesSort: sort })
  },

  toggleNotesSortDir() {
    const next = get().notesSortDir === 'asc' ? 'desc' : 'asc'
    localStorage.setItem('ptnotes:notesSortDir', next)
    set({ notesSortDir: next })
  },

  setGlobalFindOpen(open) {
    set({ globalFindOpen: open })
  },

  setGlobalFindQuery(q) {
    set({ globalFindQuery: q })
  },

  async runGlobalFind(q) {
    const project = get().activeProject
    if (!project) return
    const trimmed = q.trim()
    set({ globalFindQuery: q, globalFindMatches: [], globalFindLoading: !!trimmed })
    if (!trimmed) return
    try {
      const matches = await window.ptnotes.notes.search(project, trimmed)
      set({ globalFindMatches: matches, globalFindLoading: false })
    } catch {
      set({ globalFindMatches: [], globalFindLoading: false })
    }
  },

  clearGlobalFind() {
    set({
      globalFindOpen: false,
      globalFindQuery: '',
      globalFindMatches: [],
      globalFindLoading: false
    })
  },

  async refreshKanban() {
    const project = get().activeProject
    if (!project) return set({ kanban: null, kanbanArchive: null })
    const [kanban, kanbanArchive] = await Promise.all([
      window.ptnotes.kanban.load(project),
      window.ptnotes.kanban.loadArchive(project)
    ])
    set({ kanban, kanbanArchive, kanbanCollapsed: readKanbanCollapsed(project) })
  },

  async createKanbanCard(input) {
    const project = get().activeProject
    if (!project) return
    try {
      const board = await window.ptnotes.kanban.createCard(project, input)
      set({ kanban: board })
    } catch {
      await get().refreshKanban()
    }
  },

  async updateKanbanCard(cardId, patch) {
    const project = get().activeProject
    if (!project) return
    try {
      const board = await window.ptnotes.kanban.updateCard(project, cardId, patch)
      set({ kanban: board })
    } catch {
      await get().refreshKanban()
    }
  },

  async moveKanbanCard(cardId, columnId, index) {
    const project = get().activeProject
    if (!project) return
    const kanban = get().kanban
    if (kanban) {
      const card = kanban.cards.find((c) => c.id === cardId)
      if (card) {
        const rest = kanban.cards.filter((c) => c.id !== cardId)
        const moved = { ...card, columnId }
        const inColumn = rest.filter((c) => c.columnId === columnId)
        const at =
          index === undefined ? inColumn.length : Math.max(0, Math.min(index, inColumn.length))
        if (at >= inColumn.length) {
          rest.push(moved)
        } else {
          const anchor = inColumn[at]
          rest.splice(
            rest.findIndex((c) => c.id === anchor.id),
            0,
            moved
          )
        }
        set({ kanban: { ...kanban, cards: rest } })
      }
    }
    try {
      const board = await window.ptnotes.kanban.moveCard(project, cardId, columnId, index)
      set({ kanban: board })
    } catch {
      await get().refreshKanban()
    }
  },

  async deleteKanbanCard(cardId) {
    const project = get().activeProject
    if (!project) return
    const kanban = get().kanban
    if (kanban) set({ kanban: { ...kanban, cards: kanban.cards.filter((c) => c.id !== cardId) } })
    try {
      const board = await window.ptnotes.kanban.deleteCard(project, cardId)
      set({ kanban: board })
    } catch {
      await get().refreshKanban()
    }
  },

  async addKanbanComment(cardId, comment, commentBy) {
    const project = get().activeProject
    if (!project) return
    try {
      const board = await window.ptnotes.kanban.addComment(project, cardId, {
        comment,
        commentBy
      })
      set({ kanban: board })
    } catch {
      await get().refreshKanban()
    }
  },

  async updateKanbanComment(cardId, commentId, comment) {
    const project = get().activeProject
    if (!project) return
    try {
      const board = await window.ptnotes.kanban.updateComment(project, cardId, commentId, {
        comment
      })
      set({ kanban: board })
    } catch {
      await get().refreshKanban()
    }
  },

  async deleteKanbanComment(cardId, commentId) {
    const project = get().activeProject
    if (!project) return
    try {
      const board = await window.ptnotes.kanban.deleteComment(project, cardId, commentId)
      set({ kanban: board })
    } catch {
      await get().refreshKanban()
    }
  },

  async addKanbanColumn(input) {
    const project = get().activeProject
    if (!project) return
    try {
      const board = await window.ptnotes.kanban.addColumn(project, input)
      set({ kanban: board })
    } catch {
      await get().refreshKanban()
    }
  },

  async updateKanbanColumn(columnId, patch) {
    const project = get().activeProject
    if (!project) return
    try {
      const board = await window.ptnotes.kanban.updateColumn(project, columnId, patch)
      set({ kanban: board })
    } catch {
      await get().refreshKanban()
    }
  },

  async moveKanbanColumn(columnId, toIndex) {
    const project = get().activeProject
    if (!project) return
    const kanban = get().kanban
    if (kanban) {
      const from = kanban.columns.findIndex((c) => c.id === columnId)
      if (from !== -1) {
        const columns = [...kanban.columns]
        const [moved] = columns.splice(from, 1)
        columns.splice(Math.max(0, Math.min(toIndex, columns.length)), 0, moved!)
        set({ kanban: { ...kanban, columns } })
      }
    }
    try {
      const board = await window.ptnotes.kanban.moveColumn(project, columnId, toIndex)
      set({ kanban: board })
    } catch {
      await get().refreshKanban()
    }
  },

  async deleteKanbanColumn(columnId, options) {
    const project = get().activeProject
    if (!project) return
    const kanban = get().kanban
    if (kanban) {
      const next: KanbanBoard =
        options.mode === 'delete'
          ? {
              ...kanban,
              columns: kanban.columns.filter((c) => c.id !== columnId),
              cards: kanban.cards.filter((c) => c.columnId !== columnId)
            }
          : {
              ...kanban,
              columns: kanban.columns.filter((c) => c.id !== columnId),
              cards: kanban.cards.map((c) =>
                c.columnId === columnId
                  ? { ...c, columnId: options.targetColumnId ?? c.columnId }
                  : c
              )
            }
      set({ kanban: next })
    }
    try {
      const board = await window.ptnotes.kanban.deleteColumn(project, columnId, options)
      set({ kanban: board })
    } catch {
      await get().refreshKanban()
    }
  },

  setKanbanListView(kanbanListView) {
    set({ kanbanListView })
  },

  async archiveKanbanCard(cardId) {
    const project = get().activeProject
    if (!project) return
    try {
      const { board, archive } = await window.ptnotes.kanban.archiveCard(project, cardId)
      set({
        kanban: board,
        kanbanArchive: archive,
        activeKanbanCardId: null,
        kanbanEditingId: null
      })
    } catch {
      await get().refreshKanban()
    }
  },

  async restoreKanbanCard(cardId) {
    const project = get().activeProject
    if (!project) return
    try {
      const { board, archive } = await window.ptnotes.kanban.restoreCard(project, cardId)
      set({ kanban: board, kanbanArchive: archive, kanbanViewingId: null })
    } catch {
      await get().refreshKanban()
    }
  },

  async deleteArchivedKanbanCard(cardId) {
    const project = get().activeProject
    if (!project) return
    try {
      const archive = await window.ptnotes.kanban.deleteArchivedCard(project, cardId)
      set({ kanbanArchive: archive, kanbanViewingId: null })
    } catch {
      await get().refreshKanban()
    }
  },

  setActiveKanbanCard(id) {
    set({ activeKanbanCardId: id })
  },

  openKanbanEditor(id) {
    set({ kanbanEditingId: id, activeKanbanCardId: id })
  },

  closeKanbanEditor() {
    set({ kanbanEditingId: null })
  },

  openKanbanViewer(id) {
    set({ kanbanViewingId: id, kanbanEditingId: null, kanbanCreatingColumnId: null })
  },

  closeKanbanViewer() {
    set({ kanbanViewingId: null })
  },

  openKanbanCreate(columnId) {
    set({ kanbanCreatingColumnId: columnId, kanbanEditingId: null })
  },

  closeKanbanCreate() {
    set({ kanbanCreatingColumnId: null })
  },

  toggleKanbanColumn(columnId) {
    const project = get().activeProject
    if (!project) return
    const kanbanCollapsed = {
      ...get().kanbanCollapsed,
      [columnId]: !get().kanbanCollapsed[columnId]
    }
    localStorage.setItem(`ptnotes:kanban-collapsed:${project}`, JSON.stringify(kanbanCollapsed))
    set({ kanbanCollapsed })
  },

  async refreshFiles() {
    const project = get().activeProject
    if (!project) return set({ projectFiles: [], projectFileEntries: [] })
    const projectFileEntries = await window.ptnotes.files.listEntries(project)
    set({
      projectFileEntries,
      projectFiles: projectFileEntries.filter((e) => !e.isDir).map((e) => e.name)
    })
  },

  async refreshSchedules() {
    const project = get().activeProject
    if (!project) return set({ schedules: [] })
    const schedules = await window.ptnotes.planner.list(project)
    set({ schedules })
  },

  async loadCalendar() {
    const project = get().activeProject
    if (!project) return set({ calendar: null })
    const calendar = await window.ptnotes.planner.getCalendar(project)
    set({ calendar })
  },

  async selectSchedule(id) {
    const project = get().activeProject
    if (!project) return
    const schedule = await window.ptnotes.planner.read(project, id)
    if (!schedule) return
    set({ activeScheduleId: id, scheduleContent: schedule })
  },

  updateScheduleContent(schedule) {
    set({ scheduleContent: schedule })
  },

  async saveSchedule(schedule) {
    const project = get().activeProject
    if (!project) return
    const updated = { ...schedule, updatedAt: Date.now() }
    set({ scheduleContent: updated })
    await window.ptnotes.planner.save(project, updated)
    await get().refreshSchedules()
  },

  async createSchedule(name) {
    const project = get().activeProject
    if (!project) return
    const meta = await window.ptnotes.planner.create(project, name)
    await get().refreshSchedules()
    await get().selectSchedule(meta.id)
    set({ tab: 'planner' })
  },

  async renameSchedule(id, newName) {
    const project = get().activeProject
    if (!project) return
    const meta = await window.ptnotes.planner.rename(project, id, newName)
    const wasActive = get().activeScheduleId === id
    if (wasActive) {
      const content = get().scheduleContent
      if (content && content.id === id) {
        set({ scheduleContent: { ...content, id: meta.id, name: meta.name } })
      }
      set({ activeScheduleId: meta.id })
    }
    await get().refreshSchedules()
  },

  async deleteSchedule(id) {
    const project = get().activeProject
    if (!project) return
    await window.ptnotes.planner.delete(project, id)
    if (get().activeScheduleId === id) {
      set({ activeScheduleId: null, scheduleContent: null })
    }
    const plannerUndo = { ...get().plannerUndo }
    const plannerRedo = { ...get().plannerRedo }
    delete plannerUndo[id]
    delete plannerRedo[id]
    set({ plannerUndo, plannerRedo })
    await get().refreshSchedules()
  },

  async saveCalendar(calendar) {
    const project = get().activeProject
    if (!project) return
    await window.ptnotes.planner.saveCalendar(project, calendar)
    set({ calendar })
    const active = get().scheduleContent
    if (active) {
      const recomputed = {
        ...active,
        tasks: rollupScheduleTasks(active.tasks, calendar),
        updatedAt: Date.now()
      }
      set({ scheduleContent: recomputed })
      await window.ptnotes.planner.save(project, recomputed)
      await get().refreshSchedules()
    }
  },

  plannerPushUndo(scheduleId, snapshot) {
    const undo = get().plannerUndo[scheduleId] ?? []
    set({
      plannerUndo: { ...get().plannerUndo, [scheduleId]: [...undo, snapshot].slice(-100) }
    })
  },

  plannerClearRedo(scheduleId) {
    if (!get().plannerRedo[scheduleId]?.length) return
    const plannerRedo = { ...get().plannerRedo }
    delete plannerRedo[scheduleId]
    set({ plannerRedo })
  },

  plannerTruncateUndo(scheduleId, length) {
    const undo = get().plannerUndo[scheduleId] ?? []
    if (undo.length <= length) return
    set({
      plannerUndo: { ...get().plannerUndo, [scheduleId]: undo.slice(0, length) }
    })
  },

  plannerClearHistory(scheduleId) {
    const undo = get().plannerUndo
    const redo = get().plannerRedo
    if (!undo[scheduleId] && !redo[scheduleId]) return
    const plannerUndo = { ...undo }
    const plannerRedo = { ...redo }
    delete plannerUndo[scheduleId]
    delete plannerRedo[scheduleId]
    set({ plannerUndo, plannerRedo })
  },

  undoPlanner() {
    const state = get()
    if (!state.activeScheduleId || !state.scheduleContent) return null
    const id = state.activeScheduleId
    const undo = state.plannerUndo[id] ?? []
    if (undo.length === 0) return null
    const prev = undo[undo.length - 1]
    const redo = state.plannerRedo[id] ?? []
    set({
      plannerUndo: { ...state.plannerUndo, [id]: undo.slice(0, -1) },
      plannerRedo: { ...state.plannerRedo, [id]: [...redo, state.scheduleContent].slice(-100) },
      scheduleContent: prev
    })
    return prev
  },

  redoPlanner() {
    const state = get()
    if (!state.activeScheduleId || !state.scheduleContent) return null
    const id = state.activeScheduleId
    const redo = state.plannerRedo[id] ?? []
    if (redo.length === 0) return null
    const next = redo[redo.length - 1]
    const undo = state.plannerUndo[id] ?? []
    set({
      plannerRedo: { ...state.plannerRedo, [id]: redo.slice(0, -1) },
      plannerUndo: { ...state.plannerUndo, [id]: [...undo, state.scheduleContent].slice(-100) },
      scheduleContent: next
    })
    return next
  },

  async loadModules(project) {
    const runs = await window.ptnotes.modules.list(project)
    set((s) => {
      const live = new Set(runs.map((r) => r.runId))
      const toolCalls = Object.fromEntries(
        Object.entries(s.moduleToolCalls).filter(([runId]) => live.has(runId))
      )
      return {
        moduleRuns: { ...s.moduleRuns, [project]: runs },
        moduleToolCalls: toolCalls
      }
    })
  },

  applyModuleEvent(evt) {
    if (evt.type === 'tool' && evt.toolCall) {
      const tc = evt.toolCall
      set((s) => {
        const list = s.moduleToolCalls[evt.runId] ?? []
        const idx = list.findIndex((t) => t.id === tc.id)
        const settled = tc.ok !== undefined
        let next: ToolCallInfo[]
        if (settled && idx === -1) return {}
        if (idx === -1) next = [...list, tc]
        else if (settled) next = list.filter((t) => t.id !== tc.id)
        else next = list.map((t, i) => (i === idx ? tc : t))
        return { moduleToolCalls: { ...s.moduleToolCalls, [evt.runId]: next } }
      })
      return
    }
    if (['done', 'failed', 'cancelled'].includes(evt.run.status)) {
      set((s) => {
        if (!s.moduleToolCalls[evt.runId]) return {}
        const next = { ...s.moduleToolCalls }
        delete next[evt.runId]
        return { moduleToolCalls: next }
      })
    }
    set((s) => {
      const list = s.moduleRuns[evt.project] ?? []
      const idx = list.findIndex((r) => r.runId === evt.runId)
      let moduleRuns: Record<string, ModuleRun[]>
      if (idx === -1) {
        moduleRuns = { ...s.moduleRuns, [evt.project]: [evt.run, ...list] }
      } else {
        const next = [...list]
        next[idx] = evt.run
        moduleRuns = { ...s.moduleRuns, [evt.project]: next }
      }
      // Bot-task runs are surfaced in the dedicated Bot Tasks panel, not the Modules panel.
      let botTaskRuns = s.botTaskRuns
      if (evt.run.module.id === 'bot-task') {
        const tasks = s.botTaskRuns[evt.project] ?? []
        const tIdx = tasks.findIndex((r) => r.runId === evt.runId)
        botTaskRuns = {
          ...s.botTaskRuns,
          [evt.project]:
            tIdx === -1 ? [evt.run, ...tasks] : tasks.map((r, i) => (i === tIdx ? evt.run : r))
        }
      }
      return { moduleRuns, botTaskRuns }
    })
  },

  setModuleHistoryRunId(moduleHistoryRunId) {
    set({ moduleHistoryRunId })
  },

  // ---- Bots group chat ----

  async loadBotProfiles() {
    const botProfiles = await window.ptnotes.bots.listBots()
    set({ botProfiles })
  },

  async saveBotProfile(input) {
    const botProfiles = await window.ptnotes.bots.saveBot(input)
    set({ botProfiles })
  },

  async deleteBotProfile(id) {
    const ok = await window.ptnotes.bots.deleteBot(id)
    if (ok) {
      await get().loadBotProfiles()
      const project = get().activeProject
      if (project) await get().loadBotGroups(project)
    }
  },

  async loadBotGroups(project) {
    const groups = await window.ptnotes.bots.listGroups(project)
    const persisted = localStorage.getItem(`ptnotes:activeBotGroup:${project}`)
    set((s) => {
      const active = s.activeBotGroupId[project] ?? persisted
      const activeStillExists = active && groups.some((g) => g.groupId === active)
      return {
        botGroups: { ...s.botGroups, [project]: groups },
        activeBotGroupId: {
          ...s.activeBotGroupId,
          [project]: activeStillExists ? active : (groups[0]?.groupId ?? null)
        }
      }
    })
    const current = get().activeBotGroupId[project]
    if (current) await get().openBotGroup(project, current)
  },

  async openBotGroup(project, groupId) {
    localStorage.setItem(`ptnotes:activeBotGroup:${project}`, groupId)
    const data = await window.ptnotes.bots.readGroup(project, groupId, {
      limit: GROUP_CHAT_PAGE_SIZE
    })
    const total = data?.messageCount ?? 0
    set((s) => ({
      activeBotGroupId: { ...s.activeBotGroupId, [project]: groupId },
      botGroupMessages: {
        ...s.botGroupMessages,
        [groupId]: data?.messages ?? []
      },
      botGroupWindowMeta: {
        ...s.botGroupWindowMeta,
        [groupId]: {
          hasMore: data?.hasMore ?? false,
          oldestSeq: data?.oldestSeq ?? null,
          total
        }
      },
      botGroups: s.botGroups[project]
        ? {
            ...s.botGroups,
            [project]: s.botGroups[project].map((g) =>
              g.groupId === groupId && data
                ? {
                    ...g,
                    messageCount: total,
                    leaderBotId: data.leaderBotId,
                    botIds: data.botIds,
                    title: data.title
                  }
                : g
            )
          }
        : s.botGroups
    }))
  },

  async loadOlderBotGroupMessages(project, groupId) {
    const win = get().botGroupWindowMeta[groupId]
    if (!win || !win.hasMore || win.oldestSeq === null) return
    const data = await window.ptnotes.bots.readGroup(project, groupId, {
      limit: GROUP_CHAT_PAGE_SIZE,
      beforeSeq: win.oldestSeq
    })
    if (!data || data.messages.length === 0) {
      set((s) => ({
        botGroupWindowMeta: {
          ...s.botGroupWindowMeta,
          [groupId]: { ...win, hasMore: false }
        }
      }))
      return
    }
    set((s) => ({
      botGroupMessages: {
        ...s.botGroupMessages,
        [groupId]: [...data.messages, ...(s.botGroupMessages[groupId] ?? [])]
      },
      botGroupWindowMeta: {
        ...s.botGroupWindowMeta,
        [groupId]: {
          hasMore: data.hasMore ?? false,
          oldestSeq: data.oldestSeq ?? win.oldestSeq,
          total: win.total
        }
      }
    }))
  },

  async createBotGroup(project, input) {
    const group = await window.ptnotes.bots.createGroup(project, input)
    await get().loadBotGroups(project)
    await get().openBotGroup(project, group.groupId)
    return group
  },

  async updateBotGroup(project, groupId, patch) {
    await window.ptnotes.bots.updateGroup(project, groupId, patch)
    await get().loadBotGroups(project)
    await get().openBotGroup(project, groupId)
  },

  async deleteBotGroup(project, groupId) {
    await window.ptnotes.bots.deleteGroup(project, groupId)
    set((s) => {
      const messages = { ...s.botGroupMessages }
      delete messages[groupId]
      const windows = { ...s.botGroupWindowMeta }
      delete windows[groupId]
      const groups = (s.botGroups[project] ?? []).filter((g) => g.groupId !== groupId)
      return {
        botGroups: { ...s.botGroups, [project]: groups },
        activeBotGroupId: {
          ...s.activeBotGroupId,
          [project]:
            s.activeBotGroupId[project] === groupId
              ? (groups[0]?.groupId ?? null)
              : s.activeBotGroupId[project]
        },
        botGroupMessages: messages,
        botGroupWindowMeta: windows
      }
    })
    const current = get().activeBotGroupId[project]
    if (current) await get().openBotGroup(project, current)
  },

  async clearBotGroupHistory(project, groupId) {
    await window.ptnotes.bots.clearGroupMessages(project, groupId)
    set((s) => {
      const messages = { ...s.botGroupMessages }
      delete messages[groupId]
      const windows = { ...s.botGroupWindowMeta }
      delete windows[groupId]
      return { botGroupMessages: messages, botGroupWindowMeta: windows }
    })
    await get().loadBotGroups(project)
    if (get().activeBotGroupId[project] === groupId) await get().openBotGroup(project, groupId)
  },

  async sendBotGroupMessage(text) {
    const project = get().activeProject
    const groupId = project ? get().activeBotGroupId[project] : null
    if (!project || !groupId || !text.trim()) return
    set((s) => ({ botGroupBusy: { ...s.botGroupBusy, [groupId]: true } }))
    try {
      await window.ptnotes.bots.send(project, groupId, text.trim())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((s) => ({
        botGroupMessages: {
          ...s.botGroupMessages,
          [groupId]: [
            ...(s.botGroupMessages[groupId] ?? []),
            {
              id: crypto.randomUUID(),
              seq: Number.MAX_SAFE_INTEGER,
              senderKind: 'system',
              senderName: 'System',
              content: `⚠️ ${message}`,
              ts: Date.now(),
              error: true
            }
          ]
        }
      }))
    } finally {
      set((s) => ({
        botGroupBusy: { ...s.botGroupBusy, [groupId]: false },
        botTyping: { ...s.botTyping, [groupId]: null }
      }))
    }
  },

  async stopBotGroup() {
    const project = get().activeProject
    const groupId = project ? get().activeBotGroupId[project] : null
    if (!project || !groupId) return
    await window.ptnotes.bots.stop(project, groupId)
  },

  async respondBotGroupAsk(project, groupId, messageId, answers, cancelled) {
    await window.ptnotes.bots.askResponse(project, groupId, messageId, answers, cancelled)
  },

  applyBotGroupEvent(evt) {
    if (evt.type === 'message') {
      set((s) => {
        const list = s.botGroupMessages[evt.groupId] ?? []
        const idx = list.findIndex((m) => m.id === evt.message.id)
        const isNew = idx === -1
        const win = s.botGroupWindowMeta[evt.groupId]
        // An upsert for a message older than the loaded window (a replaced ask
        // bubble outside the page) must not re-appear at the bottom.
        if (isNew && win?.oldestSeq != null && evt.message.seq < win.oldestSeq) return {}
        const next = isNew
          ? [...list, evt.message]
          : list.map((m, i) => (i === idx ? evt.message : m))
        const typing =
          evt.message.senderKind === 'bot' ? { ...s.botTyping, [evt.groupId]: null } : s.botTyping
        const total = (win?.total ?? list.length) + (isNew ? 1 : 0)
        return {
          botGroupMessages: { ...s.botGroupMessages, [evt.groupId]: next },
          botGroupWindowMeta: win
            ? { ...s.botGroupWindowMeta, [evt.groupId]: { ...win, total } }
            : s.botGroupWindowMeta,
          botTyping: typing,
          botGroups: {
            ...s.botGroups,
            [evt.project]: (s.botGroups[evt.project] ?? []).map((g) =>
              g.groupId === evt.groupId ? { ...g, messageCount: total, updatedAt: Date.now() } : g
            )
          }
        }
      })
      return
    }
    if (evt.type === 'turn-start') {
      set((s) => ({ botTyping: { ...s.botTyping, [evt.groupId]: evt.botName } }))
      return
    }
    if (evt.type === 'turn-end') {
      set((s) => ({ botTyping: { ...s.botTyping, [evt.groupId]: null } }))
      return
    }
    if (evt.type === 'group-updated') {
      set((s) => ({
        botGroups: {
          ...s.botGroups,
          [evt.project]: (s.botGroups[evt.project] ?? []).map((g) =>
            g.groupId === evt.group.groupId ? evt.group : g
          )
        }
      }))
    }
  },

  async loadBotTasks(project) {
    const tasks = await window.ptnotes.bots.listTasks(project)
    set((s) => ({ botTaskRuns: { ...s.botTaskRuns, [project]: tasks } }))
  },

  openTraceViewer(traceViewer) {
    set({ traceViewer })
  },

  closeTraceViewer() {
    set({ traceViewer: null })
  },

  async selectNote(id) {
    const project = get().activeProject
    if (!project) return
    const content = await window.ptnotes.notes.read(project, id)
    set({ activeNoteId: id, noteContent: content })
  },

  async saveNote(content) {
    const { activeProject, activeNoteId } = get()
    if (!activeProject || !activeNoteId) return
    await window.ptnotes.notes.save(activeProject, activeNoteId, content)
  },

  async createNote(title) {
    const project = get().activeProject
    if (!project) return
    const note = await window.ptnotes.notes.create(project, title)
    await get().refreshNotes()
    await get().selectNote(note.id)
    set({ tab: 'notes' })
  },

  async renameNote(id, newTitle) {
    const project = get().activeProject
    if (!project) return
    const renamed = await window.ptnotes.notes.rename(project, id, newTitle)
    const { activeNoteId, noteContent } = get()
    const wasActive = activeNoteId === id
    await get().refreshNotes()
    if (wasActive) {
      set({ activeNoteId: renamed.id, noteContent })
    }
  },

  async deleteNote(id) {
    const project = get().activeProject
    if (!project) return
    await window.ptnotes.notes.delete(project, id)
    if (get().activeNoteId === id) {
      set({ activeNoteId: null, noteContent: '' })
    }
    await get().refreshNotes()
  },

  setTab(tab) {
    set({ tab })
    if (tab === 'files') void get().loadExplorer()
  },

  setChatOpen(chatOpen) {
    set({ chatOpen })
  },

  setRightView(view) {
    set((s) => {
      const openFor = view === 'chat' ? s.chatOpen : view === 'modules' ? s.moduleOpen : s.botsOpen
      const sameView = s.rightView === view
      if (sameView && openFor) {
        return { chatOpen: false, moduleOpen: false, botsOpen: false }
      }
      return {
        rightView: view,
        chatOpen: view === 'chat',
        moduleOpen: view === 'modules',
        botsOpen: view === 'bots' || view === 'botTasks'
      }
    })
  },

  appendChatMessage(project, msg) {
    set((state) => ({
      chatMessages: {
        ...state.chatMessages,
        [project]: [...(state.chatMessages[project] ?? []), msg]
      }
    }))
  },

  updateLastAssistantMessage(project, updater) {
    set((state) => {
      const list = state.chatMessages[project]
      if (!list || list.length === 0) return {}
      const last = list[list.length - 1]
      if (last.role !== 'assistant') return {}
      const next = [...list]
      next[next.length - 1] = updater(last)
      return { chatMessages: { ...state.chatMessages, [project]: next } }
    })
  },

  clearChatMessages(project) {
    set((state) => {
      if (!state.chatMessages[project]) return {}
      const next = { ...state.chatMessages }
      delete next[project]
      return { chatMessages: next }
    })
  },

  getActiveSessionId(project) {
    if (!project) return undefined
    return get().chatSessionIds[project]
  },

  async newChat(project) {
    const state = get()
    const thread = state.chatMessages[project] ?? []
    const sessionId = state.chatSessionIds[project]
    if (sessionId && thread.length > 0) {
      await window.ptnotes.chat.write(project, {
        sessionId,
        title: state.chatTitles[project] ?? undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: thread
      })
    }
    await window.ptnotes.ai.clear(project)
    const freshId = crypto.randomUUID()
    set((s) => ({
      chatMessages: { ...s.chatMessages, [project]: [] },
      chatSessionIds: { ...s.chatSessionIds, [project]: freshId },
      chatTitles: { ...s.chatTitles, [project]: '' }
    }))
    await get().loadChatSessions(project)
  },

  async openChat(project, sessionId) {
    const thread = await window.ptnotes.chat.read(project, sessionId)
    set((s) => ({
      chatMessages: { ...s.chatMessages, [project]: thread.messages },
      chatSessionIds: { ...s.chatSessionIds, [project]: sessionId },
      chatTitles: { ...s.chatTitles, [project]: thread.title ?? '' }
    }))
    await window.ptnotes.ai.clear(project)
  },

  async loadChatSessions(project) {
    const sessions = await window.ptnotes.chat.list(project)
    set((s) => ({ chatSessions: { ...s.chatSessions, [project]: sessions } }))
  },

  async deleteChat(project, sessionId) {
    await window.ptnotes.chat.delete(project, sessionId)
    const isActive = get().chatSessionIds[project] === sessionId
    if (isActive) {
      const freshId = crypto.randomUUID()
      set((s) => ({
        chatSessionIds: { ...s.chatSessionIds, [project]: freshId },
        chatMessages: { ...s.chatMessages, [project]: [] },
        chatTitles: { ...s.chatTitles, [project]: '' }
      }))
      await window.ptnotes.ai.clear(project)
    }
    await get().loadChatSessions(project)
  },

  setChatTitle(project, title) {
    set((s) => ({ chatTitles: { ...s.chatTitles, [project]: title } }))
  },

  async renameChat(project, sessionId, title) {
    await window.ptnotes.chat.rename(project, sessionId, title)
    await get().loadChatSessions(project)
  },

  setChatBusy(busy) {
    set({ chatBusy: busy })
  },

  setChatStreamProject(project) {
    set({ chatStreamProject: project })
  },

  setChatWaitRuns(runIds) {
    set({ chatWaitRuns: runIds })
  },

  setConfirmRequest(req) {
    set({ confirmRequest: req })
  },

  setAskRequest(req) {
    set({ askRequest: req })
  },

  setSettingsOpen(settingsOpen) {
    set({ settingsOpen })
  },

  setSettingsCategory(settingsCategory) {
    set({ settingsCategory })
  },

  openSettings(category) {
    set({ settingsOpen: true, settingsCategory: category ?? get().settingsCategory })
  },

  openSkillEditor(name) {
    set({ settingsOpen: true, settingsCategory: 'skills', skillEditRequest: name })
  },

  clearSkillEditRequest() {
    set({ skillEditRequest: null })
  },

  setSidebarVisible(sidebarVisible) {
    set({ sidebarVisible })
  },

  async loadExplorer(dir) {
    const project = get().activeProject
    if (!project) {
      return set({ explorerCwd: '', explorerTree: null, explorerEntries: [] })
    }
    const cwd = dir ?? get().explorerCwd
    const [explorerTree, explorerEntries] = await Promise.all([
      window.ptnotes.files.explorerTree(project),
      window.ptnotes.files.explorerList(project, cwd)
    ])
    set({ explorerCwd: cwd, explorerTree, explorerEntries })
  },

  selectExplorerFolder(path) {
    if (path === get().explorerCwd) return
    set({
      explorerSelected: [],
      explorerLastClicked: null,
      explorerCollapsed: [],
      explorerExpanded: [...new Set([...get().explorerExpanded, path])]
    })
    void get().loadExplorer(path)
  },

  toggleExplorerFolder(path) {
    const expanded = new Set(get().explorerExpanded)
    const collapsed = new Set(get().explorerCollapsed)
    const ancestors = new Set(ancestorsOf(get().explorerCwd))
    const isExpanded = expanded.has(path) || (ancestors.has(path) && !collapsed.has(path))
    if (isExpanded) {
      expanded.delete(path)
      collapsed.add(path)
    } else {
      expanded.add(path)
      collapsed.delete(path)
    }
    set({ explorerExpanded: [...expanded], explorerCollapsed: [...collapsed] })
  },

  selectExplorerEntry(path, mode) {
    const selected = new Set(get().explorerSelected)
    const lastClicked = get().explorerLastClicked
    if (mode === 'toggle') {
      if (selected.has(path)) selected.delete(path)
      else selected.add(path)
      set({ explorerSelected: [...selected], explorerLastClicked: path })
      return
    }
    if (mode === 'range' && lastClicked != null) {
      const entries = get().explorerEntries
      const lo = entries.findIndex((e) => e.path === lastClicked)
      const hi = entries.findIndex((e) => e.path === path)
      if (hi !== -1) {
        const from = lo === -1 ? hi : Math.min(lo, hi)
        const to = lo === -1 ? hi : Math.max(lo, hi)
        set({
          explorerSelected: entries.slice(from, to + 1).map((e) => e.path),
          explorerLastClicked: path
        })
        return
      }
    }
    set({ explorerSelected: [path], explorerLastClicked: path })
  },

  setExplorerSelected(explorerSelected) {
    set({ explorerSelected })
  },

  setFormatHelperEnabled(enabled) {
    localStorage.setItem('ptnotes:formatHelper', enabled ? '1' : '0')
    set({ formatHelperEnabled: enabled })
  },

  setTheme(theme) {
    localStorage.setItem('ptnotes:theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
    void (async () => {
      try {
        await window.ptnotes.settings.setTheme(theme)
      } catch {
        /* preload IPC unavailable in isolated renderer/HMR; safe to ignore */
      }
    })()
  },

  setFontSize(size) {
    localStorage.setItem('ptnotes:fontSize', size)
    document.documentElement.setAttribute('data-font-size', size)
    set({ fontSize: size })
    void (async () => {
      try {
        await window.ptnotes.settings.setAppearance({ fontSize: size })
      } catch {
        /* safe to ignore */
      }
    })()
  },

  setUiDensity(density) {
    localStorage.setItem('ptnotes:uiDensity', density)
    document.documentElement.setAttribute('data-ui-density', density)
    set({ uiDensity: density })
    void (async () => {
      try {
        await window.ptnotes.settings.setAppearance({ uiDensity: density })
      } catch {
        /* safe to ignore */
      }
    })()
  },

  setEditorFontFamily(family) {
    localStorage.setItem('ptnotes:editorFont', family)
    document.documentElement.setAttribute('data-editor-font', family)
    set({ editorFontFamily: family })
    void (async () => {
      try {
        await window.ptnotes.settings.setAppearance({ editorFontFamily: family })
      } catch {
        /* safe to ignore */
      }
    })()
  },

  setCommandPaletteOpen(commandPaletteOpen) {
    if (commandPaletteOpen) {
      set({ commandPaletteOpen: true, commandPaletteQuery: '', commandPaletteActiveIndex: 0 })
    } else {
      set({ commandPaletteOpen: false })
    }
  },

  toggleCommandPalette() {
    set((s) =>
      s.commandPaletteOpen
        ? { commandPaletteOpen: false }
        : {
            commandPaletteOpen: true,
            commandPaletteQuery: '',
            commandPaletteActiveIndex: 0
          }
    )
  },

  setCommandPaletteQuery(commandPaletteQuery) {
    set({ commandPaletteQuery, commandPaletteActiveIndex: 0 })
  },

  setCommandPaletteActiveIndex(commandPaletteActiveIndex) {
    set({ commandPaletteActiveIndex })
  }
}))
