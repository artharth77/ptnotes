import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'
import type { ProjectCalendar, Schedule } from '@shared/types'

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
}
