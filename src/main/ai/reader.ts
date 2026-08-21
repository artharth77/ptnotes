import { promises as fs } from 'fs'
import { extname } from 'path'
import { PDFParse } from 'pdf-parse'
import ExcelJS from 'exceljs'
import type { PdfExtractResult } from '@shared/types'

export const MAX_PDF_CHARS = 240_000

const PDF_MAGIC = '%PDF-'
const ZIP_MAGIC = 'PK\x03\x04'

export type FileKind = 'text' | 'pdf' | 'excel' | 'unsupported'

/**
 * Classify a file by content rather than extension:
 * - starts with PDF magic bytes -> 'pdf'
 * - starts with ZIP magic bytes + excel extension -> 'excel'
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
    if (buf.subarray(0, ZIP_MAGIC.length).toString('latin1') === ZIP_MAGIC) {
      const ext = extname(path).toLowerCase()
      if (ext === '.xlsx' || ext === '.xlsm') return 'excel'
    }
    if (buf.includes(0)) return 'unsupported'
    return 'text'
  } finally {
    await handle.close()
  }
}

export async function readFileAsText(
  path: string,
  format: 'json' | 'csv' = 'json',
  query?: ExcelQuery
): Promise<PdfExtractResult> {
  const kind = await detectFileKind(path)
  if (query && kind !== 'excel') {
    throw new Error('The query parameter is only supported for Excel workbooks (.xlsx/.xlsm).')
  }
  if (kind === 'pdf') return extractPdf(path)
  if (kind === 'excel') return extractExcel(path, format, query)
  if (kind === 'unsupported') {
    throw new Error(
      'This file is a binary file that is not a PDF or Excel workbook, so it cannot be read.'
    )
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

type CellValue = string | number | boolean | null

function normalizeCell(value: unknown): CellValue {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return normalizeCell((value as { result: unknown }).result)
    if ('richText' in value) {
      return (value as { richText: { text?: string }[] }).richText
        .map((rt) => rt.text ?? '')
        .join('')
    }
    if ('text' in value) return normalizeCell((value as { text: unknown }).text)
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value
  return null
}

function quoteCsv(val: CellValue): string {
  const s = val === null ? '' : String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export interface ExcelQuery {
  workspace?: string
  list?: 'workspace'
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Parse a read_file `query` value ("var=value&var=value", URL-encoded values are
 * decoded). Supported variables: `workspace` (worksheet name or 1-based number)
 * and `list=workspace` (return the worksheet index/name list instead of content).
 * Throws on unknown variables, invalid values, or an empty query. */
export function parseWorkbookQuery(query: string): ExcelQuery {
  const result: ExcelQuery = {}
  let sawPair = false
  for (const part of query.split('&')) {
    if (!part) continue
    sawPair = true
    const eq = part.indexOf('=')
    const key = safeDecode(eq === -1 ? part : part.slice(0, eq)).trim()
    const value = safeDecode(eq === -1 ? '' : part.slice(eq + 1)).trim()
    if (!key) throw new Error('Malformed query: expected "var=value" pairs.')
    if (!value) throw new Error(`Query variable "${key}" requires a value.`)
    if (key === 'workspace') result.workspace = value
    else if (key === 'list') {
      if (value !== 'workspace') {
        throw new Error(`Unsupported value "${value}" for variable "list". Supported: workspace.`)
      }
      result.list = 'workspace'
    } else {
      throw new Error(`Unsupported query variable "${key}". Supported variables: list, workspace.`)
    }
  }
  if (!sawPair) throw new Error('Empty query. Supported variables: list, workspace.')
  if (result.list && result.workspace) {
    throw new Error('Use either "list=workspace" or "workspace=<name|n>", not both.')
  }
  return result
}

interface WorksheetInfo {
  index: number
  name: string
}

function pickWorksheets(worksheets: ExcelJS.Worksheet[], workspace?: string): ExcelJS.Worksheet[] {
  if (!workspace) return worksheets
  const byName =
    worksheets.find((w) => w.name === workspace) ??
    worksheets.find((w) => w.name.toLowerCase() === workspace.toLowerCase())
  if (byName) return [byName]
  if (/^\d+$/.test(workspace)) {
    const idx = Number(workspace)
    if (idx >= 1 && idx <= worksheets.length) return [worksheets[idx - 1]]
  }
  const names = worksheets.map((w, i) => `${i + 1}. ${w.name}`).join(', ')
  throw new Error(`Worksheet "${workspace}" not found. Available worksheets: ${names}`)
}

export async function extractExcel(
  path: string,
  format: 'json' | 'csv',
  query?: ExcelQuery
): Promise<PdfExtractResult> {
  const buffer = await fs.readFile(path)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])

  if (query?.list === 'workspace') {
    const list: WorksheetInfo[] = workbook.worksheets.map((w, i) => ({
      index: i + 1,
      name: w.name
    }))
    return finishExtract(JSON.stringify(list))
  }

  const worksheets = pickWorksheets(workbook.worksheets, query?.workspace)

  const sheetsData: Record<string, Record<string, CellValue>[]> = {}

  for (const worksheet of worksheets) {
    const values: CellValue[][] = []
    const colCount = worksheet.columnCount
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const rowValues: CellValue[] = []
      for (let c = 1; c <= colCount; c++) {
        rowValues.push(normalizeCell(row.getCell(c).value))
      }
      values.push(rowValues)
    })
    if (values.length === 0) continue

    const headers = values[0].map((v) => (v === null ? '' : String(v)))
    const rows: Record<string, CellValue>[] = []
    for (let i = 1; i < values.length; i++) {
      const obj: Record<string, CellValue> = {}
      headers.forEach((h, idx) => {
        obj[h || `Column${idx + 1}`] = values[i][idx] ?? null
      })
      rows.push(obj)
    }
    sheetsData[worksheet.name] = rows
  }

  let text: string
  if (format === 'json') {
    text = JSON.stringify(sheetsData)
  } else {
    const parts: string[] = []
    for (const [sheetName, sheetRows] of Object.entries(sheetsData)) {
      parts.push(`## Sheet: ${sheetName}`)
      if (sheetRows.length === 0) continue
      const cols = Object.keys(sheetRows[0])
      parts.push(cols.map((h) => quoteCsv(h)).join(','))
      for (const row of sheetRows) {
        parts.push(cols.map((h) => quoteCsv(row[h])).join(','))
      }
    }
    text = parts.join('\n')
  }

  return finishExtract(text)
}

function finishExtract(text: string): PdfExtractResult {
  const truncated = text.length > MAX_PDF_CHARS
  return {
    text: truncated ? text.slice(0, MAX_PDF_CHARS) : text,
    pageCount: 0,
    charCount: text.length,
    truncated
  }
}
