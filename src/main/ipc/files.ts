import { ipcMain, shell } from 'electron'
import { promises as fs } from 'fs'
import { basename } from 'path'
import type { IpcMainInvokeEvent } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'
import { AIConfigStore } from '../ai/config'
import { readFileAsText } from '../ai/reader'
import { chatTraceRecorder, type SessionRegistry } from './ai'
import type { PdfExtractResult, PdfInfo, PdfPageEdit, PdfPageThumbnail } from '@shared/types'

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
    'files:listEntries',
    async (_e: IpcMainInvokeEvent, project: string, subpath?: string) => {
      return service.listFileEntries(project, subpath ?? '')
    }
  )

  ipcMain.handle(
    'files:absPath',
    async (_e: IpcMainInvokeEvent, project: string, fileName: string): Promise<string | null> => {
      return service.projectFilePath(project, fileName)
    }
  )

  ipcMain.handle(
    'files:readText',
    async (_e: IpcMainInvokeEvent, project: string, fileName: string): Promise<string> => {
      return service.readFileText(project, fileName)
    }
  )

  ipcMain.handle(
    'files:explorerList',
    async (_e: IpcMainInvokeEvent, project: string, subpath?: string) => {
      return service.listExplorerEntries(project, subpath ?? '')
    }
  )

  ipcMain.handle('files:explorerTree', async (_e: IpcMainInvokeEvent, project: string) => {
    return service.listExplorerTree(project)
  })

  ipcMain.handle(
    'files:explorerCreateFolder',
    async (_e: IpcMainInvokeEvent, project: string, parentSubpath: string, name: string) => {
      return service.createFilesFolder(project, parentSubpath, name)
    }
  )

  ipcMain.handle(
    'files:explorerCopy',
    async (_e: IpcMainInvokeEvent, project: string, fromPaths: string[], destSubpath: string) => {
      return service.copyFilesEntries(project, fromPaths, destSubpath)
    }
  )

  ipcMain.handle(
    'files:explorerMove',
    async (_e: IpcMainInvokeEvent, project: string, fromPaths: string[], destSubpath: string) => {
      return service.moveFilesEntries(project, fromPaths, destSubpath)
    }
  )

  ipcMain.handle(
    'files:explorerRename',
    async (_e: IpcMainInvokeEvent, project: string, itemPath: string, newName: string) => {
      return service.renameFilesEntry(project, itemPath, newName)
    }
  )

  ipcMain.handle(
    'files:explorerDelete',
    async (_e: IpcMainInvokeEvent, project: string, itemPaths: string[]) => {
      return service.deleteFilesEntries(project, itemPaths)
    }
  )

  ipcMain.handle(
    'files:importDropped',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      sourcePath: string,
      destSubpath: string,
      fileName?: string
    ) => {
      return service.importDroppedFile(project, sourcePath, destSubpath, fileName)
    }
  )

  ipcMain.handle(
    'files:extract',
    async (_e: IpcMainInvokeEvent, path: string): Promise<PdfExtractResult> => {
      return readFileAsText(path)
    }
  )

  ipcMain.handle('files:reveal', async (_e: IpcMainInvokeEvent, path: string): Promise<void> => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle(
    'files:revealByName',
    async (_e: IpcMainInvokeEvent, project: string, fileName: string): Promise<void> => {
      const full = await service.projectFilePath(project, fileName)
      if (full) shell.showItemInFolder(full)
    }
  )

  ipcMain.handle('pdf:supportsUpload', async (): Promise<boolean> => {
    const config = await configStore.load()
    return config.uploadPdfEnabled ?? true
  })

  ipcMain.handle(
    'pdf:upload',
    async (
      event: IpcMainInvokeEvent,
      project: string,
      sessionId: string,
      path: string,
      prompt: string
    ): Promise<void> => {
      const buffer = await fs.readFile(path)
      const session = registry.getSession(event, project)
      const trace = await chatTraceRecorder(service, project, sessionId)
      await session.uploadPdf(prompt, basename(path), buffer.toString('base64'), trace)
    }
  )

  ipcMain.handle(
    'pdf:info',
    async (_e: IpcMainInvokeEvent, project: string, subpath: string): Promise<PdfInfo> => {
      return service.pdfInfo(project, subpath)
    }
  )

  ipcMain.handle(
    'pdf:renderPage',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      subpath: string,
      page: number,
      rotation?: number
    ): Promise<PdfPageThumbnail> => {
      return service.pdfRenderPage(project, subpath, page, rotation)
    }
  )

  ipcMain.handle(
    'pdf:rebuild',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      subpath: string,
      edits: PdfPageEdit[]
    ): Promise<string> => {
      return service.pdfRebuild(project, subpath, edits)
    }
  )

  ipcMain.handle(
    'pdf:merge',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      sourceSubpaths: string[],
      destSubpath: string,
      destName?: string
    ): Promise<string> => {
      return service.pdfMerge(project, sourceSubpaths, destSubpath, destName)
    }
  )
}
