import { join } from 'path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { renderMermaidPng } from './mermaid'
import type { DiagramRenderReply, DiagramRenderRequest } from './diagram-render-worker'

/**
 * Mermaid diagram renderer that isolates mermaid parsing + jsdom/svgdom DOM
 * rendering + @resvg/resvg-js rasterization in a dedicated Electron utility
 * process. A native crash or hang only fails the in-flight render tool, never
 * the app; the worker is respawned on the next request. Falls back to
 * in-process rendering when no utility process exists (plain-Node tests).
 */

const DIAGRAM_RENDER_TIMEOUT_MS = 30_000

interface PendingRequest {
  resolve: (out: {
    svg: string
    png: Buffer
    diagramType: string
    width: number
    height: number
  }) => void
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
  return process.env.PTNOTES_DIAGRAM_WORKER || join(__dirname, 'diagram-render-worker.js')
}

function spawnWorker(): void {
  const child = utilityProcess.fork(workerScriptPath(), [], {
    serviceName: 'ptnotes-diagram-render'
  })
  worker = child
  child.on('message', (msg: unknown) => {
    const reply = msg as DiagramRenderReply
    if (!reply || reply.type !== 'result' || reply.reqId === undefined) return
    const req = pending.get(reply.reqId)
    if (!req) return
    pending.delete(reply.reqId)
    clearTimeout(req.timer)
    if (reply.ok && reply.png && reply.svg) {
      req.resolve({
        svg: reply.svg,
        png: Buffer.isBuffer(reply.png) ? reply.png : Buffer.from(reply.png),
        diagramType: reply.diagramType ?? 'unknown',
        width: reply.width ?? 0,
        height: reply.height ?? 0
      })
    } else {
      req.reject(new Error(reply.error || 'Diagram render failed with no error detail.'))
    }
  })
  child.on('exit', (code) => {
    if (worker !== child) return
    worker = null
    for (const [, req] of pending) {
      clearTimeout(req.timer)
      req.reject(
        new Error(`Diagram render worker exited unexpectedly (code ${code}). Please retry.`)
      )
    }
    pending.clear()
  })
}

function ensureWorker(): void {
  if (!worker) spawnWorker()
}

function renderViaWorker(
  src: string,
  pixelWidth?: number
): Promise<{
  svg: string
  png: Buffer
  diagramType: string
  width: number
  height: number
}> {
  ensureWorker()
  const reqId = nextReqId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const req = pending.get(reqId)
      if (!req) return
      pending.delete(reqId)
      reject(new Error('Diagram render timed out.'))
      worker?.kill()
      worker = null
    }, DIAGRAM_RENDER_TIMEOUT_MS)
    pending.set(reqId, { resolve, reject, timer })
    worker!.postMessage({
      type: 'render',
      reqId,
      src,
      pixelWidth
    } satisfies DiagramRenderRequest)
  })
}

/** Render a mermaid diagram source to SVG + PNG. Throws on worker crash/failure. */
export async function renderDiagramIsolated(
  src: string,
  pixelWidth?: number
): Promise<{
  svg: string
  png: Buffer
  diagramType: string
  width: number
  height: number
}> {
  if (!hasUtilityProcess()) {
    return renderMermaidPng(src, pixelWidth)
  }
  if (app.isReady() === false) {
    await app.whenReady()
  }
  return renderViaWorker(src, pixelWidth)
}

/** Kill the render worker (called on app quit). */
export function shutdownDiagramRenderer(): void {
  for (const [, req] of pending) {
    clearTimeout(req.timer)
    req.reject(new Error('Diagram render worker shut down.'))
  }
  pending.clear()
  if (worker) {
    worker.kill()
    worker = null
  }
}
