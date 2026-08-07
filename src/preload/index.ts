import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AIProviderConfig,
  ChatMessage,
  ChatSessionMeta,
  ChatStreamEvent,
  ChatThread,
  ConfirmResponse,
  CreateProjectResult,
  StorageSettings,
  NoteMeta,
  PdfExtractResult,
  Project,
  Todo
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
  todos: {
    list: (project: string): Promise<Todo[]> => ipcRenderer.invoke('todos:list', project),
    add: (project: string, texts: string[]): Promise<Todo[]> =>
      ipcRenderer.invoke('todos:add', project, texts),
    toggle: (project: string, id: string): Promise<Todo[]> =>
      ipcRenderer.invoke('todos:toggle', project, id),
    delete: (project: string, id: string): Promise<Todo[]> =>
      ipcRenderer.invoke('todos:delete', project, id),
    deleteCompleted: (project: string): Promise<Todo[]> =>
      ipcRenderer.invoke('todos:deleteCompleted', project),
    update: (project: string, id: string, text: string): Promise<Todo[]> =>
      ipcRenderer.invoke('todos:update', project, id, text),
    reorder: (project: string, orderedIds: string[]): Promise<Todo[]> =>
      ipcRenderer.invoke('todos:reorder', project, orderedIds)
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
      ipcRenderer.invoke('chat:rename', project, sessionId, title)
  },
  ai: {
    send: (project: string, text: string, history?: ChatMessage[]): Promise<void> =>
      ipcRenderer.invoke('ai:send', project, text, history),
    stop: (project: string): Promise<void> => ipcRenderer.invoke('ai:stop', project),
    confirmResponse: (resp: ConfirmResponse): Promise<void> =>
      ipcRenderer.invoke('ai:confirmResponse', resp),
    clear: (project: string): Promise<void> => ipcRenderer.invoke('ai:clear', project),
    generateTitle: (project: string, firstMessage: string): Promise<string> =>
      ipcRenderer.invoke('ai:generateTitle', project, firstMessage),
    getConfig: (): Promise<AIProviderConfig> => ipcRenderer.invoke('ai:getConfig'),
    listModels: (baseUrl: string, apiKey: string): Promise<string[] | { error: string }> =>
      ipcRenderer.invoke('ai:listModels', baseUrl, apiKey),
    setConfig: (config: AIProviderConfig): Promise<AIProviderConfig> =>
      ipcRenderer.invoke('ai:setConfig', config),
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
    chooseRoot: (): Promise<string | null> => ipcRenderer.invoke('settings:chooseRoot'),
    changeRoot: (newRoot: string): Promise<StorageSettings> =>
      ipcRenderer.invoke('settings:changeRoot', newRoot)
  },
  pdf: {
    supportsUpload: (): Promise<boolean> => ipcRenderer.invoke('pdf:supportsUpload'),
    upload: (project: string, path: string, prompt: string): Promise<void> =>
      ipcRenderer.invoke('pdf:upload', project, path, prompt)
  },
  files: {
    list: (project: string): Promise<string[]> => ipcRenderer.invoke('files:list', project),
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    copyToProject: (project: string, sourcePath: string, fileName?: string): Promise<string> =>
      ipcRenderer.invoke('files:copyToProject', project, sourcePath, fileName),
    extract: (path: string): Promise<PdfExtractResult> => ipcRenderer.invoke('files:extract', path),
    reveal: (path: string): Promise<void> => ipcRenderer.invoke('files:reveal', path)
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
