import { rpc, type InvokeCtx } from '../rpc/registry'
import { app } from 'electron'
import type { SaveDialogOptions } from 'electron'
import { join } from 'path'
import type { PTNotesService } from '../service/PTNotesService'
import { buildPlannerExportXlsx, renderPlannerExportXlsx } from '../planner/exportXlsx'
import { emitClientAction } from '../platform'
import { putBlob } from '../rpc/blobs'
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
  const cal = o.calendar
  if (typeof cal !== 'object' || cal === null) return false
  const cc = cal as Record<string, unknown>
  if (typeof cc.weekStart !== 'number' || typeof cc.weekEnd !== 'number') return false
  if (!Array.isArray(cc.holidays) || cc.holidays.some((h) => typeof h !== 'string')) return false
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
    if (rr.dependsOn !== undefined && rr.dependsOn !== null && typeof rr.dependsOn !== 'string')
      return false
    if (typeof rr.depth !== 'number' || !Number.isInteger(rr.depth)) return false
    if (typeof rr.hasChildren !== 'boolean') return false
  }
  if (typeof o.progressDate !== 'string') return false
  if (o.progressMode !== 'percent' && o.progressMode !== 'percent-plan') return false
  if (
    o.planPercent !== null &&
    (typeof o.planPercent !== 'number' || !Number.isFinite(o.planPercent))
  )
    return false
  if (o.ganttMode !== 'none' && o.ganttMode !== 'day' && o.ganttMode !== 'week') return false
  return true
}

export function registerPlannerIpc(service: PTNotesService): void {
  rpc.handle('planner:list', async (_e: InvokeCtx, project: string) =>
    service.listSchedules(project)
  )
  rpc.handle('planner:read', async (_e: InvokeCtx, project: string, id: string) =>
    service.readSchedule(project, id)
  )
  rpc.handle('planner:save', async (_e: InvokeCtx, project: string, schedule: Schedule) =>
    service.saveSchedule(project, schedule)
  )
  rpc.handle('planner:create', async (_e: InvokeCtx, project: string, name: string) =>
    service.createSchedule(project, name)
  )
  rpc.handle(
    'planner:rename',
    async (_e: InvokeCtx, project: string, id: string, newName: string) =>
      service.renameSchedule(project, id, newName)
  )
  rpc.handle('planner:duplicate', async (_e: InvokeCtx, project: string, id: string) =>
    service.duplicateSchedule(project, id)
  )
  rpc.handle('planner:delete', async (_e: InvokeCtx, project: string, id: string) =>
    service.deleteSchedule(project, id)
  )
  rpc.handle('planner:reveal', async (_e: InvokeCtx, project: string, id: string) =>
    service.revealScheduleInFolder(project, id)
  )
  rpc.handle('planner:getCalendar', async (_e: InvokeCtx, project: string) =>
    service.readCalendar(project)
  )
  rpc.handle(
    'planner:saveCalendar',
    async (_e: InvokeCtx, project: string, calendar: ProjectCalendar) =>
      service.saveCalendar(project, calendar)
  )
  rpc.handle(
    'planner:exportExcel',
    async (ctx: InvokeCtx, payload: unknown): Promise<PlannerExportResult> => {
      if (!isExportPayload(payload)) return { ok: false, error: 'Invalid export payload.' }
      const name = payload.scheduleName.trim() || 'Schedule'
      if (ctx.platform.mode === 'web') {
        try {
          const data = await renderPlannerExportXlsx(payload)
          emitClientAction({
            kind: 'download',
            url: putBlob(
              data,
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              `${name}.xlsx`
            )
          })
          return { ok: true, path: `${name}.xlsx` }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
      const options: SaveDialogOptions = {
        title: 'Export schedule to Excel',
        defaultPath: join(app.getPath('downloads'), `${name}.xlsx`),
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
      }
      const filePath = await ctx.platform.showSaveDialog(options)
      if (!filePath) return { ok: false, canceled: true }
      try {
        await buildPlannerExportXlsx(payload, filePath)
        return { ok: true, path: filePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
