import { create } from 'zustand'
import type {
  ChatMessage,
  ChatSessionMeta,
  ConfirmRequest,
  ModuleEvent,
  ModuleRun,
  NoteMeta,
  Project,
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
  tab: Tab
  chatOpen: boolean
  chatMessages: Record<string, ChatMessage[]>
  chatSessionIds: Record<string, string>
  chatSessions: Record<string, ChatSessionMeta[]>
  chatTitles: Record<string, string>
  moduleRuns: Record<string, ModuleRun[]>
  moduleHistoryRunId: string | null
  chatBusy: boolean
  chatStreamProject: string | null
  confirmRequest: ConfirmRequest | null
  settingsOpen: boolean
  settingsCategory: 'storage' | 'ai' | 'modules'
  sidebarVisible: boolean
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
  loadModules: (project: string) => Promise<void>
  applyModuleEvent: (evt: ModuleEvent) => void
  setModuleHistoryRunId: (runId: string | null) => void
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
  setConfirmRequest: (req: ConfirmRequest | null) => void
  setSettingsOpen: (open: boolean) => void
  setSettingsCategory: (category: 'storage' | 'ai' | 'modules') => void
  openSettings: (category?: 'storage' | 'ai' | 'modules') => void
  setSidebarVisible: (visible: boolean) => void
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
  tab: 'notes',
  chatOpen: false,
  chatMessages: {},
  chatSessionIds: {},
  chatSessions: {},
  chatTitles: {},
  moduleRuns: {},
  moduleHistoryRunId: null,
  chatBusy: false,
  chatStreamProject: null,
  confirmRequest: null,
  settingsOpen: false,
  settingsCategory: 'storage',
  sidebarVisible: true,
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
      loading: true,
      moduleHistoryRunId: null
    })
    await Promise.all([
      get().refreshNotes(),
      get().refreshTodos(),
      get().refreshFiles(),
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

  setConfirmRequest(req) {
    set({ confirmRequest: req })
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

  setSidebarVisible(sidebarVisible) {
    set({ sidebarVisible })
  }
}))
