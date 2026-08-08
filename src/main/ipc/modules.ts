import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { ModuleRunManager } from '../modules/runs'

export function registerModulesIpc(manager: ModuleRunManager): void {
  ipcMain.handle('modules:list', async (_e: IpcMainInvokeEvent, project: string) =>
    manager.list(project)
  )

  ipcMain.handle(
    'modules:stop',
    async (_e: IpcMainInvokeEvent, _project: string, runId: string) => {
      manager.stop(runId)
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
}
