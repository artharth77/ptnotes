import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'
import type {
  KanbanCardPatch,
  KanbanColumnPatch,
  KanbanCommentInput,
  NewKanbanCardInput,
  NewKanbanColumnInput
} from '@shared/types'

export function registerKanbanIpc(service: PTNotesService): void {
  ipcMain.handle('kanban:load', async (_e: IpcMainInvokeEvent, project: string) =>
    service.loadKanban(project)
  )
  ipcMain.handle(
    'kanban:createCard',
    async (_e: IpcMainInvokeEvent, project: string, input: NewKanbanCardInput) =>
      service.createKanbanCard(project, input)
  )
  ipcMain.handle(
    'kanban:updateCard',
    async (_e: IpcMainInvokeEvent, project: string, cardId: string, patch: KanbanCardPatch) =>
      service.updateKanbanCard(project, cardId, patch)
  )
  ipcMain.handle(
    'kanban:moveCard',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      cardId: string,
      columnId: string,
      index?: number
    ) => service.moveKanbanCard(project, cardId, columnId, index)
  )
  ipcMain.handle(
    'kanban:deleteCard',
    async (_e: IpcMainInvokeEvent, project: string, cardId: string) =>
      service.deleteKanbanCard(project, cardId)
  )
  ipcMain.handle(
    'kanban:addComment',
    async (_e: IpcMainInvokeEvent, project: string, cardId: string, input: KanbanCommentInput) =>
      service.addKanbanComment(project, cardId, input)
  )
  ipcMain.handle(
    'kanban:updateComment',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      cardId: string,
      commentId: string,
      input: KanbanCommentInput
    ) => service.updateKanbanComment(project, cardId, commentId, input)
  )
  ipcMain.handle(
    'kanban:deleteComment',
    async (_e: IpcMainInvokeEvent, project: string, cardId: string, commentId: string) =>
      service.deleteKanbanComment(project, cardId, commentId)
  )
  ipcMain.handle(
    'kanban:addColumn',
    async (_e: IpcMainInvokeEvent, project: string, input: NewKanbanColumnInput) =>
      service.addKanbanColumn(project, input)
  )
  ipcMain.handle(
    'kanban:updateColumn',
    async (_e: IpcMainInvokeEvent, project: string, columnId: string, patch: KanbanColumnPatch) =>
      service.updateKanbanColumn(project, columnId, patch)
  )
  ipcMain.handle(
    'kanban:moveColumn',
    async (_e: IpcMainInvokeEvent, project: string, columnId: string, toIndex: number) =>
      service.moveKanbanColumn(project, columnId, toIndex)
  )
  ipcMain.handle(
    'kanban:deleteColumn',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      columnId: string,
      options: { mode: 'move' | 'delete'; targetColumnId?: string }
    ) => service.deleteKanbanColumn(project, columnId, options)
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
