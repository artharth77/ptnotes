import { join } from 'path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { renderChartPng, type ChartDesign } from './chart'
import type { ChartRenderRequest } from './chart-render-worker'

/**
 * Chart renderer that isolates @napi-rs/canvas (native skia) in a dedicated
 * Electron utility process. A native segfault in the rasterizer can no longer
 * take down the app: it only fails the in-flight render and the worker is
 * respawned on the next request. Falls back to in-process rendering when no
 * utility process exists (plain-Node tests).
 */

const CHART_RENDER_TIMEOUT_MS = 60_000

interface PendingRequest {
  resolve: (png: Buffer) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

let worker: UtilityProcess | null = null
let nextReqId = 1
const pending = new Map<number, PendingRequest>()

function hasUtilityProcess(): boolean {
  try {
    return typeof utilityProcess?.fork === 'function'
  } catch {
    return false
  }
}

function workerScriptPath(): string {
  return process.env.PTNOTES_CHART_WORKER || join(__dirname, 'chart-render-worker.js')
}

function spawnWorker(): void {
  const child = utilityProcess.fork(workerScriptPath(), [], {
    serviceName: 'ptnotes-chart-render'
  })
  worker = child
  child.on('message', (msg: unknown) => {
    const reply = msg as {
      type?: string
      reqId?: number
      ok?: boolean
      png?: Buffer
      error?: string
    }
    if (!reply || reply.type !== 'result' || reply.reqId === undefined) return
    const req = pending.get(reply.reqId)
    if (!req) return
    pending.delete(reply.reqId)
    clearTimeout(req.timer)
    if (reply.ok && reply.png) {
      req.resolve(Buffer.isBuffer(reply.png) ? reply.png : Buffer.from(reply.png))
    } else {
      req.reject(new Error(reply.error || 'Chart render failed with no error detail.'))
    }
  })
  child.on('exit', (code) => {
    if (worker !== child) return
    worker = null
    for (const [, req] of pending) {
      clearTimeout(req.timer)
      req.reject(new Error(`Chart render worker exited unexpectedly (code ${code}). Please retry.`))
    }
    pending.clear()
  })
}

function ensureWorker(): void {
  if (!worker) spawnWorker()
}

function renderViaWorker(
  design: ChartDesign,
  size?: { width?: number; height?: number }
): Promise<Buffer> {
  ensureWorker()
  const reqId = nextReqId++
  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      const req = pending.get(reqId)
      if (!req) return
      pending.delete(reqId)
      reject(new Error('Chart render timed out.'))
      worker?.kill()
      worker = null
    }, CHART_RENDER_TIMEOUT_MS)
    pending.set(reqId, { resolve, reject, timer })
    worker!.postMessage({
      type: 'render',
      reqId,
      design,
      width: size?.width,
      height: size?.height
    } satisfies ChartRenderRequest)
  })
}

/** Render a validated chart design to a PNG. Throws on worker crash/failure. */
export async function renderChartIsolated(
  design: ChartDesign,
  size?: { width?: number; height?: number }
): Promise<Buffer> {
  if (!hasUtilityProcess()) {
    return renderChartPng(design, size)
  }
  if (app.isReady() === false) {
    await app.whenReady()
  }
  return renderViaWorker(design, size)
}

/** Kill the render worker (called on app quit). */
export function shutdownChartRenderer(): void {
  for (const [, req] of pending) {
    clearTimeout(req.timer)
    req.reject(new Error('Chart render worker shut down.'))
  }
  pending.clear()
  if (worker) {
    worker.kill()
    worker = null
  }
}
