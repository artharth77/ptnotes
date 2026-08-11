import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { ModuleRunManager } from '../modules/runs'
import type { ModuleRegistry } from '../modules/registry'
import type { SettingsStore } from '../settings'
import type { ModuleChatMessage, ModuleSettings } from '@shared/types'

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
    const disabled = new Set(settings.disabledModules ?? [])
    return registry.list().map((m) => ({
      id: m.id,
      name: m.name,
      summary: m.summary,
      enabled: !disabled.has(m.id)
    }))
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
      return registry.list().map((m) => ({
        id: m.id,
        name: m.name,
        summary: m.summary,
        enabled: !disabled.has(m.id)
      }))
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
    async (_e: IpcMainInvokeEvent, project: string, runId: string) => {
      return manager.reveal(project, runId)
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
