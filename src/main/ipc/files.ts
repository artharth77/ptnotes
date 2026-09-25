import { rpc, type InvokeCtx } from '../rpc/registry'
import { promises as fs } from 'fs'
import { basename } from 'path'

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
  rpc.handle(
    'files:copyToProject',
    async (_e: InvokeCtx, project: string, sourcePath: string, fileName?: string) => {
      return service.copyFileToProject(project, sourcePath, fileName)
    }
  )

  rpc.handle(
    'files:copyBufferToProject',
    async (_e: InvokeCtx, project: string, fileName: string, data: Uint8Array) => {
      if (!(data instanceof Uint8Array)) throw new Error('Invalid upload payload.')
      return service.copyBufferToProject(project, data, fileName)
    }
  )

  rpc.handle(
    'files:importDroppedData',
    async (
      _e: InvokeCtx,
      project: string,
      destSubpath: string,
      fileName: string,
      data: Uint8Array
    ) => {
      if (!(data instanceof Uint8Array)) throw new Error('Invalid upload payload.')
      return service.importDroppedData(project, data, destSubpath, fileName)
    }
  )

  rpc.handle('files:list', async (_e: InvokeCtx, project: string) => {
    return service.listFiles(project)
  })

  rpc.handle('files:listEntries', async (_e: InvokeCtx, project: string, subpath?: string) => {
    return service.listFileEntries(project, subpath ?? '')
  })

  rpc.handle(
    'files:absPath',
    async (_e: InvokeCtx, project: string, fileName: string): Promise<string | null> => {
      return service.projectFilePath(project, fileName)
    }
  )

  rpc.handle(
    'files:readText',
    async (_e: InvokeCtx, project: string, fileName: string): Promise<string> => {
      return service.readFileText(project, fileName)
    }
  )

  rpc.handle('files:explorerList', async (_e: InvokeCtx, project: string, subpath?: string) => {
    return service.listExplorerEntries(project, subpath ?? '')
  })

  rpc.handle('files:explorerTree', async (_e: InvokeCtx, project: string) => {
    return service.listExplorerTree(project)
  })

  rpc.handle(
    'files:explorerCreateFolder',
    async (_e: InvokeCtx, project: string, parentSubpath: string, name: string) => {
      return service.createFilesFolder(project, parentSubpath, name)
    }
  )

  rpc.handle(
    'files:explorerCopy',
    async (_e: InvokeCtx, project: string, fromPaths: string[], destSubpath: string) => {
      return service.copyFilesEntries(project, fromPaths, destSubpath)
    }
  )

  rpc.handle(
    'files:explorerMove',
    async (_e: InvokeCtx, project: string, fromPaths: string[], destSubpath: string) => {
      return service.moveFilesEntries(project, fromPaths, destSubpath)
    }
  )

  rpc.handle(
    'files:explorerRename',
    async (_e: InvokeCtx, project: string, itemPath: string, newName: string) => {
      return service.renameFilesEntry(project, itemPath, newName)
    }
  )

  rpc.handle(
    'files:explorerDelete',
    async (_e: InvokeCtx, project: string, itemPaths: string[]) => {
      return service.deleteFilesEntries(project, itemPaths)
    }
  )

  rpc.handle(
    'files:importDropped',
    async (
      _e: InvokeCtx,
      project: string,
      sourcePath: string,
      destSubpath: string,
      fileName?: string
    ) => {
      return service.importDroppedFile(project, sourcePath, destSubpath, fileName)
    }
  )

  rpc.handle('files:extract', async (_e: InvokeCtx, path: string): Promise<PdfExtractResult> => {
    return readFileAsText(path)
  })

  rpc.handle('files:reveal', async (ctx: InvokeCtx, path: string): Promise<void> => {
    ctx.platform.reveal(path)
  })

  rpc.handle(
    'files:revealByName',
    async (ctx: InvokeCtx, project: string, fileName: string): Promise<void> => {
      const full = await service.projectFilePath(project, fileName)
      if (full) ctx.platform.reveal(full)
    }
  )

  rpc.handle(
    'files:openExternal',
    async (ctx: InvokeCtx, project: string, fileName: string): Promise<string> => {
      const full = await service.projectFilePath(project, fileName)
      if (!full) return 'File not found'
      return ctx.platform.openPath(full)
    }
  )

  rpc.handle('pdf:supportsUpload', async (): Promise<boolean> => {
    const config = await configStore.load()
    return config.uploadPdfEnabled ?? true
  })

  rpc.handle(
    'pdf:upload',
    async (
      event: InvokeCtx,
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

  rpc.handle(
    'pdf:info',
    async (_e: InvokeCtx, project: string, subpath: string): Promise<PdfInfo> => {
      return service.pdfInfo(project, subpath)
    }
  )

  rpc.handle(
    'pdf:renderPage',
    async (
      _e: InvokeCtx,
      project: string,
      subpath: string,
      page: number,
      rotation?: number
    ): Promise<PdfPageThumbnail> => {
      return service.pdfRenderPage(project, subpath, page, rotation)
    }
  )

  rpc.handle(
    'pdf:rebuild',
    async (
      _e: InvokeCtx,
      project: string,
      subpath: string,
      edits: PdfPageEdit[]
    ): Promise<string> => {
      return service.pdfRebuild(project, subpath, edits)
    }
  )

  rpc.handle(
    'pdf:merge',
    async (
      _e: InvokeCtx,
      project: string,
      sourceSubpaths: string[],
      destSubpath: string,
      destName?: string
    ): Promise<string> => {
      return service.pdfMerge(project, sourceSubpaths, destSubpath, destName)
    }
  )
}
