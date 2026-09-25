import { rpc, type InvokeCtx } from '../rpc/registry'

import type { PTNotesService } from '../service/PTNotesService'
import type {
  KanbanCardPatch,
  KanbanColumnPatch,
  KanbanCommentInput,
  NewKanbanCardInput,
  NewKanbanColumnInput
} from '@shared/types'

export function registerKanbanIpc(service: PTNotesService): void {
  rpc.handle('kanban:load', async (_e: InvokeCtx, project: string) => service.loadKanban(project))
  rpc.handle(
    'kanban:createCard',
    async (_e: InvokeCtx, project: string, input: NewKanbanCardInput) =>
      service.createKanbanCard(project, input)
  )
  rpc.handle(
    'kanban:updateCard',
    async (_e: InvokeCtx, project: string, cardId: string, patch: KanbanCardPatch) =>
      service.updateKanbanCard(project, cardId, patch)
  )
  rpc.handle(
    'kanban:moveCard',
    async (_e: InvokeCtx, project: string, cardId: string, columnId: string, index?: number) =>
      service.moveKanbanCard(project, cardId, columnId, index)
  )
  rpc.handle('kanban:deleteCard', async (_e: InvokeCtx, project: string, cardId: string) =>
    service.deleteKanbanCard(project, cardId)
  )
  rpc.handle(
    'kanban:addComment',
    async (_e: InvokeCtx, project: string, cardId: string, input: KanbanCommentInput) =>
      service.addKanbanComment(project, cardId, input)
  )
  rpc.handle(
    'kanban:updateComment',
    async (
      _e: InvokeCtx,
      project: string,
      cardId: string,
      commentId: string,
      input: KanbanCommentInput
    ) => service.updateKanbanComment(project, cardId, commentId, input)
  )
  rpc.handle(
    'kanban:deleteComment',
    async (_e: InvokeCtx, project: string, cardId: string, commentId: string) =>
      service.deleteKanbanComment(project, cardId, commentId)
  )
  rpc.handle(
    'kanban:addColumn',
    async (_e: InvokeCtx, project: string, input: NewKanbanColumnInput) =>
      service.addKanbanColumn(project, input)
  )
  rpc.handle(
    'kanban:updateColumn',
    async (_e: InvokeCtx, project: string, columnId: string, patch: KanbanColumnPatch) =>
      service.updateKanbanColumn(project, columnId, patch)
  )
  rpc.handle(
    'kanban:moveColumn',
    async (_e: InvokeCtx, project: string, columnId: string, toIndex: number) =>
      service.moveKanbanColumn(project, columnId, toIndex)
  )
  rpc.handle(
    'kanban:deleteColumn',
    async (
      _e: InvokeCtx,
      project: string,
      columnId: string,
      options: { mode: 'move' | 'delete'; targetColumnId?: string }
    ) => service.deleteKanbanColumn(project, columnId, options)
  )
  rpc.handle('kanban:loadArchive', async (_e: InvokeCtx, project: string) =>
    service.loadKanbanArchive(project)
  )
  rpc.handle('kanban:archiveColumn', async (_e: InvokeCtx, project: string, columnId: string) =>
    service.archiveKanbanColumn(project, columnId)
  )
  rpc.handle('kanban:archiveCard', async (_e: InvokeCtx, project: string, cardId: string) =>
    service.archiveKanbanCard(project, cardId)
  )
  rpc.handle('kanban:restoreCard', async (_e: InvokeCtx, project: string, cardId: string) =>
    service.restoreKanbanCard(project, cardId)
  )
  rpc.handle('kanban:deleteArchivedCard', async (_e: InvokeCtx, project: string, cardId: string) =>
    service.deleteArchivedKanbanCard(project, cardId)
  )
}
