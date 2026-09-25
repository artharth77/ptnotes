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
  DiagramSaveResult,
  ExplorerEntry,
  ExplorerFolderNode,
  FileEntry,
  GalleryImage,
  GroupChatData,
  GroupChatMeta,
  GroupMessagePageOpts,
  GroupPatch,
  InfographicRenderResult,
  KanbanArchive,
  KanbanArchiveMove,
  KanbanBoard,
  KanbanCardPatch,
  KanbanColumnPatch,
  KanbanCommentInput,
  McpServerConfig,
  McpServerSettings,
  McpServerStatus,
  McpTestResult,
  MermaidRenderResult,
  ModuleChatMessage,
  ModuleEvent,
  ModuleRun,
  ModuleSettings,
  ModuleStartResult,
  NewGroupInput,
  NewKanbanCardInput,
  NewKanbanColumnInput,
  NoteMeta,
  NoteSearchMatch,
  PdfExtractResult,
  PdfInfo,
  PdfPageEdit,
  PdfPageThumbnail,
  PlannerExportPayload,
  PlannerExportResult,
  Project,
  ProjectCalendar,
  Schedule,
  ScheduleJob,
  ScheduleJobInput,
  ScheduleJobRun,
  ScheduleMeta,
  SkillContent,
  SkillList,
  SkillMeta,
  SkillScope,
  SnapshotMeta,
  StorageSettings,
  ToolsetSettings
} from './types'
import type { DashboardSnapshot } from './dashboard'
import type { ScheduleJobEvent } from './scheduleJobs'

/** Which runtime the API is served by: the Electron preload or the web bridge. */
export type UiMode = 'desktop' | 'web'

/**
 * The one transport contract every `window.ptnotes` method goes through.
 * The Electron preload implements it over `ipcRenderer`; the web bridge over
 * HTTP + SSE to the same main process.
 */
export interface Transport {
  readonly mode: UiMode
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, ...args: unknown[]): void
  /** Subscribe to a main→renderer push channel; returns the unsubscribe function. */
  on(channel: string, listener: (payload: unknown) => void): () => void
  /** Absolute path of a dropped/pasted `File` — `''` when the runtime has none (web). */
  getPathForFile(file: File): string
}

/**
 * The complete `window.ptnotes` surface, built once and shared by both
 * transports. `PTNotesApi` is derived from this factory, so the preload and
 * the web bridge cannot drift from what the renderer expects.
 */
export function createApi(t: Transport) {
  const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    t.invoke(channel, ...args) as Promise<T>
  const on = <E>(channel: string, callback: (event: E) => void): (() => void) =>
    t.on(channel, (payload) => callback(payload as E))

  return {
    ui: { mode: t.mode },

    projects: {
      list: (): Promise<Project[]> => invoke('projects:list'),
      create: (name: string): Promise<CreateProjectResult> => invoke('projects:create', name),
      recreate: (name: string): Promise<CreateProjectResult> => invoke('projects:recreate', name),
      rename: (oldName: string, newName: string): Promise<Project> =>
        invoke('projects:rename', oldName, newName),
      delete: (name: string): Promise<void> => invoke('projects:delete', name)
    },

    notes: {
      list: (project: string): Promise<NoteMeta[]> => invoke('notes:list', project),
      read: (project: string, id: string): Promise<string> => invoke('notes:read', project, id),
      save: (project: string, id: string, content: string): Promise<void> =>
        invoke('notes:save', project, id, content),
      create: (project: string, title: string): Promise<NoteMeta> =>
        invoke('notes:create', project, title),
      rename: (project: string, id: string, newTitle: string): Promise<NoteMeta> =>
        invoke('notes:rename', project, id, newTitle),
      delete: (project: string, id: string): Promise<void> => invoke('notes:delete', project, id),
      reveal: (project: string, id: string): Promise<void> => invoke('notes:reveal', project, id),
      setStarred: (project: string, id: string, starred: boolean): Promise<NoteMeta[]> =>
        invoke('notes:setStarred', project, id, starred),
      search: (project: string, query: string): Promise<NoteSearchMatch[]> =>
        invoke('notes:search', project, query)
    },

    kanban: {
      load: (project: string): Promise<KanbanBoard> => invoke('kanban:load', project),
      createCard: (project: string, input: NewKanbanCardInput): Promise<KanbanBoard> =>
        invoke('kanban:createCard', project, input),
      updateCard: (project: string, cardId: string, patch: KanbanCardPatch): Promise<KanbanBoard> =>
        invoke('kanban:updateCard', project, cardId, patch),
      moveCard: (
        project: string,
        cardId: string,
        columnId: string,
        index?: number
      ): Promise<KanbanBoard> => invoke('kanban:moveCard', project, cardId, columnId, index),
      deleteCard: (project: string, cardId: string): Promise<KanbanBoard> =>
        invoke('kanban:deleteCard', project, cardId),
      addComment: (
        project: string,
        cardId: string,
        input: KanbanCommentInput
      ): Promise<KanbanBoard> => invoke('kanban:addComment', project, cardId, input),
      updateComment: (
        project: string,
        cardId: string,
        commentId: string,
        input: KanbanCommentInput
      ): Promise<KanbanBoard> => invoke('kanban:updateComment', project, cardId, commentId, input),
      deleteComment: (project: string, cardId: string, commentId: string): Promise<KanbanBoard> =>
        invoke('kanban:deleteComment', project, cardId, commentId),
      addColumn: (project: string, input: NewKanbanColumnInput): Promise<KanbanBoard> =>
        invoke('kanban:addColumn', project, input),
      updateColumn: (
        project: string,
        columnId: string,
        patch: KanbanColumnPatch
      ): Promise<KanbanBoard> => invoke('kanban:updateColumn', project, columnId, patch),
      moveColumn: (project: string, columnId: string, toIndex: number): Promise<KanbanBoard> =>
        invoke('kanban:moveColumn', project, columnId, toIndex),
      deleteColumn: (
        project: string,
        columnId: string,
        options: { mode: 'move' | 'delete'; targetColumnId?: string }
      ): Promise<KanbanBoard> => invoke('kanban:deleteColumn', project, columnId, options),
      loadArchive: (project: string): Promise<KanbanArchive> =>
        invoke('kanban:loadArchive', project),
      archiveColumn: (project: string, columnId: string): Promise<KanbanArchiveMove> =>
        invoke('kanban:archiveColumn', project, columnId),
      archiveCard: (project: string, cardId: string): Promise<KanbanArchiveMove> =>
        invoke('kanban:archiveCard', project, cardId),
      restoreCard: (project: string, cardId: string): Promise<KanbanArchiveMove> =>
        invoke('kanban:restoreCard', project, cardId),
      deleteArchivedCard: (project: string, cardId: string): Promise<KanbanArchive> =>
        invoke('kanban:deleteArchivedCard', project, cardId)
    },

    chat: {
      list: (project: string): Promise<ChatSessionMeta[]> => invoke('chat:list', project),
      read: (project: string, sessionId: string): Promise<ChatThread> =>
        invoke('chat:read', project, sessionId),
      write: (project: string, thread: ChatThread): Promise<void> =>
        invoke('chat:write', project, thread),
      delete: (project: string, sessionId: string): Promise<void> =>
        invoke('chat:delete', project, sessionId),
      rename: (project: string, sessionId: string, title: string): Promise<void> =>
        invoke('chat:rename', project, sessionId, title),
      readTrace: (project: string, sessionId: string): Promise<AiTraceFile | null> =>
        invoke('chat:readTrace', project, sessionId),
      traceExists: (project: string, sessionId: string): Promise<boolean> =>
        invoke('chat:traceExists', project, sessionId)
    },

    planner: {
      list: (project: string): Promise<ScheduleMeta[]> => invoke('planner:list', project),
      read: (project: string, id: string): Promise<Schedule | null> =>
        invoke('planner:read', project, id),
      save: (project: string, schedule: Schedule): Promise<void> =>
        invoke('planner:save', project, schedule),
      create: (project: string, name: string): Promise<ScheduleMeta> =>
        invoke('planner:create', project, name),
      rename: (project: string, id: string, newName: string): Promise<ScheduleMeta> =>
        invoke('planner:rename', project, id, newName),
      duplicate: (project: string, id: string): Promise<ScheduleMeta> =>
        invoke('planner:duplicate', project, id),
      delete: (project: string, id: string): Promise<void> => invoke('planner:delete', project, id),
      reveal: (project: string, id: string): Promise<void> => invoke('planner:reveal', project, id),
      getCalendar: (project: string): Promise<ProjectCalendar> =>
        invoke('planner:getCalendar', project),
      saveCalendar: (project: string, calendar: ProjectCalendar): Promise<void> =>
        invoke('planner:saveCalendar', project, calendar),
      exportExcel: (payload: PlannerExportPayload): Promise<PlannerExportResult> =>
        invoke('planner:exportExcel', payload),
      setEditActive: (active: boolean): void => t.send('planner:set-edit-active', active),
      onUndoRedo: (callback: (data: { redo: boolean }) => void): (() => void) =>
        on<{ redo: boolean }>('planner:undo-redo', callback)
    },

    snapshots: {
      list: (project: string, scheduleId: string): Promise<SnapshotMeta[]> =>
        invoke('snapshots:list', project, scheduleId),
      read: (project: string, scheduleId: string, ts: number): Promise<Schedule | null> =>
        invoke('snapshots:read', project, scheduleId, ts),
      restore: (project: string, scheduleId: string, ts: number): Promise<Schedule> =>
        invoke('snapshots:restore', project, scheduleId, ts),
      setTag: (
        project: string,
        scheduleId: string,
        ts: number,
        tag: string | null
      ): Promise<void> => invoke('snapshots:setTag', project, scheduleId, ts, tag),
      delete: (project: string, scheduleId: string, ts: number): Promise<void> =>
        invoke('snapshots:delete', project, scheduleId, ts)
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
        invoke(
          'ai:send',
          project,
          sessionId,
          text,
          history,
          activeNoteId,
          activeScheduleId,
          activeKanbanCardId
        ),
      stop: (project: string): Promise<void> => invoke('ai:stop', project),
      confirmResponse: (resp: ConfirmResponse): Promise<void> => invoke('ai:confirmResponse', resp),
      askResponse: (resp: AskResponse): Promise<void> => invoke('ai:askResponse', resp),
      clear: (project: string): Promise<void> => invoke('ai:clear', project),
      generateTitle: (project: string, sessionId: string, firstMessage: string): Promise<string> =>
        invoke('ai:generateTitle', project, sessionId, firstMessage),
      getConfig: (): Promise<AIProviderConfig> => invoke('ai:getConfig'),
      getProfiles: (): Promise<AIConfig> => invoke('ai:getProfiles'),
      saveProfiles: (config: AIConfig): Promise<AIConfig> => invoke('ai:saveProfiles', config),
      listModels: (baseUrl: string, apiKey: string): Promise<string[] | { error: string }> =>
        invoke('ai:listModels', baseUrl, apiKey),
      onStreamEvent: (callback: (event: ChatStreamEvent) => void): (() => void) =>
        on<ChatStreamEvent>('ai:stream', callback)
    },

    settings: {
      get: (): Promise<StorageSettings> => invoke('settings:get'),
      getTheme: (): Promise<'light' | 'dark' | 'system'> => invoke('settings:getTheme'),
      setTheme: (theme: 'light' | 'dark' | 'system'): Promise<'light' | 'dark' | 'system'> =>
        invoke('settings:setTheme', theme),
      getAppearance: (): Promise<AppearanceSettings> => invoke('settings:getAppearance'),
      setAppearance: (patch: Partial<AppearanceSettings>): Promise<AppearanceSettings> =>
        invoke('settings:setAppearance', patch),
      getAbout: (): Promise<AboutInfo> => invoke('settings:getAbout'),
      chooseRoot: (): Promise<string | null> => invoke('settings:chooseRoot'),
      changeRoot: (newRoot: string): Promise<StorageSettings> =>
        invoke('settings:changeRoot', newRoot)
    },

    skills: {
      list: (project: string): Promise<SkillList> => invoke('skills:list', project),
      read: (project: string, scope: SkillScope, name: string): Promise<SkillContent | null> =>
        invoke('skills:read', project, scope, name),
      save: (
        project: string,
        scope: SkillScope,
        name: string,
        input: { description: string; content: string; enabled?: boolean }
      ): Promise<SkillMeta> => invoke('skills:save', project, scope, name, input),
      setEnabled: (
        project: string,
        scope: SkillScope,
        name: string,
        enabled: boolean
      ): Promise<SkillMeta> => invoke('skills:setEnabled', project, scope, name, enabled),
      setBuiltinEnabled: (name: string, enabled: boolean): Promise<SkillMeta> =>
        invoke('skills:setBuiltinEnabled', name, enabled),
      move: (
        project: string,
        scope: SkillScope,
        name: string,
        toScope: SkillScope
      ): Promise<SkillMeta> => invoke('skills:move', project, scope, name, toScope),
      delete: (project: string, scope: SkillScope, name: string): Promise<boolean> =>
        invoke('skills:delete', project, scope, name)
    },

    pdf: {
      supportsUpload: (): Promise<boolean> => invoke('pdf:supportsUpload'),
      upload: (project: string, sessionId: string, path: string, prompt: string): Promise<void> =>
        invoke('pdf:upload', project, sessionId, path, prompt),
      info: (project: string, subpath: string): Promise<PdfInfo> =>
        invoke('pdf:info', project, subpath),
      setViewerOpen: (open: boolean): void => t.send('pdf-viewer:set-open', open),
      onEscape: (cb: () => void): (() => void) => on<void>('pdf-viewer:escape', () => cb()),
      renderPage: (
        project: string,
        subpath: string,
        page: number,
        rotation?: number
      ): Promise<PdfPageThumbnail> => invoke('pdf:renderPage', project, subpath, page, rotation),
      rebuild: (project: string, subpath: string, edits: PdfPageEdit[]): Promise<string> =>
        invoke('pdf:rebuild', project, subpath, edits),
      merge: (
        project: string,
        sourceSubpaths: string[],
        destSubpath: string,
        destName?: string
      ): Promise<string> => invoke('pdf:merge', project, sourceSubpaths, destSubpath, destName)
    },

    files: {
      list: (project: string): Promise<string[]> => invoke('files:list', project),
      listEntries: (project: string, subpath?: string): Promise<FileEntry[]> =>
        invoke('files:listEntries', project, subpath),
      absPath: (project: string, fileName: string): Promise<string | null> =>
        invoke('files:absPath', project, fileName),
      readText: (project: string, fileName: string): Promise<string> =>
        invoke('files:readText', project, fileName),
      explorerList: (project: string, subpath?: string): Promise<ExplorerEntry[]> =>
        invoke('files:explorerList', project, subpath),
      explorerTree: (project: string): Promise<ExplorerFolderNode> =>
        invoke('files:explorerTree', project),
      explorerCreateFolder: (
        project: string,
        parentSubpath: string,
        name: string
      ): Promise<string> => invoke('files:explorerCreateFolder', project, parentSubpath, name),
      explorerCopy: (project: string, fromPaths: string[], destSubpath: string): Promise<number> =>
        invoke('files:explorerCopy', project, fromPaths, destSubpath),
      explorerMove: (project: string, fromPaths: string[], destSubpath: string): Promise<number> =>
        invoke('files:explorerMove', project, fromPaths, destSubpath),
      explorerRename: (project: string, itemPath: string, newName: string): Promise<string> =>
        invoke('files:explorerRename', project, itemPath, newName),
      explorerDelete: (project: string, itemPaths: string[]): Promise<number> =>
        invoke('files:explorerDelete', project, itemPaths),
      importDropped: (
        project: string,
        sourcePath: string,
        destSubpath: string,
        fileName?: string
      ): Promise<string> =>
        invoke('files:importDropped', project, sourcePath, destSubpath, fileName),
      getPathForFile: (file: File): string => t.getPathForFile(file),
      copyToProject: (project: string, sourcePath: string, fileName?: string): Promise<string> =>
        invoke('files:copyToProject', project, sourcePath, fileName),
      copyBufferToProject: (project: string, fileName: string, data: Uint8Array) =>
        invoke<string>('files:copyBufferToProject', project, fileName, data),
      importDroppedData: (
        project: string,
        destSubpath: string,
        fileName: string,
        data: Uint8Array
      ) => invoke<string>('files:importDroppedData', project, destSubpath, fileName, data),
      extract: (path: string): Promise<PdfExtractResult> => invoke('files:extract', path),
      reveal: (path: string): Promise<void> => invoke('files:reveal', path),
      revealByName: (project: string, fileName: string): Promise<void> =>
        invoke('files:revealByName', project, fileName),
      openExternal: (project: string, fileName: string): Promise<string> =>
        invoke('files:openExternal', project, fileName)
    },

    dashboard: {
      getSnapshot: (project: string): Promise<DashboardSnapshot> =>
        invoke('dashboard:getSnapshot', project)
    },

    gallery: {
      list: (project: string): Promise<GalleryImage[]> => invoke('gallery:list', project),
      import: (project: string, sourcePath: string, fileName?: string): Promise<string> =>
        invoke('gallery:import', project, sourcePath, fileName),
      importData: (project: string, fileName: string, data: Uint8Array): Promise<string> =>
        invoke('gallery:importData', project, fileName, data),
      choose: (project: string): Promise<string[]> => invoke('gallery:choose', project),
      delete: (project: string, name: string): Promise<void> =>
        invoke('gallery:delete', project, name)
    },

    modules: {
      list: (project: string): Promise<ModuleRun[]> => invoke('modules:list', project),
      listAvailable: (): Promise<ModuleSettings[]> => invoke('modules:listAvailable'),
      setEnabled: (id: string, enabled: boolean): Promise<ModuleSettings[]> =>
        invoke('modules:setEnabled', id, enabled),
      stop: (project: string, runId: string): Promise<void> =>
        invoke('modules:stop', project, runId),
      retry: (project: string, runId: string): Promise<ModuleStartResult> =>
        invoke('modules:retry', project, runId),
      reveal: (
        project: string,
        runId: string,
        filePath?: string
      ): Promise<{ ok: boolean; error?: string }> =>
        invoke('modules:reveal', project, runId, filePath),
      clearHistory: (project: string, deleteOutputFiles?: boolean): Promise<number> =>
        invoke('modules:clearHistory', project, deleteOutputFiles),
      deleteRun: (project: string, runId: string, deleteOutputFiles?: boolean): Promise<boolean> =>
        invoke('modules:deleteRun', project, runId, deleteOutputFiles),
      readChat: (project: string, runId: string): Promise<ModuleChatMessage[]> =>
        invoke('modules:readChat', project, runId),
      readTrace: (project: string, runId: string): Promise<AiTraceFile | null> =>
        invoke('modules:readTrace', project, runId),
      onEvent: (callback: (event: ModuleEvent) => void): (() => void) =>
        on<ModuleEvent>('modules:event', callback)
    },

    toolsets: {
      listAvailable: (): Promise<ToolsetSettings[]> => invoke('toolsets:listAvailable'),
      setEnabled: (id: string, enabled: boolean): Promise<ToolsetSettings[]> =>
        invoke('toolsets:setEnabled', id, enabled),
      setConfig: (id: string, key: string, value: unknown): Promise<ToolsetSettings[]> =>
        invoke('toolsets:setConfig', id, key, value)
    },

    mcp: {
      listServers: (): Promise<McpServerConfig[]> => invoke('mcp:listServers'),
      save: (config: McpServerConfig): Promise<McpServerConfig[]> => invoke('mcp:save', config),
      delete: (id: string): Promise<McpServerConfig[]> => invoke('mcp:delete', id),
      test: (config: McpServerConfig): Promise<McpTestResult> => invoke('mcp:test', config)
    },

    mcpServer: {
      getStatus: (): Promise<McpServerStatus> => invoke('mcpServer:getStatus'),
      update: (patch: Partial<McpServerSettings>): Promise<McpServerStatus> =>
        invoke('mcpServer:update', patch),
      regenerateToken: (): Promise<McpServerStatus> => invoke('mcpServer:regenerateToken')
    },

    jobs: {
      list: (project: string): Promise<ScheduleJob[]> => invoke('jobs:list', project),
      save: (project: string, input: ScheduleJobInput): Promise<ScheduleJob> =>
        invoke('jobs:save', project, input),
      moveScope: (
        src: string,
        dest: string,
        id: string,
        input: ScheduleJobInput
      ): Promise<ScheduleJob> => invoke('jobs:moveScope', src, dest, id, input),
      setEnabled: (project: string, id: string, enabled: boolean): Promise<ScheduleJob> =>
        invoke('jobs:setEnabled', project, id, enabled),
      delete: (project: string, id: string): Promise<boolean> => invoke('jobs:delete', project, id),
      runNow: (project: string, id: string): Promise<void> => invoke('jobs:runNow', project, id),
      runs: (project: string, jobId: string, limit?: number): Promise<ScheduleJobRun[]> =>
        invoke('jobs:runs', project, jobId, limit),
      readTrace: (project: string, runId: string): Promise<AiTraceFile | null> =>
        invoke('jobs:readTrace', project, runId),
      onEvent: (callback: (event: ScheduleJobEvent) => void): (() => void) =>
        on<ScheduleJobEvent>('jobs:event', callback)
    },

    bots: {
      listBots: (): Promise<BotProfile[]> => invoke('bots:listBots'),
      saveBot: (input: BotUpsertInput): Promise<BotProfile[]> => invoke('bots:saveBot', input),
      deleteBot: (id: string): Promise<boolean> => invoke('bots:deleteBot', id),
      getUserName: (): Promise<string> => invoke('bots:getUserName'),
      setUserName: (name: string): Promise<string> => invoke('bots:setUserName', name),
      listMemories: (project: string, botId?: string): Promise<BotMemoryEntry[]> =>
        invoke('bots:listMemories', project, botId),
      deleteMemory: (project: string, botId: string, memoryId: string): Promise<boolean> =>
        invoke('bots:deleteMemory', project, botId, memoryId),
      listGroups: (project: string): Promise<GroupChatMeta[]> => invoke('bots:listGroups', project),
      readGroup: (
        project: string,
        groupId: string,
        opts?: GroupMessagePageOpts
      ): Promise<GroupChatData | null> => invoke('bots:readGroup', project, groupId, opts),
      createGroup: (project: string, input: NewGroupInput): Promise<GroupChatMeta> =>
        invoke('bots:createGroup', project, input),
      updateGroup: (project: string, groupId: string, patch: GroupPatch): Promise<GroupChatMeta> =>
        invoke('bots:updateGroup', project, groupId, patch),
      deleteGroup: (project: string, groupId: string): Promise<boolean> =>
        invoke('bots:deleteGroup', project, groupId),
      clearGroupMessages: (project: string, groupId: string): Promise<void> =>
        invoke('bots:clearGroupMessages', project, groupId),
      send: (project: string, groupId: string, text: string): Promise<void> =>
        invoke('bots:send', project, groupId, text),
      stop: (project: string, groupId: string): Promise<void> =>
        invoke('bots:stop', project, groupId),
      askResponse: (
        project: string,
        groupId: string,
        messageId: string,
        answers: AskAnswer[],
        cancelled: boolean
      ): Promise<boolean> =>
        invoke('bots:askResponse', project, groupId, messageId, answers, cancelled),
      listTasks: (project: string): Promise<ModuleRun[]> => invoke('bots:listTasks', project),
      clearTaskHistory: (project: string, deleteOutputFiles?: boolean): Promise<number> =>
        invoke('bots:clearTaskHistory', project, deleteOutputFiles),
      readTrace: (project: string, groupId: string): Promise<AiTraceFile | null> =>
        invoke('bots:readTrace', project, groupId),
      onEvent: (callback: (event: BotGroupEvent) => void): (() => void) =>
        on<BotGroupEvent>('bots:event', callback)
    },

    diagrams: {
      render: (source: string): Promise<MermaidRenderResult> => invoke('diagrams:render', source),
      saveDiagram: (name: string, data: Uint8Array, format: 'png' | 'svg') =>
        invoke<DiagramSaveResult>('diagrams:save', { name, data, format })
    },

    infographic: {
      render: (infographic: string | Record<string, unknown>, pixelWidth?: number) =>
        invoke<InfographicRenderResult>('infographic:render', infographic, pixelWidth)
    },

    onOpenFind: (callback: () => void): (() => void) =>
      on<void>('global:open-find', () => callback()),
    onSelectAll: (callback: () => void): (() => void) =>
      on<void>('global:select-all', () => callback())
  }
}

export type PTNotesApi = ReturnType<typeof createApi>
