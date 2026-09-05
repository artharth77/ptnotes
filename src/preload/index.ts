import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AboutInfo,
  AIConfig,
  AIProviderConfig,
  AiTraceFile,
  AppearanceSettings,
  AskAnswer,
  AskResponse,
  BotGroupEvent,
  BotMemoryEntry,
  BotProfile,
  BotUpsertInput,
  ChatMessage,
  ChatSessionMeta,
  ChatStreamEvent,
  ChatThread,
  ConfirmResponse,
  CreateProjectResult,
  ExplorerEntry,
  ExplorerFolderNode,
  FileEntry,
  GroupChatData,
  GroupChatMeta,
  GroupMessagePageOpts,
  GroupPatch,
  ModuleChatMessage,
  ModuleEvent,
  ModuleRun,
  ModuleSettings,
  ModuleStartResult,
  NewGroupInput,
  StorageSettings,
  ToolsetSettings,
  NoteMeta,
  NoteSearchMatch,
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
  KanbanBoard,
  KanbanCardPatch,
  KanbanColumnPatch,
  KanbanCommentInput,
  NewKanbanCardInput,
  NewKanbanColumnInput
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
      ipcRenderer.invoke('notes:reveal', project, id),
    setStarred: (project: string, id: string, starred: boolean): Promise<NoteMeta[]> =>
      ipcRenderer.invoke('notes:setStarred', project, id, starred),
    search: (project: string, query: string): Promise<NoteSearchMatch[]> =>
      ipcRenderer.invoke('notes:search', project, query)
  },
  kanban: {
    load: (project: string): Promise<KanbanBoard> => ipcRenderer.invoke('kanban:load', project),
    createCard: (project: string, input: NewKanbanCardInput): Promise<KanbanBoard> =>
      ipcRenderer.invoke('kanban:createCard', project, input),
    updateCard: (project: string, cardId: string, patch: KanbanCardPatch): Promise<KanbanBoard> =>
      ipcRenderer.invoke('kanban:updateCard', project, cardId, patch),
    moveCard: (
      project: string,
      cardId: string,
      columnId: string,
      index?: number
    ): Promise<KanbanBoard> =>
      ipcRenderer.invoke('kanban:moveCard', project, cardId, columnId, index),
    deleteCard: (project: string, cardId: string): Promise<KanbanBoard> =>
      ipcRenderer.invoke('kanban:deleteCard', project, cardId),
    addComment: (
      project: string,
      cardId: string,
      input: KanbanCommentInput
    ): Promise<KanbanBoard> => ipcRenderer.invoke('kanban:addComment', project, cardId, input),
    updateComment: (
      project: string,
      cardId: string,
      commentId: string,
      input: KanbanCommentInput
    ): Promise<KanbanBoard> =>
      ipcRenderer.invoke('kanban:updateComment', project, cardId, commentId, input),
    deleteComment: (project: string, cardId: string, commentId: string): Promise<KanbanBoard> =>
      ipcRenderer.invoke('kanban:deleteComment', project, cardId, commentId),
    addColumn: (project: string, input: NewKanbanColumnInput): Promise<KanbanBoard> =>
      ipcRenderer.invoke('kanban:addColumn', project, input),
    updateColumn: (
      project: string,
      columnId: string,
      patch: KanbanColumnPatch
    ): Promise<KanbanBoard> => ipcRenderer.invoke('kanban:updateColumn', project, columnId, patch),
    moveColumn: (project: string, columnId: string, toIndex: number): Promise<KanbanBoard> =>
      ipcRenderer.invoke('kanban:moveColumn', project, columnId, toIndex),
    deleteColumn: (
      project: string,
      columnId: string,
      options: { mode: 'move' | 'delete'; targetColumnId?: string }
    ): Promise<KanbanBoard> =>
      ipcRenderer.invoke('kanban:deleteColumn', project, columnId, options),
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
    duplicate: (project: string, id: string): Promise<ScheduleMeta> =>
      ipcRenderer.invoke('planner:duplicate', project, id),
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
    getTheme: (): Promise<'light' | 'dark' | 'system'> => ipcRenderer.invoke('settings:getTheme'),
    setTheme: (theme: 'light' | 'dark' | 'system'): Promise<'light' | 'dark' | 'system'> =>
      ipcRenderer.invoke('settings:setTheme', theme),
    getAppearance: (): Promise<AppearanceSettings> => ipcRenderer.invoke('settings:getAppearance'),
    setAppearance: (patch: Partial<AppearanceSettings>): Promise<AppearanceSettings> =>
      ipcRenderer.invoke('settings:setAppearance', patch),
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
    listEntries: (project: string, subpath?: string): Promise<FileEntry[]> =>
      ipcRenderer.invoke('files:listEntries', project, subpath),
    absPath: (project: string, fileName: string): Promise<string | null> =>
      ipcRenderer.invoke('files:absPath', project, fileName),
    readText: (project: string, fileName: string): Promise<string> =>
      ipcRenderer.invoke('files:readText', project, fileName),
    explorerList: (project: string, subpath?: string): Promise<ExplorerEntry[]> =>
      ipcRenderer.invoke('files:explorerList', project, subpath),
    explorerTree: (project: string): Promise<ExplorerFolderNode> =>
      ipcRenderer.invoke('files:explorerTree', project),
    explorerCreateFolder: (project: string, parentSubpath: string, name: string): Promise<string> =>
      ipcRenderer.invoke('files:explorerCreateFolder', project, parentSubpath, name),
    explorerCopy: (project: string, fromPaths: string[], destSubpath: string): Promise<number> =>
      ipcRenderer.invoke('files:explorerCopy', project, fromPaths, destSubpath),
    explorerMove: (project: string, fromPaths: string[], destSubpath: string): Promise<number> =>
      ipcRenderer.invoke('files:explorerMove', project, fromPaths, destSubpath),
    explorerRename: (project: string, itemPath: string, newName: string): Promise<string> =>
      ipcRenderer.invoke('files:explorerRename', project, itemPath, newName),
    explorerDelete: (project: string, itemPaths: string[]): Promise<number> =>
      ipcRenderer.invoke('files:explorerDelete', project, itemPaths),
    importDropped: (
      project: string,
      sourcePath: string,
      destSubpath: string,
      fileName?: string
    ): Promise<string> =>
      ipcRenderer.invoke('files:importDropped', project, sourcePath, destSubpath, fileName),
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
  },
  bots: {
    listBots: (): Promise<BotProfile[]> => ipcRenderer.invoke('bots:listBots'),
    saveBot: (input: BotUpsertInput): Promise<BotProfile[]> =>
      ipcRenderer.invoke('bots:saveBot', input),
    deleteBot: (id: string): Promise<boolean> => ipcRenderer.invoke('bots:deleteBot', id),
    getUserName: (): Promise<string> => ipcRenderer.invoke('bots:getUserName'),
    setUserName: (name: string): Promise<string> => ipcRenderer.invoke('bots:setUserName', name),
    listMemories: (project: string, botId?: string): Promise<BotMemoryEntry[]> =>
      ipcRenderer.invoke('bots:listMemories', project, botId),
    deleteMemory: (project: string, botId: string, memoryId: string): Promise<boolean> =>
      ipcRenderer.invoke('bots:deleteMemory', project, botId, memoryId),
    listGroups: (project: string): Promise<GroupChatMeta[]> =>
      ipcRenderer.invoke('bots:listGroups', project),
    readGroup: (
      project: string,
      groupId: string,
      opts?: GroupMessagePageOpts
    ): Promise<GroupChatData | null> =>
      ipcRenderer.invoke('bots:readGroup', project, groupId, opts),
    createGroup: (project: string, input: NewGroupInput): Promise<GroupChatMeta> =>
      ipcRenderer.invoke('bots:createGroup', project, input),
    updateGroup: (project: string, groupId: string, patch: GroupPatch): Promise<GroupChatMeta> =>
      ipcRenderer.invoke('bots:updateGroup', project, groupId, patch),
    deleteGroup: (project: string, groupId: string): Promise<boolean> =>
      ipcRenderer.invoke('bots:deleteGroup', project, groupId),
    clearGroupMessages: (project: string, groupId: string): Promise<void> =>
      ipcRenderer.invoke('bots:clearGroupMessages', project, groupId),
    send: (project: string, groupId: string, text: string): Promise<void> =>
      ipcRenderer.invoke('bots:send', project, groupId, text),
    stop: (project: string, groupId: string): Promise<void> =>
      ipcRenderer.invoke('bots:stop', project, groupId),
    askResponse: (
      project: string,
      groupId: string,
      messageId: string,
      answers: AskAnswer[],
      cancelled: boolean
    ): Promise<boolean> =>
      ipcRenderer.invoke('bots:askResponse', project, groupId, messageId, answers, cancelled),
    listTasks: (project: string): Promise<ModuleRun[]> =>
      ipcRenderer.invoke('bots:listTasks', project),
    clearTaskHistory: (project: string, deleteOutputFiles?: boolean): Promise<number> =>
      ipcRenderer.invoke('bots:clearTaskHistory', project, deleteOutputFiles),
    readTrace: (project: string, groupId: string): Promise<AiTraceFile | null> =>
      ipcRenderer.invoke('bots:readTrace', project, groupId),
    onEvent: (callback: (event: BotGroupEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: BotGroupEvent): void => callback(event)
      ipcRenderer.on('bots:event', listener)
      return () => {
        ipcRenderer.removeListener('bots:event', listener)
      }
    }
  },
  onOpenFind: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('global:open-find', listener)
    return () => {
      ipcRenderer.removeListener('global:open-find', listener)
    }
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
