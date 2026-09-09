import { PDFDocument, degrees } from 'pdf-lib'
import type { PdfPageEdit } from '@shared/types'

const ROTATIONS = new Set([0, 90, 180, 270])

function labelFor(name: string | undefined, index: number): string {
  return name || `PDF ${index + 1}`
}

function wrapLoadError(err: unknown, name: string): Error {
  const msg = err instanceof Error ? err.message : String(err)
  if (/encrypt/i.test(msg)) {
    return new Error(`"${name}" is encrypted and cannot be modified.`)
  }
  return new Error(`"${name}" appears to be an invalid or corrupt PDF. (${msg})`)
}

async function loadPdf(buffer: Buffer, name = 'PDF'): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false })
  } catch (err) {
    throw wrapLoadError(err, name)
  }
}

/** Number of pages in a PDF buffer. */
export async function pdfPageCount(buffer: Buffer, name = 'PDF'): Promise<number> {
  const doc = await loadPdf(buffer, name)
  return doc.getPageCount()
}

function validateEdits(edits: PdfPageEdit[], pageCount: number): void {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error('No pages selected: at least one page must remain.')
  }
  const seen = new Set<number>()
  for (const edit of edits) {
    if (!Number.isInteger(edit.page) || edit.page < 1 || edit.page > pageCount) {
      throw new Error(`Page ${edit.page} is out of range: this PDF has ${pageCount} pages.`)
    }
    if (seen.has(edit.page)) {
      throw new Error(`Page ${edit.page} is listed more than once.`)
    }
    seen.add(edit.page)
    if (edit.rotation !== undefined && !ROTATIONS.has(edit.rotation)) {
      throw new Error(`Invalid rotation ${edit.rotation}: must be 0, 90, 180 or 270.`)
    }
  }
}

/**
 * Rebuild a PDF from an ordered list of page edits (reorder/delete/rotate).
 * `edits` is the final page order; source pages not listed are dropped.
 * Returns the new PDF bytes — the source buffer is never modified.
 */
export async function rebuildPdfPages(
  source: Buffer,
  edits: PdfPageEdit[],
  name = 'PDF'
): Promise<Buffer> {
  const src = await loadPdf(source, name)
  const pageCount = src.getPageCount()
  validateEdits(edits, pageCount)
  const dest = await PDFDocument.create()
  const copied = await dest.copyPages(
    src,
    edits.map((edit) => edit.page - 1)
  )
  copied.forEach((page, i) => {
    const rotation = edits[i].rotation
    if (rotation !== undefined) page.setRotation(degrees(rotation))
    dest.addPage(page)
  })
  const bytes = await dest.save({ useObjectStreams: false })
  return Buffer.from(bytes)
}

/**
 * Merge PDF buffers in array order into one new PDF.
 * Each source's internal page order is preserved.
 */
export async function mergePdfs(buffers: Buffer[], names?: string[]): Promise<Buffer> {
  if (!Array.isArray(buffers) || buffers.length === 0) {
    throw new Error('No PDFs selected: choose at least two files to merge.')
  }
  const dest = await PDFDocument.create()
  for (let i = 0; i < buffers.length; i++) {
    const src = await loadPdf(buffers[i], labelFor(names?.[i], i))
    const copied = await dest.copyPages(src, src.getPageIndices())
    copied.forEach((page) => dest.addPage(page))
  }
  const bytes = await dest.save({ useObjectStreams: false })
  return Buffer.from(bytes)
}
