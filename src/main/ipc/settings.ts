import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'
import type { SettingsStore } from '../settings'
import type { AboutInfo, StorageSettings } from '@shared/types'

export function registerSettingsIpc(service: PTNotesService, store: SettingsStore): void {
  ipcMain.handle('settings:get', async (): Promise<StorageSettings> => store.load())

  ipcMain.handle('settings:getAbout', async (): Promise<AboutInfo> => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))

  ipcMain.handle(
    'settings:chooseRoot',
    async (event: IpcMainInvokeEvent): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        title: 'Choose project root folder',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory']
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
    }
  )

  ipcMain.handle(
    'settings:changeRoot',
    async (_e: IpcMainInvokeEvent, newRoot: string): Promise<StorageSettings> => {
      await service.changeRootDir(newRoot)
      return store.save({ rootDir: service.root })
    }
  )
}
