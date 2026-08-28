import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'
import type { AiTraceFile, ChatThread } from '@shared/types'

export function registerProjectIpc(service: PTNotesService): void {
  ipcMain.handle('projects:list', async () => service.listProjects())
  ipcMain.handle('projects:create', async (_e, name: string) => service.createProject(name))
  ipcMain.handle('projects:recreate', async (_e, name: string) => service.recreateProject(name))
  ipcMain.handle('projects:rename', async (_e, oldName: string, newName: string) =>
    service.renameProject(oldName, newName)
  )
  ipcMain.handle('projects:delete', async (_e, name: string) => service.deleteProject(name))
}

export function registerNoteIpc(service: PTNotesService): void {
  ipcMain.handle('notes:list', async (_e: IpcMainInvokeEvent, project: string) =>
    service.listNotes(project)
  )
  ipcMain.handle('notes:read', async (_e: IpcMainInvokeEvent, project: string, noteId: string) =>
    service.readNote(project, noteId)
  )
  ipcMain.handle(
    'notes:save',
    async (_e: IpcMainInvokeEvent, project: string, noteId: string, content: string) =>
      service.saveNote(project, noteId, content)
  )
  ipcMain.handle('notes:create', async (_e: IpcMainInvokeEvent, project: string, title: string) =>
    service.createNote(project, title)
  )
  ipcMain.handle(
    'notes:rename',
    async (_e: IpcMainInvokeEvent, project: string, noteId: string, newTitle: string) =>
      service.renameNote(project, noteId, newTitle)
  )
  ipcMain.handle('notes:delete', async (_e: IpcMainInvokeEvent, project: string, noteId: string) =>
    service.deleteNote(project, noteId)
  )
  ipcMain.handle('notes:reveal', async (_e: IpcMainInvokeEvent, project: string, noteId: string) =>
    service.revealNoteInFolder(project, noteId)
  )
}

export function registerChatIpc(service: PTNotesService): void {
  ipcMain.handle('chat:list', async (_e: IpcMainInvokeEvent, project: string) =>
    service.listChatSessions(project)
  )
  ipcMain.handle('chat:read', async (_e: IpcMainInvokeEvent, project: string, sessionId: string) =>
    service.readChat(project, sessionId)
  )
  ipcMain.handle(
    'chat:write',
    async (_e: IpcMainInvokeEvent, project: string, thread: ChatThread) =>
      service.writeChat(project, thread)
  )
  ipcMain.handle(
    'chat:delete',
    async (_e: IpcMainInvokeEvent, project: string, sessionId: string) =>
      service.deleteChat(project, sessionId)
  )
  ipcMain.handle(
    'chat:rename',
    async (_e: IpcMainInvokeEvent, project: string, sessionId: string, title: string) =>
      service.renameChat(project, sessionId, title)
  )
  ipcMain.handle(
    'chat:readTrace',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      sessionId: string
    ): Promise<AiTraceFile | null> => service.readChatTrace(project, sessionId)
  )
}
