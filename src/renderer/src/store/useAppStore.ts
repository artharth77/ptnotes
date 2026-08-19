import { create } from 'zustand'
import { rollupScheduleTasks } from '@shared/planner'
import type {
  AskRequest,
  ChatMessage,
  ChatSessionMeta,
  ConfirmRequest,
  ModuleEvent,
  ModuleRun,
  NoteMeta,
  Project,
  ProjectCalendar,
  Schedule,
  ScheduleMeta,
  Tab,
  Todo
} from '@shared/types'

interface AppState {
  projects: Project[]
  activeProject: string | null
  notes: NoteMeta[]
  activeNoteId: string | null
  noteContent: string
  todos: Todo[]
  projectFiles: string[]
  schedules: ScheduleMeta[]
  activeScheduleId: string | null
  scheduleContent: Schedule | null
  calendar: ProjectCalendar | null
  plannerUndo: Record<string, Schedule[]>
  plannerRedo: Record<string, Schedule[]>
  tab: Tab
  chatOpen: boolean
  chatMessages: Record<string, ChatMessage[]>
  chatSessionIds: Record<string, string>
  chatSessions: Record<string, ChatSessionMeta[]>
  chatTitles: Record<string, string>
  moduleRuns: Record<string, ModuleRun[]>
  moduleHistoryRunId: string | null
  traceViewer: { kind: 'chat' | 'module'; key: string; title: string } | null
  chatBusy: boolean
  chatStreamProject: string | null
  chatWaitRuns: string[]
  confirmRequest: ConfirmRequest | null
  askRequest: AskRequest | null
  settingsOpen: boolean
  settingsCategory: 'storage' | 'ai' | 'modules' | 'about' | 'skills'
  skillEditRequest: string | null
  sidebarVisible: boolean
  formatHelperEnabled: boolean
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
  refreshTodos: () => Promise<void>
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
  undoPlanner: () => Schedule | null
  redoPlanner: () => Schedule | null
  loadModules: (project: string) => Promise<void>
  applyModuleEvent: (evt: ModuleEvent) => void
  setModuleHistoryRunId: (runId: string | null) => void
  openTraceViewer: (v: { kind: 'chat' | 'module'; key: string; title: string }) => void
  closeTraceViewer: () => void
  selectNote: (id: string) => Promise<void>
  saveNote: (content: string) => Promise<void>
  createNote: (title: string) => Promise<void>
  renameNote: (id: string, newTitle: string) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  setTab: (tab: Tab) => void
  setChatOpen: (open: boolean) => void
  appendChatMessage: (project: string, msg: ChatMessage) => void
  updateLastAssistantMessage: (project: string, updater: (msg: ChatMessage) => ChatMessage) => void
  clearChatMessages: (project: string) => void
  setChatBusy: (busy: boolean) => void
  setChatStreamProject: (project: string | null) => void
  setChatWaitRuns: (runIds: string[]) => void
  setConfirmRequest: (req: ConfirmRequest | null) => void
  setAskRequest: (req: AskRequest | null) => void
  setSettingsOpen: (open: boolean) => void
  setSettingsCategory: (category: 'storage' | 'ai' | 'modules' | 'about' | 'skills') => void
  openSettings: (category?: 'storage' | 'ai' | 'modules' | 'about' | 'skills') => void
  openSkillEditor: (name: string) => void
  clearSkillEditRequest: () => void
  setSidebarVisible: (visible: boolean) => void
  setFormatHelperEnabled: (enabled: boolean) => void
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
  todos: [],
  projectFiles: [],
  schedules: [],
  activeScheduleId: null,
  scheduleContent: null,
  calendar: null,
  plannerUndo: {},
  plannerRedo: {},
  tab: 'notes',
  chatOpen: false,
  chatMessages: {},
  chatSessionIds: {},
  chatSessions: {},
  chatTitles: {},
  moduleRuns: {},
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
  formatHelperEnabled: localStorage.getItem('ptnotes:formatHelper') !== '0',
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
        set({ activeProject: null, notes: [], todos: [], activeNoteId: null, noteContent: '' })
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
      loading: true,
      moduleHistoryRunId: null
    })
    await Promise.all([
      get().refreshNotes(),
      get().refreshTodos(),
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
  },

  async refreshNotes() {
    const project = get().activeProject
    if (!project) return set({ notes: [] })
    const notes = await window.ptnotes.notes.list(project)
    set({ notes })
  },

  async refreshTodos() {
    const project = get().activeProject
    if (!project) return set({ todos: [] })
    const todos = await window.ptnotes.todos.list(project)
    set({ todos })
  },

  async refreshFiles() {
    const project = get().activeProject
    if (!project) return set({ projectFiles: [] })
    const projectFiles = await window.ptnotes.files.list(project)
    set({ projectFiles })
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
    await window.ptnotes.planner.rename(project, id, newName)
    await get().refreshSchedules()
    if (get().activeScheduleId === id) {
      await get().selectSchedule(id)
    }
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
    set((s) => ({ moduleRuns: { ...s.moduleRuns, [project]: runs } }))
  },

  applyModuleEvent(evt) {
    set((s) => {
      const list = s.moduleRuns[evt.project] ?? []
      const idx = list.findIndex((r) => r.runId === evt.runId)
      if (idx === -1) {
        return { moduleRuns: { ...s.moduleRuns, [evt.project]: [evt.run, ...list] } }
      }
      const next = [...list]
      next[idx] = evt.run
      return { moduleRuns: { ...s.moduleRuns, [evt.project]: next } }
    })
  },

  setModuleHistoryRunId(moduleHistoryRunId) {
    set({ moduleHistoryRunId })
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
    await get().refreshNotes()
    if (get().activeNoteId === id) {
      set({ activeNoteId: renamed.id, noteContent: get().noteContent })
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
  },

  setChatOpen(chatOpen) {
    set({ chatOpen })
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

  setFormatHelperEnabled(enabled) {
    localStorage.setItem('ptnotes:formatHelper', enabled ? '1' : '0')
    set({ formatHelperEnabled: enabled })
  }
}))
