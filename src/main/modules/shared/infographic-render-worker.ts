import { renderInfographicPng, type InfographicRenderArgs } from './infographic'

/**
 * Electron utility-process entry for infographic rendering. The main process
 * forks this script (see infographicRenderer.ts) so that the DOM-shimmed SSR
 * rendering and any native crash inside @resvg/resvg-js kills only this
 * worker, never the app.
 */

export interface InfographicRenderRequest {
  type: 'render'
  reqId: number
  options: InfographicRenderArgs
  pixelWidth?: number
}

export interface InfographicRenderReply {
  type: 'result'
  reqId: number
  ok: boolean
  svg?: string
  png?: Buffer
  template?: string
  width?: number
  height?: number
  error?: string
}

const parentPort = process.parentPort

if (parentPort) {
  parentPort.on('message', (event) => {
    const msg = event.data as InfographicRenderRequest | undefined
    if (!msg || typeof msg !== 'object' || msg.type !== 'render') return
    renderInfographicPng(msg.options, msg.pixelWidth)
      .then((out) => {
        const reply: InfographicRenderReply = {
          type: 'result',
          reqId: msg.reqId,
          ok: true,
          svg: out.svg,
          png: out.png,
          template: out.template,
          width: out.width,
          height: out.height
        }
        parentPort.postMessage(reply)
      })
      .catch((err: unknown) => {
        const reply: InfographicRenderReply = {
          type: 'result',
          reqId: msg.reqId,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        }
        parentPort.postMessage(reply)
      })
  })
}
