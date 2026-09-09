import {
  createCanvas,
  DOMMatrix,
  ImageData,
  Path2D,
  type Canvas,
  type SKRSContext2D
} from '@napi-rs/canvas'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { PdfPageThumbnail } from '@shared/types'

export const PDF_THUMBNAIL_WIDTH = 280

type PdfJs = typeof import('pdfjs-dist')

interface CanvasAndContext {
  canvas: Canvas
  context: SKRSContext2D
}

export interface PdfDocHandle {
  doc: PDFDocumentProxy
  targetWidth: number
  rotations: number[]
}

let pdfjsPromise: Promise<PdfJs> | undefined

/**
 * Install `@napi-rs/canvas` globals BEFORE the pdf.js legacy build loads, so
 * pdf.js reuses the same native module for its DOMMatrix/Path2D polyfills
 * (and its internal temp canvases) instead of wiring up a second copy.
 */
function ensureCanvasGlobals(): void {
  const globals = globalThis as Record<string, unknown>
  if (!globals.DOMMatrix) globals.DOMMatrix = DOMMatrix
  if (!globals.ImageData) globals.ImageData = ImageData
  if (!globals.Path2D) globals.Path2D = Path2D
}

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  ])
    .then(([pdfjs, worker]) => {
      const globalWithWorker = globalThis as { pdfjsWorker?: unknown }
      globalWithWorker.pdfjsWorker = worker
      return pdfjs
    })
    .catch((error) => {
      pdfjsPromise = undefined
      throw error
    })
  return pdfjsPromise
}

const MAX_CANVAS_DIM = 16384

/**
 * pdf.js internals (mesh gradients, patterns, soft masks) request fractional
 * or degenerate canvas sizes; the default node canvas factory floors them
 * silently via `createCanvas`. Match that behavior instead of throwing —
 * `@napi-rs/canvas` turns 0/NaN/Infinity into garbage sizes, so clamp those.
 */
function saneSize(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  return Math.min(MAX_CANVAS_DIM, Math.max(1, Math.floor(raw)))
}

class NapiCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(saneSize(width), saneSize(height))
    const context = canvas.getContext('2d')
    return { canvas, context }
  }

  reset(entry: CanvasAndContext, width: number, height: number): void {
    entry.canvas.width = saneSize(width)
    entry.canvas.height = saneSize(height)
  }

  destroy(entry: CanvasAndContext): void {
    // napi garbage on width 0 — use the smallest valid size to free memory
    entry.canvas.width = 1
    entry.canvas.height = 1
  }
}

function normalizeRotation(raw: number): number {
  return (((Math.round(raw / 90) * 90) % 360) + 360) % 360
}

/** Open a PDF for page rendering; returns page count + base rotations. */
export async function openPdfHandle(
  data: Buffer,
  targetWidth = PDF_THUMBNAIL_WIDTH
): Promise<PdfDocHandle> {
  ensureCanvasGlobals()
  const pdfjs = await loadPdfJs()
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    CanvasFactory: NapiCanvasFactory
  }).promise
  const rotations: number[] = []
  try {
    for (let num = 1; num <= doc.numPages; num++) {
      const page = await doc.getPage(num)
      rotations.push(normalizeRotation(page.rotate))
      page.cleanup()
    }
  } catch (err) {
    await doc.destroy().catch(() => {})
    throw err
  }
  return { doc, targetWidth, rotations }
}

/** Close an opened PDF document (never throws). */
export async function closePdfHandle(handle: PdfDocHandle): Promise<void> {
  await handle.doc.destroy().catch(() => {})
}

function checkPage(handle: PdfDocHandle, page: number): void {
  if (!Number.isInteger(page) || page < 1 || page > handle.doc.numPages) {
    throw new Error(`Page ${page} is out of range: this PDF has ${handle.doc.numPages} pages.`)
  }
}

async function renderPage(
  handle: PdfDocHandle,
  pdfPage: PDFPageProxy,
  rotation?: number
): Promise<{ dataUrl: string; width: number; height: number; rotation: number }> {
  const rotationArg = rotation !== undefined ? { rotation } : {}
  const viewport1 = pdfPage.getViewport({ scale: 1, ...rotationArg })
  // degenerate MediaBox (zero/NaN width) → avoid scale = Infinity
  const baseWidth = Number.isFinite(viewport1.width) && viewport1.width > 0 ? viewport1.width : 1
  const scale = handle.targetWidth / baseWidth
  const viewport = pdfPage.getViewport({ scale, ...rotationArg })
  const width = saneSize(viewport.width)
  const height = saneSize(viewport.height)
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  await pdfPage.render({
    canvas: null,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
    intent: 'display'
  }).promise
  const jpeg = canvas.toBuffer('image/jpeg', 80)
  return {
    dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    width,
    height,
    rotation: normalizeRotation(viewport.rotation)
  }
}

/** Render one page of an opened PDF to a JPEG thumbnail data URL. */
export async function renderPdfHandlePage(
  handle: PdfDocHandle,
  page: number,
  rotation?: number
): Promise<PdfPageThumbnail> {
  checkPage(handle, page)
  if (rotation !== undefined && ![0, 90, 180, 270].includes(rotation)) {
    throw new Error(`Invalid rotation ${rotation}: must be 0, 90, 180 or 270.`)
  }
  const pdfPage = await handle.doc.getPage(page)
  try {
    const rendered = await renderPage(handle, pdfPage, rotation)
    return { page, ...rendered }
  } finally {
    pdfPage.cleanup()
  }
}
