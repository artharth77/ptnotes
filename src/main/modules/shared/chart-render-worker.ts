import { renderChartPng, type ChartDesign } from './chart'

/**
 * Electron utility-process entry for chart rasterization. The main process
 * forks this script (see chartRenderer.ts) so that any native crash inside
 * @napi-rs/canvas (skia) kills only this worker, never the app.
 */

export interface ChartRenderRequest {
  type: 'render'
  reqId: number
  design: ChartDesign
  width?: number
  height?: number
}

const parentPort = process.parentPort

if (parentPort) {
  parentPort.on('message', (event) => {
    const msg = event.data as ChartRenderRequest | undefined
    if (!msg || typeof msg !== 'object' || msg.type !== 'render') return
    const size =
      msg.width !== undefined || msg.height !== undefined
        ? { width: msg.width, height: msg.height }
        : undefined
    try {
      const png = renderChartPng(msg.design, size)
      parentPort.postMessage({ type: 'result', reqId: msg.reqId, ok: true, png })
    } catch (err) {
      parentPort.postMessage({
        type: 'result',
        reqId: msg.reqId,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  })
}
