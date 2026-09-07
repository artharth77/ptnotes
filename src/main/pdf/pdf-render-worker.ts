import {
  closePdfHandle,
  openPdfHandle,
  renderPdfHandlePage,
  type PdfDocHandle
} from './pdfRenderCore'
import type { PdfPageThumbnail } from '@shared/types'

/**
 * Electron utility-process entry for PDF page rasterization. The main process
 * forks this script (see pdfRenderer.ts) so that heavy pdf.js rendering or a
 * native crash inside @napi-rs/canvas kills only this worker, never the app.
 */

export interface PdfWorkerOpenRequest {
  type: 'open'
  reqId: number
  token: string
  data: Buffer
  targetWidth?: number
}

export interface PdfWorkerRenderRequest {
  type: 'renderPage'
  reqId: number
  token: string
  page: number
  rotation?: number
}

export interface PdfWorkerCloseRequest {
  type: 'close'
  token: string
}

export type PdfWorkerRequest = PdfWorkerOpenRequest | PdfWorkerRenderRequest | PdfWorkerCloseRequest

export interface PdfWorkerResult {
  type: 'result'
  reqId?: number
  ok: boolean
  pages?: number
  rotations?: number[]
  thumbnail?: PdfPageThumbnail
  error?: string
}

const MAX_OPEN_DOCS = 2
const docs = new Map<string, PdfDocHandle>()

function post(msg: PdfWorkerResult): void {
  process.parentPort?.postMessage(msg)
}

function evictDocs(): void {
  while (docs.size >= MAX_OPEN_DOCS) {
    const oldest = docs.keys().next().value
    if (oldest === undefined) break
    const handle = docs.get(oldest)
    docs.delete(oldest)
    if (handle) void closePdfHandle(handle)
  }
}

async function handleOpen(req: PdfWorkerOpenRequest): Promise<void> {
  const previous = docs.get(req.token)
  if (previous) {
    docs.delete(req.token)
    await closePdfHandle(previous)
  }
  evictDocs()
  const handle = await openPdfHandle(req.data, req.targetWidth)
  docs.set(req.token, handle)
  post({
    type: 'result',
    reqId: req.reqId,
    ok: true,
    pages: handle.doc.numPages,
    rotations: handle.rotations
  })
}

async function handleRender(req: PdfWorkerRenderRequest): Promise<void> {
  const handle = docs.get(req.token)
  if (!handle) throw new Error('PDF session expired — reopen the document.')
  const thumbnail = await renderPdfHandlePage(handle, req.page, req.rotation)
  post({ type: 'result', reqId: req.reqId, ok: true, thumbnail })
}

const parentPort = process.parentPort

if (parentPort) {
  parentPort.on('message', (event) => {
    const msg = event.data as PdfWorkerRequest | undefined
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'close') {
      const handle = docs.get(msg.token)
      docs.delete(msg.token)
      if (handle) void closePdfHandle(handle)
      return
    }
    void (async () => {
      try {
        if (msg.type === 'open') await handleOpen(msg)
        else if (msg.type === 'renderPage') await handleRender(msg)
      } catch (err) {
        post({
          type: 'result',
          reqId: msg.reqId,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })()
  })
}
