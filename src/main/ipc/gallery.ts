import { rpc, type InvokeCtx } from '../rpc/registry'
import type { OpenDialogOptions } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'

export function registerGalleryIpc(service: PTNotesService): void {
  rpc.handle('gallery:list', async (_e: InvokeCtx, project: string) =>
    service.listGalleryImages(project)
  )

  rpc.handle(
    'gallery:import',
    async (_e: InvokeCtx, project: string, sourcePath: string, fileName?: string) =>
      service.importGalleryImage(project, sourcePath, fileName)
  )

  rpc.handle(
    'gallery:importData',
    async (_e: InvokeCtx, project: string, fileName: string, data: Uint8Array) =>
      service.importGalleryImageData(project, fileName, data)
  )

  rpc.handle('gallery:choose', async (ctx: InvokeCtx, project: string): Promise<string[]> => {
    const options: OpenDialogOptions = {
      title: 'Add images to gallery',
      buttonLabel: 'Add',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'] }
      ]
    }
    const paths = await ctx.platform.showOpenDialog(options)
    const names: string[] = []
    for (const path of paths) {
      try {
        names.push(await service.importGalleryImage(project, path))
      } catch {
        // skip files the gallery rejects
      }
    }
    return names
  })

  rpc.handle(
    'gallery:delete',
    async (_e: InvokeCtx, project: string, name: string): Promise<void> =>
      service.deleteGalleryImage(project, name)
  )
}
