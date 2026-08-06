import { promises as fs } from 'fs'
import { PDFParse } from 'pdf-parse'
import type { PdfExtractResult } from '@shared/types'

export const MAX_PDF_CHARS = 240_000

const PDF_MAGIC = '%PDF-'

export async function extractPdf(path: string): Promise<PdfExtractResult> {
  const buffer = await fs.readFile(path)
  if (buffer.slice(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
    throw new Error('The selected file is not a valid PDF')
  }
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    const text = result.text ?? ''
    const truncated = text.length > MAX_PDF_CHARS
    return {
      text: truncated ? text.slice(0, MAX_PDF_CHARS) : text,
      pageCount: result.total ?? 0,
      charCount: text.length,
      truncated
    }
  } finally {
    await parser.destroy().catch(() => {})
  }
}
