import { join } from 'path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import {
  closePdfHandle,
  openPdfHandle,
  PDF_THUMBNAIL_WIDTH,
  renderPdfHandlePage,
  type PdfDocHandle
} from './pdfRenderCore'
import type { PdfWorkerRenderRequest, PdfWorkerRequest, PdfWorkerResult } from './pdf-render-worker'
import type { PdfPageThumbnail } from '@shared/types'

/**
 * PDF page renderer that isolates pdf.js + @napi-rs/canvas rasterization in a
 * dedicated Electron utility process. A native segfault in the rasterizer can
 * no longer take down the app: it only fails the in-flight render and the
 * worker is respawned on the next request. Falls back to in-process rendering
 * when no utility process exists (plain-Node tests).
 */

const OPEN_TIMEOUT_MS = 120_000
const RENDER_TIMEOUT_MS = 60_000
const MAX_OPEN_DOCS = 2
const SESSION_EXPIRED = /session expired|worker exited/i

export interface PdfRenderSession {
  pages: number
  rotations: number[]
}

interface WorkerResultData {
  pages?: number
  rotations?: number[]
  thumbnail?: PdfPageThumbnail
}

interface PendingRequest {
  resolve: (result: WorkerResultData) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

interface CachedDoc {
  data: Buffer
  handle: PdfDocHandle | null
  session: PdfRenderSession | null
  lastUsed: number
}

let worker: UtilityProcess | null = null
let nextReqId = 1
const pending = new Map<number, PendingRequest>()
const docs = new Map<string, CachedDoc>()

function hasUtilityProcess(): boolean {
  try {
    return typeof utilityProcess?.fork === 'function'
  } catch {
    return false
  }
}

function workerScriptPath(): string {
  return process.env.PTNOTES_PDF_WORKER || join(__dirname, 'pdf-render-worker.js')
}

function spawnWorker(): void {
  const child = utilityProcess.fork(workerScriptPath(), [], {
    serviceName: 'ptnotes-pdf-render'
  })
  worker = child
  child.on('message', (msg: unknown) => {
    const reply = msg as PdfWorkerResult
    if (!reply || reply.type !== 'result' || reply.reqId === undefined) return
    const req = pending.get(reply.reqId)
    if (!req) return
    pending.delete(reply.reqId)
    clearTimeout(req.timer)
    if (reply.ok) {
      req.resolve({ pages: reply.pages, rotations: reply.rotations, thumbnail: reply.thumbnail })
    } else {
      req.reject(new Error(reply.error || 'PDF render failed with no error detail.'))
    }
  })
  child.on('exit', (code) => {
    if (worker !== child) return
    worker = null
    for (const [, req] of pending) {
      clearTimeout(req.timer)
      req.reject(new Error(`PDF render worker exited unexpectedly (code ${code}). Please retry.`))
    }
    pending.clear()
    for (const [, doc] of docs) doc.session = null
  })
}

function ensureWorker(): void {
  if (!worker) spawnWorker()
}

function workerRequest(
  request: PdfWorkerRequest & { reqId: number },
  timeoutMs: number
): Promise<WorkerResultData> {
  ensureWorker()
  const reqId = request.reqId
  return new Promise<WorkerResultData>((resolve, reject) => {
    const timer = setTimeout(() => {
      const req = pending.get(reqId)
      if (!req) return
      pending.delete(reqId)
      reject(new Error('PDF render timed out.'))
      worker?.kill()
      worker = null
    }, timeoutMs)
    pending.set(reqId, { resolve, reject, timer })
    worker!.postMessage(request satisfies PdfWorkerRequest)
  })
}

function touchDoc(key: string, data?: Buffer): CachedDoc {
  let doc = docs.get(key)
  if (!doc) {
    if (!data) throw new Error('PDF session expired — reopen the document.')
    doc = { data, handle: null, session: null, lastUsed: Date.now() }
    docs.set(key, doc)
  }
  doc.lastUsed = Date.now()
  return doc
}

function evictDocs(keepKey?: string): void {
  while (docs.size > MAX_OPEN_DOCS) {
    let oldestKey: string | undefined
    for (const key of docs.keys()) {
      if (key === keepKey) continue
      if (oldestKey === undefined || docs.get(key)!.lastUsed < docs.get(oldestKey)!.lastUsed) {
        oldestKey = key
      }
    }
    if (oldestKey === undefined) break
    void closePdfRender(oldestKey)
  }
}

async function openFallback(key: string, targetWidth?: number): Promise<PdfRenderSession> {
  const doc = touchDoc(key)
  const handle = await openPdfHandle(doc.data, targetWidth)
  doc.handle = handle
  doc.session = { pages: handle.doc.numPages, rotations: handle.rotations }
  return doc.session
}

/** Open (or reuse) a PDF render session for `key`. */
export async function openPdfRender(
  key: string,
  data: Buffer,
  targetWidth = PDF_THUMBNAIL_WIDTH
): Promise<PdfRenderSession> {
  if (!hasUtilityProcess()) {
    const doc = touchDoc(key, data)
    if (doc.session) return doc.session
    return openFallback(key, targetWidth)
  }
  if (app.isReady() === false) await app.whenReady()
  const doc = touchDoc(key, data)
  if (doc.session) return doc.session
  evictDocs(key)
  const result = await workerRequest(
    { type: 'open', reqId: nextReqId++, token: key, data, targetWidth },
    OPEN_TIMEOUT_MS
  )
  if (result.pages === undefined || !result.rotations) {
    throw new Error('PDF render worker returned an incomplete result.')
  }
  doc.session = { pages: result.pages, rotations: result.rotations }
  return doc.session
}

/** Render one page of the PDF opened under `key`. */
export async function renderPdfPage(
  key: string,
  data: Buffer,
  page: number,
  rotation?: number
): Promise<PdfPageThumbnail> {
  if (!hasUtilityProcess()) {
    const doc = touchDoc(key, data)
    if (!doc.handle) await openFallback(key)
    return renderPdfHandlePage(doc.handle!, page, rotation)
  }
  if (app.isReady() === false) await app.whenReady()
  const doc = touchDoc(key, data)
  const renderOnce = async (): Promise<WorkerResultData> =>
    workerRequest(
      {
        type: 'renderPage',
        reqId: nextReqId++,
        token: key,
        page,
        rotation
      } satisfies PdfWorkerRenderRequest,
      RENDER_TIMEOUT_MS
    )
  let result: WorkerResultData
  try {
    result = await renderOnce()
  } catch (err) {
    if (!SESSION_EXPIRED.test(err instanceof Error ? err.message : String(err))) throw err
    doc.session = null
    await openPdfRender(key, doc.data)
    result = await renderOnce()
  }
  if (!result.thumbnail) throw new Error('PDF render worker returned no thumbnail.')
  return result.thumbnail
}

/** Close and forget the PDF opened under `key`. */
export async function closePdfRender(key: string): Promise<void> {
  const doc = docs.get(key)
  docs.delete(key)
  if (!doc) return
  if (hasUtilityProcess()) {
    try {
      ensureWorker()
      worker?.postMessage({ type: 'close', token: key } satisfies PdfWorkerRequest)
    } catch {
      // worker unavailable — nothing to close remotely
    }
  }
  if (doc.handle) await closePdfHandle(doc.handle)
}

/** Kill the render worker and drop all cached sessions (called on app quit). */
export function shutdownPdfRenderer(): void {
  for (const [, req] of pending) {
    clearTimeout(req.timer)
    req.reject(new Error('PDF render worker shut down.'))
  }
  pending.clear()
  for (const [, doc] of docs) {
    if (doc.handle) void closePdfHandle(doc.handle)
  }
  docs.clear()
  if (worker) {
    worker.kill()
    worker = null
  }
}
