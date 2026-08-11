import { join } from 'path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { renderInfographicPng, type InfographicRenderArgs } from './infographic'
import type { InfographicRenderReply, InfographicRenderRequest } from './infographic-render-worker'

/**
 * Infographic renderer that isolates the @antv/infographic SSR DOM rendering
 * (linkedom) + @resvg/resvg-js rasterization in a dedicated Electron utility
 * process. A heavy render, hang or native crash only fails the in-flight
 * render tool, never the app; the worker is respawned on the next request.
 * Falls back to in-process rendering when no utility process exists
 * (plain-Node tests).
 */

const INFOGRAPHIC_RENDER_TIMEOUT_MS = 30_000

interface PendingRequest {
  resolve: (out: {
    svg: string
    png: Buffer
    template: string
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
  return process.env.PTNOTES_INFOGRAPHIC_WORKER || join(__dirname, 'infographic-render-worker.js')
}

function spawnWorker(): void {
  const child = utilityProcess.fork(workerScriptPath(), [], {
    serviceName: 'ptnotes-infographic-render'
  })
  worker = child
  child.on('message', (msg: unknown) => {
    const reply = msg as InfographicRenderReply
    if (!reply || reply.type !== 'result' || reply.reqId === undefined) return
    const req = pending.get(reply.reqId)
    if (!req) return
    pending.delete(reply.reqId)
    clearTimeout(req.timer)
    if (reply.ok && reply.png && reply.svg) {
      req.resolve({
        svg: reply.svg,
        png: Buffer.isBuffer(reply.png) ? reply.png : Buffer.from(reply.png),
        template: reply.template ?? 'unknown',
        width: reply.width ?? 0,
        height: reply.height ?? 0
      })
    } else {
      req.reject(new Error(reply.error || 'Infographic render failed with no error detail.'))
    }
  })
  child.on('exit', (code) => {
    if (worker !== child) return
    worker = null
    for (const [, req] of pending) {
      clearTimeout(req.timer)
      req.reject(
        new Error(`Infographic render worker exited unexpectedly (code ${code}). Please retry.`)
      )
    }
    pending.clear()
  })
}

function ensureWorker(): void {
  if (!worker) spawnWorker()
}

function renderViaWorker(
  options: InfographicRenderArgs,
  pixelWidth?: number
): Promise<{
  svg: string
  png: Buffer
  template: string
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
      reject(new Error('Infographic render timed out.'))
      worker?.kill()
      worker = null
    }, INFOGRAPHIC_RENDER_TIMEOUT_MS)
    pending.set(reqId, { resolve, reject, timer })
    worker!.postMessage({
      type: 'render',
      reqId,
      options,
      pixelWidth
    } satisfies InfographicRenderRequest)
  })
}

/** Render a validated infographic design to SVG + PNG. Throws on worker crash/failure. */
export async function renderInfographicIsolated(
  options: InfographicRenderArgs,
  pixelWidth?: number
): Promise<{
  svg: string
  png: Buffer
  template: string
  width: number
  height: number
}> {
  if (!hasUtilityProcess()) {
    return renderInfographicPng(options, pixelWidth)
  }
  if (app.isReady() === false) {
    await app.whenReady()
  }
  return renderViaWorker(options, pixelWidth)
}

/** Kill the render worker (called on app quit). */
export function shutdownInfographicRenderer(): void {
  for (const [, req] of pending) {
    clearTimeout(req.timer)
    req.reject(new Error('Infographic render worker shut down.'))
  }
  pending.clear()
  if (worker) {
    worker.kill()
    worker = null
  }
}
