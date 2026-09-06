import type { PDFPageProxy } from 'pdfjs-dist'

type PdfJs = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<PdfJs> | undefined

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

const LINE_THRESHOLD = 4.6
const CELL_THRESHOLD = 7
const CELL_SEPARATOR = '\t'
const PAGE_JOINER = '\n-- page_number of total_number --'

export interface PdfTextResult {
  text: string
  total: number
}

export async function extractPdfText(data: Uint8Array, page?: number): Promise<PdfTextResult> {
  const pdfjs = await loadPdfJs()
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    verbosity: pdfjs.VerbosityLevel.ERRORS
  }).promise
  try {
    const total = doc.numPages
    const pages: { num: number; text: string }[] = []
    for (let num = 1; num <= total; num++) {
      if (page !== undefined && num !== page) continue
      const pdfPage = await doc.getPage(num)
      try {
        pages.push({ num, text: await getPageText(pdfPage) })
      } finally {
        pdfPage.cleanup()
      }
    }
    let text = ''
    for (const p of pages) {
      const marker = PAGE_JOINER.replace('page_number', `${p.num}`).replace(
        'total_number',
        `${total}`
      )
      text += `${p.text}\n${marker}\n\n`
    }
    return { text, total }
  } finally {
    await doc.destroy().catch(() => {})
  }
}

async function getPageText(page: PDFPageProxy): Promise<string> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent({
    includeMarkedContent: false,
    disableNormalization: false
  })
  const parts: string[] = []
  let lastX: number | undefined
  let lastY: number | undefined
  let lineHeight = 0
  for (const item of content.items) {
    if (!('str' in item)) continue
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
    if (lastY !== undefined && Math.abs(lastY - y) > LINE_THRESHOLD) {
      const last = parts[parts.length - 1]
      const currentHasNewline = item.str.startsWith('\n') || (item.str.trim() === '' && item.hasEOL)
      if (last?.endsWith('\n') === false && !currentHasNewline) {
        const ydiff = Math.abs(lastY - y)
        if (ydiff - 1 > lineHeight) {
          parts.push('\n')
          lineHeight = 0
        }
      }
    }
    let str = item.str
    if (lastY !== undefined && Math.abs(lastY - y) < LINE_THRESHOLD) {
      if (lastX !== undefined && Math.abs(lastX - x) > CELL_THRESHOLD) {
        str = `${CELL_SEPARATOR}${str}`
      }
    }
    parts.push(str)
    lastX = x + item.width
    lastY = y
    lineHeight = Math.max(lineHeight, item.height)
    if (item.hasEOL) parts.push('\n')
    if (item.hasEOL || item.str.endsWith('\n')) lineHeight = 0
  }
  return parts.join('')
}
