import { rpc, type InvokeCtx } from '../rpc/registry'

import type { PTNotesService } from '../service/PTNotesService'

export function registerSnapshotsIpc(service: PTNotesService): void {
  rpc.handle('snapshots:list', async (_e: InvokeCtx, project: string, scheduleId: string) =>
    service.listSnapshots(project, scheduleId)
  )
  rpc.handle(
    'snapshots:read',
    async (_e: InvokeCtx, project: string, scheduleId: string, ts: number) =>
      service.readSnapshot(project, scheduleId, ts)
  )
  rpc.handle(
    'snapshots:restore',
    async (_e: InvokeCtx, project: string, scheduleId: string, ts: number) =>
      service.restoreSnapshot(project, scheduleId, ts)
  )
  rpc.handle(
    'snapshots:setTag',
    async (_e: InvokeCtx, project: string, scheduleId: string, ts: number, tag: string | null) =>
      service.setSnapshotTag(project, scheduleId, ts, tag)
  )
  rpc.handle(
    'snapshots:delete',
    async (_e: InvokeCtx, project: string, scheduleId: string, ts: number) =>
      service.deleteSnapshot(project, scheduleId, ts)
  )
}
