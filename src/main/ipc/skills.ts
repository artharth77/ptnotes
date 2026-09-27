import { rpc, type InvokeCtx } from '../rpc/registry'

import type { PTNotesService } from '../service/PTNotesService'
import type { SkillScope } from '@shared/types'

export function registerSkillsIpc(service: PTNotesService): void {
  rpc.handle('skills:list', async (_e: InvokeCtx, project: string) => service.listSkills(project))
  rpc.handle(
    'skills:read',
    async (_e: InvokeCtx, project: string, scope: SkillScope, name: string) =>
      service.readSkill(project, scope, name)
  )
  rpc.handle(
    'skills:save',
    async (
      _e: InvokeCtx,
      project: string,
      scope: SkillScope,
      name: string,
      input: { description: string; content: string; enabled?: boolean }
    ) => service.saveSkill(project, scope, name, input)
  )
  rpc.handle(
    'skills:setEnabled',
    async (_e: InvokeCtx, project: string, scope: SkillScope, name: string, enabled: boolean) =>
      service.setSkillEnabled(project, scope, name, enabled)
  )
  rpc.handle('skills:setBuiltinEnabled', async (_e: InvokeCtx, name: string, enabled: boolean) =>
    service.setBuiltinSkillEnabled(name, enabled)
  )
  rpc.handle(
    'skills:move',
    async (_e: InvokeCtx, project: string, scope: SkillScope, name: string, toScope: SkillScope) =>
      service.moveSkill(project, scope, name, toScope)
  )
  rpc.handle(
    'skills:delete',
    async (_e: InvokeCtx, project: string, scope: SkillScope, name: string) =>
      service.deleteSkill(project, scope, name)
  )
}
