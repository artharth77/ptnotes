import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'
import type { SkillScope } from '@shared/types'

export function registerSkillsIpc(service: PTNotesService): void {
  ipcMain.handle('skills:list', async (_e: IpcMainInvokeEvent, project: string) =>
    service.listSkills(project)
  )
  ipcMain.handle(
    'skills:read',
    async (_e: IpcMainInvokeEvent, project: string, scope: SkillScope, name: string) =>
      service.readSkill(project, scope, name)
  )
  ipcMain.handle(
    'skills:save',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      scope: SkillScope,
      name: string,
      input: { description: string; content: string; enabled?: boolean }
    ) => service.saveSkill(project, scope, name, input)
  )
  ipcMain.handle(
    'skills:setEnabled',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      scope: SkillScope,
      name: string,
      enabled: boolean
    ) => service.setSkillEnabled(project, scope, name, enabled)
  )
  ipcMain.handle(
    'skills:move',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      scope: SkillScope,
      name: string,
      toScope: SkillScope
    ) => service.moveSkill(project, scope, name, toScope)
  )
  ipcMain.handle(
    'skills:delete',
    async (_e: IpcMainInvokeEvent, project: string, scope: SkillScope, name: string) =>
      service.deleteSkill(project, scope, name)
  )
}
