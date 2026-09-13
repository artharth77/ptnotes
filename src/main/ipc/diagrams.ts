import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { MermaidRenderResult } from '@shared/types'
import { renderDiagramIsolated } from '../modules/shared/diagramRenderer'

const MAX_PREVIEW_SOURCE_LENGTH = 100_000

export function registerDiagramsIpc(): void {
  ipcMain.handle(
    'diagrams:render',
    async (_e: IpcMainInvokeEvent, src: string): Promise<MermaidRenderResult> => {
      if (typeof src !== 'string' || !src.trim()) {
        return { ok: false, error: 'Diagram source is empty.' }
      }
      if (src.length > MAX_PREVIEW_SOURCE_LENGTH) {
        return { ok: false, error: 'Diagram source is too large to render.' }
      }
      try {
        const res = await renderDiagramIsolated(src)
        return {
          ok: true,
          svg: res.svg,
          diagramType: res.diagramType,
          width: res.width,
          height: res.height
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
