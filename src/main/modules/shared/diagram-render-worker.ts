import { renderMermaidPng } from './mermaid'

/**
 * Electron utility-process entry for mermaid diagram rendering. The main process
 * forks this script (see diagramRenderer.ts) so that any heavy DOM/parsing work
 * or native crash inside @resvg/resvg-js kills only this worker, never the app.
 */

export interface DiagramRenderRequest {
  type: 'render'
  reqId: number
  src: string
  pixelWidth?: number
}

export interface DiagramRenderReply {
  type: 'result'
  reqId: number
  ok: boolean
  svg?: string
  png?: Buffer
  diagramType?: string
  width?: number
  height?: number
  error?: string
}

const parentPort = process.parentPort

if (parentPort) {
  parentPort.on('message', (event) => {
    const msg = event.data as DiagramRenderRequest | undefined
    if (!msg || typeof msg !== 'object' || msg.type !== 'render') return
    renderMermaidPng(msg.src, msg.pixelWidth)
      .then((out) => {
        const reply: DiagramRenderReply = {
          type: 'result',
          reqId: msg.reqId,
          ok: true,
          svg: out.svg,
          png: out.png,
          diagramType: out.diagramType,
          width: out.width,
          height: out.height
        }
        parentPort.postMessage(reply)
      })
      .catch((err: unknown) => {
        const reply: DiagramRenderReply = {
          type: 'result',
          reqId: msg.reqId,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        }
        parentPort.postMessage(reply)
      })
  })
}
