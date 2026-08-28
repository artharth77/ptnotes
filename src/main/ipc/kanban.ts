import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'
import type { KanbanBoard } from '@shared/types'

export function registerKanbanIpc(service: PTNotesService): void {
  ipcMain.handle('kanban:load', async (_e: IpcMainInvokeEvent, project: string) =>
    service.loadKanban(project)
  )
  ipcMain.handle(
    'kanban:save',
    async (_e: IpcMainInvokeEvent, project: string, board: KanbanBoard) =>
      service.saveKanban(project, board)
  )
  ipcMain.handle('kanban:loadArchive', async (_e: IpcMainInvokeEvent, project: string) =>
    service.loadKanbanArchive(project)
  )
  ipcMain.handle(
    'kanban:archiveCard',
    async (_e: IpcMainInvokeEvent, project: string, cardId: string) =>
      service.archiveKanbanCard(project, cardId)
  )
  ipcMain.handle(
    'kanban:restoreCard',
    async (_e: IpcMainInvokeEvent, project: string, cardId: string) =>
      service.restoreKanbanCard(project, cardId)
  )
  ipcMain.handle(
    'kanban:deleteArchivedCard',
    async (_e: IpcMainInvokeEvent, project: string, cardId: string) =>
      service.deleteArchivedKanbanCard(project, cardId)
  )
}
