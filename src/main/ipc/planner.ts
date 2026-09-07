import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import type { IpcMainInvokeEvent, SaveDialogOptions } from 'electron'
import { join } from 'path'
import type { PTNotesService } from '../service/PTNotesService'
import { buildPlannerExportXlsx } from '../planner/exportXlsx'
import type {
  PlannerExportPayload,
  PlannerExportResult,
  ProjectCalendar,
  Schedule
} from '@shared/types'

function isExportPayload(p: unknown): p is PlannerExportPayload {
  if (typeof p !== 'object' || p === null) return false
  const o = p as Record<string, unknown>
  if (typeof o.scheduleName !== 'string') return false
  if (typeof o.overallPercent !== 'number' || !Number.isFinite(o.overallPercent)) return false
  if (!Array.isArray(o.columns) || !Array.isArray(o.rows)) return false
  for (const c of o.columns as unknown[]) {
    if (typeof c !== 'object' || c === null) return false
    const cc = c as Record<string, unknown>
    if (typeof cc.key !== 'string' || typeof cc.label !== 'string') return false
  }
  for (const r of o.rows as unknown[]) {
    if (typeof r !== 'object' || r === null) return false
    const rr = r as Record<string, unknown>
    if (typeof rr.no !== 'string' || typeof rr.title !== 'string') return false
    if (typeof rr.status !== 'string') return false
    if (typeof rr.owner !== 'string') return false
    if (rr.duration !== null && typeof rr.duration !== 'number') return false
    for (const k of ['planStart', 'planEnd', 'actualStart', 'actualEnd'] as const) {
      if (rr[k] !== null && typeof rr[k] !== 'string') return false
    }
    if (typeof rr.percentComplete !== 'number' || !Number.isFinite(rr.percentComplete)) return false
    if (typeof rr.note !== 'string') return false
    if (typeof rr.depth !== 'number' || !Number.isInteger(rr.depth)) return false
    if (typeof rr.hasChildren !== 'boolean') return false
  }
  return true
}

export function registerPlannerIpc(service: PTNotesService): void {
  ipcMain.handle('planner:list', async (_e: IpcMainInvokeEvent, project: string) =>
    service.listSchedules(project)
  )
  ipcMain.handle('planner:read', async (_e: IpcMainInvokeEvent, project: string, id: string) =>
    service.readSchedule(project, id)
  )
  ipcMain.handle(
    'planner:save',
    async (_e: IpcMainInvokeEvent, project: string, schedule: Schedule) =>
      service.saveSchedule(project, schedule)
  )
  ipcMain.handle('planner:create', async (_e: IpcMainInvokeEvent, project: string, name: string) =>
    service.createSchedule(project, name)
  )
  ipcMain.handle(
    'planner:rename',
    async (_e: IpcMainInvokeEvent, project: string, id: string, newName: string) =>
      service.renameSchedule(project, id, newName)
  )
  ipcMain.handle('planner:duplicate', async (_e: IpcMainInvokeEvent, project: string, id: string) =>
    service.duplicateSchedule(project, id)
  )
  ipcMain.handle('planner:delete', async (_e: IpcMainInvokeEvent, project: string, id: string) =>
    service.deleteSchedule(project, id)
  )
  ipcMain.handle('planner:reveal', async (_e: IpcMainInvokeEvent, project: string, id: string) =>
    service.revealScheduleInFolder(project, id)
  )
  ipcMain.handle('planner:getCalendar', async (_e: IpcMainInvokeEvent, project: string) =>
    service.readCalendar(project)
  )
  ipcMain.handle(
    'planner:saveCalendar',
    async (_e: IpcMainInvokeEvent, project: string, calendar: ProjectCalendar) =>
      service.saveCalendar(project, calendar)
  )
  ipcMain.handle(
    'planner:exportExcel',
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<PlannerExportResult> => {
      if (!isExportPayload(payload)) return { ok: false, error: 'Invalid export payload.' }
      const name = payload.scheduleName.trim() || 'Schedule'
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: SaveDialogOptions = {
        title: 'Export schedule to Excel',
        defaultPath: join(app.getPath('downloads'), `${name}.xlsx`),
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
      }
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      try {
        await buildPlannerExportXlsx(payload, result.filePath)
        return { ok: true, path: result.filePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
