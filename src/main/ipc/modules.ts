import { rpc, type InvokeCtx } from '../rpc/registry'

import type { ModuleRunManager } from '../modules/runs'
import type { ModuleRegistry } from '../modules/registry'
import type { RegisteredModule } from '../modules/types'
import type { SettingsStore } from '../settings'
import type { AiTraceFile, ModuleChatMessage, ModuleSettings } from '@shared/types'

const MODULE_DISPLAY_ORDER = ['subagent', 'docx', 'xlsx', 'pptx', 'infographic']

/** Sort modules for the Settings ▸ Modules list (known ids first, unknowns after in registry order). */
function orderedModules(registry: ModuleRegistry): RegisteredModule[] {
  return [...registry.list()].sort((a, b) => {
    const ia = MODULE_DISPLAY_ORDER.indexOf(a.id)
    const ib = MODULE_DISPLAY_ORDER.indexOf(b.id)
    return (
      (ia === -1 ? MODULE_DISPLAY_ORDER.length : ia) -
      (ib === -1 ? MODULE_DISPLAY_ORDER.length : ib)
    )
  })
}

function toSettings(registry: ModuleRegistry, disabled: Set<string>): ModuleSettings[] {
  return orderedModules(registry).map((m) => ({
    id: m.id,
    name: m.name,
    summary: m.summary,
    enabled: !disabled.has(m.id),
    ...(m.link ? { link: m.link } : {})
  }))
}

export function registerModulesIpc(
  manager: ModuleRunManager,
  settingsStore: SettingsStore,
  registry: ModuleRegistry
): void {
  rpc.handle('modules:list', async (_e: InvokeCtx, project: string) => manager.list(project))

  rpc.handle('modules:listAvailable', async (): Promise<ModuleSettings[]> => {
    const settings = await settingsStore.load()
    return toSettings(registry, new Set(settings.disabledModules ?? []))
  })

  rpc.handle(
    'modules:setEnabled',
    async (_e: InvokeCtx, id: string, enabled: boolean): Promise<ModuleSettings[]> => {
      const settings = await settingsStore.load()
      const disabled = new Set(settings.disabledModules ?? [])
      if (enabled) {
        disabled.delete(id)
      } else {
        disabled.add(id)
      }
      await settingsStore.save({ ...settings, disabledModules: [...disabled] })
      return toSettings(registry, disabled)
    }
  )

  rpc.handle('modules:stop', async (_e: InvokeCtx, _project: string, runId: string) => {
    manager.stop(runId)
  })

  rpc.handle('modules:retry', async (_e: InvokeCtx, project: string, runId: string) => {
    return manager.retry(project, runId)
  })

  rpc.handle(
    'modules:reveal',
    async (_e: InvokeCtx, project: string, runId: string, filePath?: string) => {
      return manager.reveal(project, runId, filePath)
    }
  )

  rpc.handle(
    'modules:clearHistory',
    async (_e: InvokeCtx, project: string, deleteOutputFiles = false): Promise<number> => {
      return manager.clearHistory(project, deleteOutputFiles)
    }
  )

  rpc.handle(
    'modules:deleteRun',
    async (
      _e: InvokeCtx,
      project: string,
      runId: string,
      deleteOutputFiles = false
    ): Promise<boolean> => {
      return manager.deleteRun(project, runId, deleteOutputFiles)
    }
  )

  rpc.handle(
    'modules:readChat',
    async (_e: InvokeCtx, project: string, runId: string): Promise<ModuleChatMessage[]> =>
      manager.readChat(project, runId)
  )

  rpc.handle(
    'modules:readTrace',
    async (_e: InvokeCtx, project: string, runId: string): Promise<AiTraceFile | null> =>
      manager.readTrace(project, runId)
  )
}
