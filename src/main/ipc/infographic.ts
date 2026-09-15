import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { InfographicRenderResult } from '@shared/types'
import { renderInfographicIsolated } from '../modules/shared/infographicRenderer'
import type { InfographicRenderArgs } from '../modules/shared/infographic'

const MAX_SOURCE_LENGTH_BYTES = 256_000

export function registerInfographicIpc(): void {
  ipcMain.handle(
    'infographic:render',
    async (
      _e: IpcMainInvokeEvent,
      args: InfographicRenderArgs,
      pixelWidth?: number
    ): Promise<InfographicRenderResult> => {
      const sourceBytes = JSON.stringify(args ?? '').length
      if (sourceBytes > MAX_SOURCE_LENGTH_BYTES) {
        return {
          ok: false,
          error: `Infographic source is too large (${sourceBytes}B > ${MAX_SOURCE_LENGTH_BYTES}B).`
        }
      }
      try {
        const out = await renderInfographicIsolated(args, pixelWidth)
        return {
          ok: true,
          svg: out.svg,
          png: out.png.toString('base64'),
          template: out.template,
          width: out.width,
          height: out.height
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
