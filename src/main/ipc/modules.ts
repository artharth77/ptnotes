import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { ModuleRunManager } from '../modules/runs'
import type { ModuleRegistry } from '../modules/registry'
import type { RegisteredModule } from '../modules/types'
import type { SettingsStore } from '../settings'
import type { ModuleChatMessage, ModuleSettings } from '@shared/types'

const MODULE_DISPLAY_ORDER = ['docx', 'pptx', 'infographic']

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
    enabled: !disabled.has(m.id)
  }))
}

export function registerModulesIpc(
  manager: ModuleRunManager,
  settingsStore: SettingsStore,
  registry: ModuleRegistry
): void {
  ipcMain.handle('modules:list', async (_e: IpcMainInvokeEvent, project: string) =>
    manager.list(project)
  )

  ipcMain.handle('modules:listAvailable', async (): Promise<ModuleSettings[]> => {
    const settings = await settingsStore.load()
    return toSettings(registry, new Set(settings.disabledModules ?? []))
  })

  ipcMain.handle(
    'modules:setEnabled',
    async (_e: IpcMainInvokeEvent, id: string, enabled: boolean): Promise<ModuleSettings[]> => {
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

  ipcMain.handle(
    'modules:stop',
    async (_e: IpcMainInvokeEvent, _project: string, runId: string) => {
      manager.stop(runId)
    }
  )

  ipcMain.handle(
    'modules:retry',
    async (_e: IpcMainInvokeEvent, project: string, runId: string) => {
      return manager.retry(project, runId)
    }
  )

  ipcMain.handle(
    'modules:reveal',
    async (_e: IpcMainInvokeEvent, project: string, runId: string, filePath?: string) => {
      return manager.reveal(project, runId, filePath)
    }
  )

  ipcMain.handle(
    'modules:clearHistory',
    async (_e: IpcMainInvokeEvent, project: string, deleteOutputFiles = false): Promise<number> => {
      return manager.clearHistory(project, deleteOutputFiles)
    }
  )

  ipcMain.handle(
    'modules:deleteRun',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      runId: string,
      deleteOutputFiles = false
    ): Promise<boolean> => {
      return manager.deleteRun(project, runId, deleteOutputFiles)
    }
  )

  ipcMain.handle(
    'modules:readChat',
    async (_e: IpcMainInvokeEvent, project: string, runId: string): Promise<ModuleChatMessage[]> =>
      manager.readChat(project, runId)
  )
}
