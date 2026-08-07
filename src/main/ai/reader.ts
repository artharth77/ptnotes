import { promises as fs } from 'fs'
import { PDFParse } from 'pdf-parse'
import type { PdfExtractResult } from '@shared/types'

export const MAX_PDF_CHARS = 240_000

const PDF_MAGIC = '%PDF-'

export type FileKind = 'text' | 'pdf' | 'unsupported'

/**
 * Classify a file by content rather than extension:
 * - starts with PDF magic bytes -> 'pdf'
 * - otherwise any other binary (NUL bytes present, not a PDF) -> 'unsupported'
 * - everything else (text, markdown, JSON, YAML, logs, etc.) -> 'text'
 */
export async function detectFileKind(path: string): Promise<FileKind> {
  const handle = await fs.open(path, 'r')
  try {
    const sample = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0)
    const buf = sample.subarray(0, bytesRead)
    if (buf.subarray(0, PDF_MAGIC.length).toString('latin1') === PDF_MAGIC) return 'pdf'
    if (buf.includes(0)) return 'unsupported'
    return 'text'
  } finally {
    await handle.close()
  }
}

export async function readFileAsText(path: string): Promise<PdfExtractResult> {
  const kind = await detectFileKind(path)
  if (kind === 'pdf') return extractPdf(path)
  if (kind === 'unsupported') {
    throw new Error('This file is a binary file that is not a PDF, so it cannot be read.')
  }
  const text = await fs.readFile(path, 'utf8')
  const truncated = text.length > MAX_PDF_CHARS
  return {
    text: truncated ? text.slice(0, MAX_PDF_CHARS) : text,
    pageCount: 0,
    charCount: text.length,
    truncated
  }
}

export async function extractPdf(path: string): Promise<PdfExtractResult> {
  const buffer = await fs.readFile(path)
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
