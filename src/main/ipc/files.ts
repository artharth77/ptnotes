import { ipcMain, shell } from 'electron'
import { promises as fs } from 'fs'
import { basename } from 'path'
import type { IpcMainInvokeEvent } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'
import { AIConfigStore } from '../ai/config'
import { readFileAsText } from '../ai/reader'
import type { SessionRegistry } from './ai'
import type { PdfExtractResult } from '@shared/types'

export function registerFilesIpc(
  service: PTNotesService,
  registry: SessionRegistry,
  configStore: AIConfigStore
): void {
  ipcMain.handle(
    'files:copyToProject',
    async (_e: IpcMainInvokeEvent, project: string, sourcePath: string, fileName?: string) => {
      return service.copyFileToProject(project, sourcePath, fileName)
    }
  )

  ipcMain.handle('files:list', async (_e: IpcMainInvokeEvent, project: string) => {
    return service.listFiles(project)
  })

  ipcMain.handle(
    'files:extract',
    async (_e: IpcMainInvokeEvent, path: string): Promise<PdfExtractResult> => {
      return readFileAsText(path)
    }
  )

  ipcMain.handle('files:reveal', async (_e: IpcMainInvokeEvent, path: string): Promise<void> => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle('pdf:supportsUpload', async (): Promise<boolean> => {
    const config = await configStore.load()
    return config.uploadPdfEnabled ?? true
  })

  ipcMain.handle(
    'pdf:upload',
    async (
      event: IpcMainInvokeEvent,
      project: string,
      path: string,
      prompt: string
    ): Promise<void> => {
      const buffer = await fs.readFile(path)
      const session = registry.getSession(event, project)
      await session.uploadPdf(prompt, basename(path), buffer.toString('base64'))
    }
  )
}
