import { rpc, type InvokeCtx } from '../rpc/registry'
import type { SaveDialogOptions } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'

import type { PTNotesService } from '../service/PTNotesService'
import { emitClientAction } from '../platform'
import { putBlob } from '../rpc/blobs'
import type { AiTraceFile, ChatThread, NoteExportResult } from '@shared/types'

export function registerProjectIpc(service: PTNotesService): void {
  rpc.handle('projects:list', async () => service.listProjects())
  rpc.handle('projects:create', async (_e, name: string) => service.createProject(name))
  rpc.handle('projects:recreate', async (_e, name: string) => service.recreateProject(name))
  rpc.handle('projects:rename', async (_e, oldName: string, newName: string) =>
    service.renameProject(oldName, newName)
  )
  rpc.handle('projects:delete', async (_e, name: string) => service.deleteProject(name))
}

export function registerNoteIpc(service: PTNotesService): void {
  rpc.handle('notes:list', async (_e: InvokeCtx, project: string) => service.listNotes(project))
  rpc.handle('notes:read', async (_e: InvokeCtx, project: string, noteId: string) =>
    service.readNote(project, noteId)
  )
  rpc.handle(
    'notes:save',
    async (_e: InvokeCtx, project: string, noteId: string, content: string) =>
      service.saveNote(project, noteId, content)
  )
  rpc.handle('notes:create', async (_e: InvokeCtx, project: string, title: string) =>
    service.createNote(project, title)
  )
  rpc.handle(
    'notes:rename',
    async (_e: InvokeCtx, project: string, noteId: string, newTitle: string) =>
      service.renameNote(project, noteId, newTitle)
  )
  rpc.handle('notes:delete', async (_e: InvokeCtx, project: string, noteId: string) =>
    service.deleteNote(project, noteId)
  )
  rpc.handle('notes:reveal', async (_e: InvokeCtx, project: string, noteId: string) =>
    service.revealNoteInFolder(project, noteId)
  )
  rpc.handle(
    'notes:export',
    async (ctx: InvokeCtx, project: string, noteId: string): Promise<NoteExportResult> => {
      try {
        const { data, fileName, mime } = await service.buildNoteExport(project, noteId)
        if (ctx.platform.mode === 'web') {
          emitClientAction({ kind: 'download', url: putBlob(data, mime, fileName) })
          return { ok: true, path: fileName }
        }
        const zip = fileName.endsWith('.zip')
        const options: SaveDialogOptions = {
          title: zip ? 'Export note with images' : 'Export note',
          defaultPath: join(app.getPath('downloads'), fileName),
          filters: zip
            ? [{ name: 'Zip Archive', extensions: ['zip'] }]
            : [{ name: 'Markdown', extensions: ['md'] }]
        }
        const filePath = await ctx.platform.showSaveDialog(options)
        if (!filePath) return { ok: false, canceled: true }
        await writeFile(filePath, data)
        return { ok: true, path: filePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
  rpc.handle(
    'notes:setStarred',
    async (_e: InvokeCtx, project: string, noteId: string, starred: boolean) =>
      service.setNoteStarred(project, noteId, starred)
  )
  rpc.handle('notes:search', async (_e: InvokeCtx, project: string, query: string) =>
    service.searchNotes(project, query)
  )
}

export function registerChatIpc(service: PTNotesService): void {
  rpc.handle('chat:list', async (_e: InvokeCtx, project: string) =>
    service.listChatSessions(project)
  )
  rpc.handle('chat:read', async (_e: InvokeCtx, project: string, sessionId: string) =>
    service.readChat(project, sessionId)
  )
  rpc.handle('chat:write', async (_e: InvokeCtx, project: string, thread: ChatThread) =>
    service.writeChat(project, thread)
  )
  rpc.handle('chat:delete', async (_e: InvokeCtx, project: string, sessionId: string) =>
    service.deleteChat(project, sessionId)
  )
  rpc.handle(
    'chat:rename',
    async (_e: InvokeCtx, project: string, sessionId: string, title: string) =>
      service.renameChat(project, sessionId, title)
  )
  rpc.handle(
    'chat:readTrace',
    async (_e: InvokeCtx, project: string, sessionId: string): Promise<AiTraceFile | null> =>
      service.readChatTrace(project, sessionId)
  )
  rpc.handle(
    'chat:traceExists',
    async (_e: InvokeCtx, project: string, sessionId: string): Promise<boolean> => {
      if (!sessionId) return false
      const meta = await service.chatTraceMeta(project, sessionId)
      return meta.count > 0
    }
  )
}
