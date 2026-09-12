import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'

export function registerGalleryIpc(service: PTNotesService): void {
  ipcMain.handle('gallery:list', async (_e: IpcMainInvokeEvent, project: string) =>
    service.listGalleryImages(project)
  )

  ipcMain.handle(
    'gallery:import',
    async (_e: IpcMainInvokeEvent, project: string, sourcePath: string, fileName?: string) =>
      service.importGalleryImage(project, sourcePath, fileName)
  )

  ipcMain.handle(
    'gallery:importData',
    async (_e: IpcMainInvokeEvent, project: string, fileName: string, data: Uint8Array) =>
      service.importGalleryImageData(project, fileName, data)
  )

  ipcMain.handle(
    'gallery:choose',
    async (event: IpcMainInvokeEvent, project: string): Promise<string[]> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        title: 'Add images to gallery',
        buttonLabel: 'Add',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'] }
        ]
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      const names: string[] = []
      for (const path of result.filePaths) {
        try {
          names.push(await service.importGalleryImage(project, path))
        } catch {
          // skip files the gallery rejects
        }
      }
      return names
    }
  )

  ipcMain.handle(
    'gallery:delete',
    async (_e: IpcMainInvokeEvent, project: string, name: string): Promise<void> =>
      service.deleteGalleryImage(project, name)
  )
}
