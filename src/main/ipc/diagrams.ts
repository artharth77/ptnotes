import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent, SaveDialogOptions } from 'electron'
import { dialog, BrowserWindow, app } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { DiagramSaveResult, MermaidRenderResult } from '@shared/types'
import { renderDiagramIsolated } from '../modules/shared/diagramRenderer'

const MAX_PREVIEW_SOURCE_LENGTH = 100_000
const MAX_SAVE_DATA_LENGTH = 20_000_000

interface DiagramSavePayload {
  name: string
  data: Uint8Array
  format: 'png' | 'svg'
}

function isDiagramSavePayload(payload: unknown): payload is DiagramSavePayload {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as Record<string, unknown>
  if (typeof p.name !== 'string' || !p.name.trim()) return false
  if (p.format !== 'png' && p.format !== 'svg') return false
  return (
    p.data instanceof Uint8Array &&
    p.data.byteLength > 0 &&
    p.data.byteLength <= MAX_SAVE_DATA_LENGTH
  )
}

const SAVE_EXTENSIONS: Record<DiagramSavePayload['format'], string> = {
  png: 'png',
  svg: 'svg'
}

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
  ipcMain.handle(
    'diagrams:save',
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<DiagramSaveResult> => {
      if (!isDiagramSavePayload(payload))
        return { ok: false, error: 'Invalid diagram save payload.' }
      const format = payload.format
      const name = `${payload.name.trim().replace(/\.(png|svg)$/i, '')}.${SAVE_EXTENSIONS[format]}`
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: SaveDialogOptions = {
        title: format === 'png' ? 'Save diagram as PNG' : 'Save diagram as SVG',
        defaultPath: join(app.getPath('downloads'), name),
        filters:
          format === 'png'
            ? [{ name: 'PNG Image', extensions: ['png'] }]
            : [{ name: 'SVG Image', extensions: ['svg'] }]
      }
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      try {
        await writeFile(result.filePath, payload.data)
        return { ok: true, path: result.filePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
