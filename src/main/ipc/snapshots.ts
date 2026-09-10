import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'

export function registerSnapshotsIpc(service: PTNotesService): void {
  ipcMain.handle(
    'snapshots:list',
    async (_e: IpcMainInvokeEvent, project: string, scheduleId: string) =>
      service.listSnapshots(project, scheduleId)
  )
  ipcMain.handle(
    'snapshots:read',
    async (_e: IpcMainInvokeEvent, project: string, scheduleId: string, ts: number) =>
      service.readSnapshot(project, scheduleId, ts)
  )
  ipcMain.handle(
    'snapshots:restore',
    async (_e: IpcMainInvokeEvent, project: string, scheduleId: string, ts: number) =>
      service.restoreSnapshot(project, scheduleId, ts)
  )
  ipcMain.handle(
    'snapshots:setTag',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      scheduleId: string,
      ts: number,
      tag: string | null
    ) => service.setSnapshotTag(project, scheduleId, ts, tag)
  )
  ipcMain.handle(
    'snapshots:delete',
    async (_e: IpcMainInvokeEvent, project: string, scheduleId: string, ts: number) =>
      service.deleteSnapshot(project, scheduleId, ts)
  )
}
