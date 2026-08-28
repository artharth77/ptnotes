import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AboutInfo,
  AIConfig,
  AIProviderConfig,
  AiTraceFile,
  AskResponse,
  ChatMessage,
  ChatSessionMeta,
  ChatStreamEvent,
  ChatThread,
  ConfirmResponse,
  CreateProjectResult,
  ModuleChatMessage,
  ModuleEvent,
  ModuleRun,
  ModuleSettings,
  ModuleStartResult,
  StorageSettings,
  ToolsetSettings,
  NoteMeta,
  PdfExtractResult,
  Project,
  ProjectCalendar,
  Schedule,
  ScheduleMeta,
  SkillContent,
  SkillList,
  SkillMeta,
  SkillScope,
  KanbanArchive,
  KanbanArchiveMove,
  KanbanBoard
} from '../shared/types'

const api = {
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
    create: (name: string): Promise<CreateProjectResult> =>
      ipcRenderer.invoke('projects:create', name),
    recreate: (name: string): Promise<CreateProjectResult> =>
      ipcRenderer.invoke('projects:recreate', name),
    rename: (oldName: string, newName: string): Promise<Project> =>
      ipcRenderer.invoke('projects:rename', oldName, newName),
    delete: (name: string): Promise<void> => ipcRenderer.invoke('projects:delete', name)
  },
  notes: {
    list: (project: string): Promise<NoteMeta[]> => ipcRenderer.invoke('notes:list', project),
    read: (project: string, id: string): Promise<string> =>
      ipcRenderer.invoke('notes:read', project, id),
    save: (project: string, id: string, content: string): Promise<void> =>
      ipcRenderer.invoke('notes:save', project, id, content),
    create: (project: string, title: string): Promise<NoteMeta> =>
      ipcRenderer.invoke('notes:create', project, title),
    rename: (project: string, id: string, newTitle: string): Promise<NoteMeta> =>
      ipcRenderer.invoke('notes:rename', project, id, newTitle),
    delete: (project: string, id: string): Promise<void> =>
      ipcRenderer.invoke('notes:delete', project, id),
    reveal: (project: string, id: string): Promise<void> =>
      ipcRenderer.invoke('notes:reveal', project, id)
  },
  kanban: {
    load: (project: string): Promise<KanbanBoard> => ipcRenderer.invoke('kanban:load', project),
    save: (project: string, board: KanbanBoard): Promise<KanbanBoard> =>
      ipcRenderer.invoke('kanban:save', project, board),
    loadArchive: (project: string): Promise<KanbanArchive> =>
      ipcRenderer.invoke('kanban:loadArchive', project),
    archiveCard: (project: string, cardId: string): Promise<KanbanArchiveMove> =>
      ipcRenderer.invoke('kanban:archiveCard', project, cardId),
    restoreCard: (project: string, cardId: string): Promise<KanbanArchiveMove> =>
      ipcRenderer.invoke('kanban:restoreCard', project, cardId),
    deleteArchivedCard: (project: string, cardId: string): Promise<KanbanArchive> =>
      ipcRenderer.invoke('kanban:deleteArchivedCard', project, cardId)
  },
  chat: {
    list: (project: string): Promise<ChatSessionMeta[]> => ipcRenderer.invoke('chat:list', project),
    read: (project: string, sessionId: string): Promise<ChatThread> =>
      ipcRenderer.invoke('chat:read', project, sessionId),
    write: (project: string, thread: ChatThread): Promise<void> =>
      ipcRenderer.invoke('chat:write', project, thread),
    delete: (project: string, sessionId: string): Promise<void> =>
      ipcRenderer.invoke('chat:delete', project, sessionId),
    rename: (project: string, sessionId: string, title: string): Promise<void> =>
      ipcRenderer.invoke('chat:rename', project, sessionId, title),
    readTrace: (project: string, sessionId: string): Promise<AiTraceFile | null> =>
      ipcRenderer.invoke('chat:readTrace', project, sessionId)
  },
  planner: {
    list: (project: string): Promise<ScheduleMeta[]> => ipcRenderer.invoke('planner:list', project),
    read: (project: string, id: string): Promise<Schedule | null> =>
      ipcRenderer.invoke('planner:read', project, id),
    save: (project: string, schedule: Schedule): Promise<void> =>
      ipcRenderer.invoke('planner:save', project, schedule),
    create: (project: string, name: string): Promise<ScheduleMeta> =>
      ipcRenderer.invoke('planner:create', project, name),
    rename: (project: string, id: string, newName: string): Promise<ScheduleMeta> =>
      ipcRenderer.invoke('planner:rename', project, id, newName),
    delete: (project: string, id: string): Promise<void> =>
      ipcRenderer.invoke('planner:delete', project, id),
    reveal: (project: string, id: string): Promise<void> =>
      ipcRenderer.invoke('planner:reveal', project, id),
    getCalendar: (project: string): Promise<ProjectCalendar> =>
      ipcRenderer.invoke('planner:getCalendar', project),
    saveCalendar: (project: string, calendar: ProjectCalendar): Promise<void> =>
      ipcRenderer.invoke('planner:saveCalendar', project, calendar),
    setEditActive: (active: boolean): void => {
      ipcRenderer.send('planner:set-edit-active', active)
    },
    onUndoRedo: (callback: (data: { redo: boolean }) => void): (() => void) => {
      const listener = (_e: unknown, data: { redo: boolean }): void => callback(data)
      ipcRenderer.on('planner:undo-redo', listener)
      return () => {
        ipcRenderer.removeListener('planner:undo-redo', listener)
      }
    }
  },
  ai: {
    send: (
      project: string,
      sessionId: string,
      text: string,
      history?: ChatMessage[],
      activeNoteId?: string | null,
      activeScheduleId?: string | null,
      activeKanbanCardId?: string | null
    ): Promise<void> =>
      ipcRenderer.invoke(
        'ai:send',
        project,
        sessionId,
        text,
        history,
        activeNoteId,
        activeScheduleId,
        activeKanbanCardId
      ),
    stop: (project: string): Promise<void> => ipcRenderer.invoke('ai:stop', project),
    confirmResponse: (resp: ConfirmResponse): Promise<void> =>
      ipcRenderer.invoke('ai:confirmResponse', resp),
    askResponse: (resp: AskResponse): Promise<void> => ipcRenderer.invoke('ai:askResponse', resp),
    clear: (project: string): Promise<void> => ipcRenderer.invoke('ai:clear', project),
    generateTitle: (project: string, sessionId: string, firstMessage: string): Promise<string> =>
      ipcRenderer.invoke('ai:generateTitle', project, sessionId, firstMessage),
    getConfig: (): Promise<AIProviderConfig> => ipcRenderer.invoke('ai:getConfig'),
    getProfiles: (): Promise<AIConfig> => ipcRenderer.invoke('ai:getProfiles'),
    saveProfiles: (config: AIConfig): Promise<AIConfig> =>
      ipcRenderer.invoke('ai:saveProfiles', config),
    listModels: (baseUrl: string, apiKey: string): Promise<string[] | { error: string }> =>
      ipcRenderer.invoke('ai:listModels', baseUrl, apiKey),
    onStreamEvent: (callback: (event: ChatStreamEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: ChatStreamEvent): void => callback(event)
      ipcRenderer.on('ai:stream', listener)
      return () => {
        ipcRenderer.removeListener('ai:stream', listener)
      }
    }
  },
  settings: {
    get: (): Promise<StorageSettings> => ipcRenderer.invoke('settings:get'),
    getAbout: (): Promise<AboutInfo> => ipcRenderer.invoke('settings:getAbout'),
    chooseRoot: (): Promise<string | null> => ipcRenderer.invoke('settings:chooseRoot'),
    changeRoot: (newRoot: string): Promise<StorageSettings> =>
      ipcRenderer.invoke('settings:changeRoot', newRoot)
  },
  skills: {
    list: (project: string): Promise<SkillList> => ipcRenderer.invoke('skills:list', project),
    read: (project: string, scope: SkillScope, name: string): Promise<SkillContent | null> =>
      ipcRenderer.invoke('skills:read', project, scope, name),
    save: (
      project: string,
      scope: SkillScope,
      name: string,
      input: { description: string; content: string; enabled?: boolean }
    ): Promise<SkillMeta> => ipcRenderer.invoke('skills:save', project, scope, name, input),
    setEnabled: (
      project: string,
      scope: SkillScope,
      name: string,
      enabled: boolean
    ): Promise<SkillMeta> => ipcRenderer.invoke('skills:setEnabled', project, scope, name, enabled),
    setBuiltinEnabled: (name: string, enabled: boolean): Promise<SkillMeta> =>
      ipcRenderer.invoke('skills:setBuiltinEnabled', name, enabled),
    move: (
      project: string,
      scope: SkillScope,
      name: string,
      toScope: SkillScope
    ): Promise<SkillMeta> => ipcRenderer.invoke('skills:move', project, scope, name, toScope),
    delete: (project: string, scope: SkillScope, name: string): Promise<boolean> =>
      ipcRenderer.invoke('skills:delete', project, scope, name)
  },
  pdf: {
    supportsUpload: (): Promise<boolean> => ipcRenderer.invoke('pdf:supportsUpload'),
    upload: (project: string, sessionId: string, path: string, prompt: string): Promise<void> =>
      ipcRenderer.invoke('pdf:upload', project, sessionId, path, prompt)
  },
  files: {
    list: (project: string): Promise<string[]> => ipcRenderer.invoke('files:list', project),
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    copyToProject: (project: string, sourcePath: string, fileName?: string): Promise<string> =>
      ipcRenderer.invoke('files:copyToProject', project, sourcePath, fileName),
    extract: (path: string): Promise<PdfExtractResult> => ipcRenderer.invoke('files:extract', path),
    reveal: (path: string): Promise<void> => ipcRenderer.invoke('files:reveal', path),
    revealByName: (project: string, fileName: string): Promise<void> =>
      ipcRenderer.invoke('files:revealByName', project, fileName)
  },
  modules: {
    list: (project: string): Promise<ModuleRun[]> => ipcRenderer.invoke('modules:list', project),
    listAvailable: (): Promise<ModuleSettings[]> => ipcRenderer.invoke('modules:listAvailable'),
    setEnabled: (id: string, enabled: boolean): Promise<ModuleSettings[]> =>
      ipcRenderer.invoke('modules:setEnabled', id, enabled),
    stop: (project: string, runId: string): Promise<void> =>
      ipcRenderer.invoke('modules:stop', project, runId),
    retry: (project: string, runId: string): Promise<ModuleStartResult> =>
      ipcRenderer.invoke('modules:retry', project, runId),
    reveal: (
      project: string,
      runId: string,
      filePath?: string
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('modules:reveal', project, runId, filePath),
    clearHistory: (project: string, deleteOutputFiles?: boolean): Promise<number> =>
      ipcRenderer.invoke('modules:clearHistory', project, deleteOutputFiles),
    deleteRun: (project: string, runId: string, deleteOutputFiles?: boolean): Promise<boolean> =>
      ipcRenderer.invoke('modules:deleteRun', project, runId, deleteOutputFiles),
    readChat: (project: string, runId: string): Promise<ModuleChatMessage[]> =>
      ipcRenderer.invoke('modules:readChat', project, runId),
    readTrace: (project: string, runId: string): Promise<AiTraceFile | null> =>
      ipcRenderer.invoke('modules:readTrace', project, runId),
    onEvent: (callback: (event: ModuleEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: ModuleEvent): void => callback(event)
      ipcRenderer.on('modules:event', listener)
      return () => {
        ipcRenderer.removeListener('modules:event', listener)
      }
    }
  },
  toolsets: {
    listAvailable: (): Promise<ToolsetSettings[]> => ipcRenderer.invoke('toolsets:listAvailable'),
    setEnabled: (id: string, enabled: boolean): Promise<ToolsetSettings[]> =>
      ipcRenderer.invoke('toolsets:setEnabled', id, enabled),
    setConfig: (id: string, key: string, value: unknown): Promise<ToolsetSettings[]> =>
      ipcRenderer.invoke('toolsets:setConfig', id, key, value)
  }
}

export type PTNotesApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('ptnotes', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.ptnotes = api
}
