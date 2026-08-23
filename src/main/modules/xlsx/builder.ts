import { promises as fs, readFileSync } from 'fs'
import ExcelJS from 'exceljs'

const MAX_ROW = 1048576
const MAX_COL = 16384
export const MAX_READ_CELLS = 20_000

export interface CellAddress {
  row: number
  col: number
}

export interface CellRange {
  tl: CellAddress
  br: CellAddress
}

function lettersToCol(letters: string): number {
  let col = 0
  for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64)
  return col
}

function colToLetters(col: number): string {
  let s = ''
  let c = col
  while (c > 0) {
    const rem = (c - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    c = Math.floor((c - 1) / 26)
  }
  return s
}

export function parseCellKey(key: string): CellAddress {
  const m = /^([A-Za-z]{1,3})([0-9]{1,7})$/.exec(String(key).trim())
  if (!m) throw new Error(`Invalid cell address "${key}". Expected e.g. "A1".`)
  const row = Number(m[2])
  const col = lettersToCol(m[1].toUpperCase())
  if (row < 1 || row > MAX_ROW || col < 1 || col > MAX_COL) {
    throw new Error(`Cell address "${key}" is out of range (max XFD${MAX_ROW}).`)
  }
  return { row, col }
}

export function cellKey(row: number, col: number): string {
  return `${colToLetters(col)}${row}`
}

export function parseRange(spec: string): CellRange {
  const raw = String(spec).trim()
  const m = /^(.+?)(?:\.\.|-)(.+)$/.exec(raw)
  if (!m || !m[1] || !m[2]) throw new Error(`Invalid range "${raw}". Use "A1..G20" or "A1-G20".`)
  const a = parseCellKey(m[1])
  const b = parseCellKey(m[2])
  return {
    tl: { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) },
    br: { row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) }
  }
}

export function formatRange(range: CellRange): string {
  return `${cellKey(range.tl.row, range.tl.col)}:${cellKey(range.br.row, range.br.col)}`
}

type XlsxCellValue = string | number | boolean | null

function normalizeCell(value: unknown): XlsxCellValue {
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

async function loadWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const buffer = await fs.readFile(path)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  return workbook
}

function pickWorksheets(workbook: ExcelJS.Workbook, sheet?: string): ExcelJS.Worksheet[] {
  const wanted = typeof sheet === 'string' ? sheet.trim() : ''
  if (!wanted) return workbook.worksheets
  const byName =
    workbook.worksheets.find((w) => w.name === wanted) ??
    workbook.worksheets.find((w) => w.name.toLowerCase() === wanted.toLowerCase())
  if (byName) return [byName]
  if (/^[0-9]+$/.test(wanted)) {
    const idx = Number(wanted)
    if (idx >= 1 && idx <= workbook.worksheets.length) return [workbook.worksheets[idx - 1]]
  }
  const names = workbook.worksheets.map((w, i) => `${i + 1}. ${w.name}`).join(', ')
  throw new Error(`Worksheet "${wanted}" not found. Available worksheets: ${names}`)
}

// ---- styles ----

export interface XlsxBorderStyleSide {
  style?: string
  width?: number
  color?: string
}

export type XlsxVerticalAlignment = 'top' | 'middle' | 'bottom' | 'distributed' | 'justify'
export type XlsxHorizontalAlignment =
  'left' | 'center' | 'right' | 'fill' | 'justify' | 'centerContinuous' | 'distributed'

export interface XlsxCellStyle {
  font?: {
    name?: string
    size?: number
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strike?: boolean
    color?: string
  }
  fill?: { pattern?: string; fgColor?: string; bgColor?: string }
  border?: Partial<Record<'top' | 'right' | 'bottom' | 'left', XlsxBorderStyleSide>>
  alignment?: {
    vertical?: XlsxVerticalAlignment
    horizontal?: XlsxHorizontalAlignment
    wrapText?: boolean
  }
  format?: string
}

const BORDER_STYLE_WIDTHS: Record<string, number> = {
  hair: 0.5,
  dotted: 1,
  dashDot: 1,
  dashDotDot: 1,
  thin: 1,
  medium: 2,
  mediumDashed: 2,
  mediumDashDot: 2,
  mediumDashDotDot: 2,
  slantDashDot: 3,
  thick: 3,
  double: 3
}

const BORDER_STYLES = new Set(Object.keys(BORDER_STYLE_WIDTHS))

function borderWidthOf(style?: string): number | undefined {
  if (!style) return undefined
  return BORDER_STYLE_WIDTHS[style] ?? 1
}

function borderStyleOfWidth(width: number): 'hair' | 'thin' | 'medium' | 'thick' {
  if (width <= 0.75) return 'hair'
  if (width <= 1.5) return 'thin'
  if (width <= 2.5) return 'medium'
  return 'thick'
}

const FILL_PATTERNS = new Set([
  'none',
  'solid',
  'darkGray',
  'mediumGray',
  'lightGray',
  'gray125',
  'gray0625',
  'darkHorizontal',
  'darkVertical',
  'darkDown',
  'darkUp',
  'darkGrid',
  'darkTrellis',
  'lightHorizontal',
  'lightVertical',
  'lightDown',
  'lightUp',
  'lightGrid',
  'lightTrellis'
])

interface ColorLike {
  argb?: string
  theme?: number
  tint?: number
  indexed?: number
}

function normalizeHexInput(input: unknown, what: string): string {
  let hex = String(input).trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(hex))
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `FF${hex.toUpperCase()}`
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return hex.toUpperCase()
  throw new Error(`${what} color "${String(input)}" must be hex like "#RRGGBB" or "AARRGGBB".`)
}

const COLOR_USAGE =
  'must be hex like "#RRGGBB"/"AARRGGBB", "theme-<0-11>" or "indexed-<0-65>", each optionally "@tint" (-1..1)'

function parseTint(raw: string, what: string): number | undefined {
  const t = Number(raw.trim().replace(/^tint[-_ :=]*/i, ''))
  if (!Number.isFinite(t) || t < -1 || t > 1) {
    throw new Error(`${what} tint "${raw}" ${COLOR_USAGE}.`)
  }
  return t === 0 ? undefined : t
}

/** Map a JSON color onto an exceljs Color. Accepts hex ("#RGB"/"#RRGGBB"/"AARRGGBB"),
 * theme/indexed palette references ("theme-4", "indexed-10", each optionally "@tint")
 * and pass-through objects ({argb|theme|indexed, tint}). */
function toExcelColor(input: unknown, what: string): ColorLike | undefined {
  if (input === undefined || input === null || input === '') return undefined
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>
    const out: ColorLike = {}
    if (typeof o.argb === 'string' && o.argb.trim()) out.argb = normalizeHexInput(o.argb, what)
    else if (typeof o.theme === 'number' && Number.isFinite(o.theme)) {
      if (o.theme < 0 || o.theme > 11 || !Number.isInteger(o.theme)) {
        throw new Error(`${what} theme index must be an integer 0-11.`)
      }
      out.theme = o.theme
    } else if (typeof o.indexed === 'number' && Number.isFinite(o.indexed)) {
      if (o.indexed < 0 || o.indexed > 65 || !Number.isInteger(o.indexed)) {
        throw new Error(`${what} indexed index must be an integer 0-65.`)
      }
      out.indexed = o.indexed
    } else return undefined
    if (typeof o.tint === 'number' && Number.isFinite(o.tint)) {
      if (o.tint < -1 || o.tint > 1) throw new Error(`${what} tint must be between -1 and 1.`)
      if (o.tint !== 0) out.tint = o.tint
    }
    return Object.keys(out).length ? out : undefined
  }
  let raw = String(input).trim()
  let tint: number | undefined
  const at = raw.indexOf('@')
  if (at !== -1) {
    tint = parseTint(raw.slice(at + 1), what)
    raw = raw.slice(0, at).trim()
  }
  let m = /^theme[-_\s:]*(\d+)$/i.exec(raw)
  if (m) {
    const n = Number(m[1])
    if (n > 11) throw new Error(`${what} "${String(input)}": theme index must be 0-11.`)
    return { theme: n, ...(tint != null ? { tint } : {}) }
  }
  m = /^indexed[-_\s:]*(\d+)$/i.exec(raw)
  if (m) {
    const n = Number(m[1])
    if (n > 65) {
      throw new Error(
        `${what} "${String(input)}": indexed index must be an integer 0-65 (64/65 are the system foreground/background markers Excel writes, e.g. as bgColor).`
      )
    }
    return { indexed: n, ...(tint != null ? { tint } : {}) }
  }
  return { argb: normalizeHexInput(raw, what), ...(tint != null ? { tint } : {}) }
}

function formatTint(tint: number): string {
  return String(Math.round(tint * 1e6) / 1e6)
}

function colorToString(color?: ColorLike | null): string | undefined {
  if (!color) return undefined
  const tint =
    typeof color.tint === 'number' && Number.isFinite(color.tint) && color.tint !== 0
      ? `@${formatTint(color.tint)}`
      : ''
  if (color.argb) return `${String(color.argb).toUpperCase()}${tint}`
  if (typeof color.theme === 'number') return `theme-${color.theme}${tint}`
  if (typeof color.indexed === 'number') return `indexed-${color.indexed}${tint}`
  return undefined
}

const VERTICALS: XlsxVerticalAlignment[] = ['top', 'middle', 'bottom', 'distributed', 'justify']
const HORIZONTALS: XlsxHorizontalAlignment[] = [
  'left',
  'center',
  'right',
  'fill',
  'justify',
  'centerContinuous',
  'distributed'
]

function isVertical(v: string): v is XlsxVerticalAlignment {
  return (VERTICALS as string[]).includes(v)
}

function isHorizontal(h: string): h is XlsxHorizontalAlignment {
  return (HORIZONTALS as string[]).includes(h)
}

function styleOfCell(cell: ExcelJS.Cell): XlsxCellStyle | undefined {
  const out: XlsxCellStyle = {}
  const f = cell.font
  if (f && typeof f === 'object') {
    const font: NonNullable<XlsxCellStyle['font']> = {}
    if (f.name) font.name = f.name
    if (typeof f.size === 'number' && Number.isFinite(f.size)) font.size = f.size
    if (f.bold) font.bold = true
    if (f.italic) font.italic = true
    if (f.underline) font.underline = true
    if (f.strike) font.strike = true
    const color = colorToString(f.color)
    if (color) font.color = color
    if (Object.keys(font).length) out.font = font
  }
  const fill = cell.fill as Partial<ExcelJS.FillPattern> | undefined
  if (
    fill &&
    fill.type === 'pattern' &&
    typeof fill.pattern === 'string' &&
    fill.pattern !== 'none'
  ) {
    const entry: NonNullable<XlsxCellStyle['fill']> = { pattern: fill.pattern }
    const fg = colorToString(fill.fgColor)
    const bg = colorToString(fill.bgColor)
    if (fg) entry.fgColor = fg
    if (bg) entry.bgColor = bg
    out.fill = entry
  }
  const b = cell.border
  if (b && typeof b === 'object') {
    const border: NonNullable<XlsxCellStyle['border']> = {}
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const spec = b[side]
      if (spec && spec.style && BORDER_STYLES.has(spec.style)) {
        border[side] = {
          style: spec.style,
          width: borderWidthOf(spec.style),
          ...(colorToString(spec.color) ? { color: colorToString(spec.color) } : {})
        }
      }
    }
    if (Object.keys(border).length) out.border = border
  }
  const al = cell.alignment
  if (al && typeof al === 'object') {
    const alignment: NonNullable<XlsxCellStyle['alignment']> = {}
    if (al.vertical && isVertical(al.vertical)) alignment.vertical = al.vertical
    if (al.horizontal && isHorizontal(al.horizontal)) alignment.horizontal = al.horizontal
    if (al.wrapText) alignment.wrapText = true
    if (Object.keys(alignment).length) out.alignment = alignment
  }
  const fmt = cell.numFmt
  if (typeof fmt === 'string' && fmt !== 'General') out.format = fmt
  else if (fmt && typeof fmt === 'object' && 'numFmt' in fmt) {
    const nf = (fmt as { numFmt?: unknown }).numFmt
    if (typeof nf === 'string' && nf !== 'General') out.format = nf
  }
  return Object.keys(out).length ? out : undefined
}

/** Map a JSON style onto an exceljs cell. Unspecified properties keep their previous values. */
export function applyCellStyle(
  cell: ExcelJS.Cell,
  style: XlsxCellStyle,
  theme?: { fontName?: string; fontSize?: number }
): void {
  cell.style = { ...cell.style }
  if (style.font || theme?.fontName || theme?.fontSize) {
    const prev = cell.font ?? {}
    const sf = style.font ?? {}
    cell.font = {
      ...prev,
      name: sf.name ?? theme?.fontName ?? prev.name,
      size: sf.size ?? theme?.fontSize ?? prev.size,
      bold: sf.bold ?? prev.bold,
      italic: sf.italic ?? prev.italic,
      underline: sf.underline ?? prev.underline,
      strike: sf.strike ?? prev.strike,
      color: toExcelColor(sf.color, 'font.color') ?? prev.color
    }
  }
  if (style.fill) {
    const pattern = style.fill.pattern || 'solid'
    if (!FILL_PATTERNS.has(pattern)) {
      throw new Error(`Unknown fill pattern "${pattern}". Valid: ${[...FILL_PATTERNS].join(', ')}.`)
    }
    cell.fill = {
      type: 'pattern',
      pattern,
      fgColor: toExcelColor(style.fill.fgColor, 'fill.fgColor'),
      bgColor: toExcelColor(style.fill.bgColor, 'fill.bgColor')
    } as ExcelJS.FillPattern
  }
  if (style.border) {
    const prev = cell.border ?? {}
    const next: Partial<Pick<ExcelJS.Borders, 'top' | 'right' | 'bottom' | 'left'>> = {}
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const spec = style.border[side]
      const existing = prev[side]
      if (!spec && !existing) continue
      if (!spec) {
        next[side] = existing
        continue
      }
      let st = spec.style
      if (!st && spec.width != null && Number.isFinite(spec.width))
        st = borderStyleOfWidth(spec.width)
      st = st ?? existing?.style ?? 'thin'
      if (!BORDER_STYLES.has(st)) {
        throw new Error(`Unknown border style "${st}". Valid: ${[...BORDER_STYLES].join(', ')}.`)
      }
      next[side] = {
        style: st as ExcelJS.Border['style'],
        color: toExcelColor(spec.color, `border.${side}.color`) ?? existing?.color
      }
    }
    cell.border = next
  }
  if (style.alignment) {
    const a = style.alignment
    if (a.vertical && !isVertical(a.vertical)) {
      throw new Error(`Unknown alignment.vertical "${a.vertical}". Valid: ${VERTICALS.join(', ')}.`)
    }
    if (a.horizontal && !isHorizontal(a.horizontal)) {
      throw new Error(
        `Unknown alignment.horizontal "${a.horizontal}". Valid: ${HORIZONTALS.join(', ')}.`
      )
    }
    cell.alignment = {
      vertical: a.vertical,
      horizontal: a.horizontal,
      wrapText: a.wrapText
    }
  }
  if (style.format) cell.numFmt = style.format
}

function mergeStyles(a: XlsxCellStyle, b: XlsxCellStyle): XlsxCellStyle {
  const border: NonNullable<XlsxCellStyle['border']> = {}
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const merged = { ...a.border?.[side], ...b.border?.[side] }
    if (Object.keys(merged).length) border[side] = merged
  }
  return {
    ...(a.font || b.font ? { font: { ...a.font, ...b.font } } : {}),
    ...(a.fill || b.fill ? { fill: { ...a.fill, ...b.fill } } : {}),
    ...(Object.keys(border).length ? { border } : {}),
    ...(a.alignment || b.alignment ? { alignment: { ...a.alignment, ...b.alignment } } : {}),
    ...((b.format ?? a.format) ? { format: b.format ?? a.format } : {})
  }
}

// ---- reading ----

export interface SheetValuesResult {
  range: string
  rowCount: number
  columnCount: number
  cells: Record<string, XlsxCellValue>
}

export interface SheetStylesResult {
  range: string
  rowCount: number
  columnCount: number
  cells: Record<string, XlsxCellStyle>
  columns: { index: number; letter: string; width: number }[]
  rows: { index: number; height: number }[]
}

export type ReadValuesResult =
  | { ok: true; sheets: Record<string, SheetValuesResult>; truncated?: boolean }
  | { ok: false; error: string }

export type ReadStylesResult =
  | { ok: true; sheets: Record<string, SheetStylesResult>; truncated?: boolean }
  | { ok: false; error: string }

export interface SheetInfo {
  index: number
  name: string
  rowCount: number
  columnCount: number
}

export async function listSheets(
  path: string
): Promise<{ ok: true; sheets: SheetInfo[] } | { ok: false; error: string }> {
  try {
    const workbook = await loadWorkbook(path)
    return {
      ok: true,
      sheets: workbook.worksheets.map((w, i) => ({
        index: i + 1,
        name: w.name,
        rowCount: w.rowCount,
        columnCount: w.columnCount
      }))
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function resolveRect(ws: ExcelJS.Worksheet, rangeSpec?: string): CellRange {
  if (rangeSpec) return parseRange(rangeSpec)
  return {
    tl: { row: 1, col: 1 },
    br: { row: Math.max(1, ws.rowCount), col: Math.max(1, ws.columnCount) }
  }
}

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

export async function readValues(
  path: string,
  sheet?: string,
  rangeSpec?: string
): Promise<ReadValuesResult> {
  try {
    if (rangeSpec) parseRange(rangeSpec)
    const workbook = await loadWorkbook(path)
    const sheets: Record<string, SheetValuesResult> = {}
    let visited = 0
    let truncated = false
    for (const ws of pickWorksheets(workbook, sheet)) {
      const rect = resolveRect(ws, rangeSpec)
      const cells: Record<string, XlsxCellValue> = {}
      let endRow = rect.tl.row
      let endCol = rect.tl.col
      outer: for (let r = rect.tl.row; r <= rect.br.row; r++) {
        for (let c = rect.tl.col; c <= rect.br.col; c++) {
          if (++visited > MAX_READ_CELLS) {
            truncated = true
            endCol = c - 1
            break outer
          }
          const v = normalizeCell(ws.getCell(r, c).value)
          if (v !== null) cells[cellKey(r, c)] = v
          endRow = r
          endCol = c
        }
      }
      sheets[ws.name] = {
        range: formatRange({ tl: rect.tl, br: { row: endRow, col: endCol } }),
        rowCount: endRow - rect.tl.row + 1,
        columnCount: endCol - rect.tl.col + 1,
        cells
      }
    }
    return truncated ? { ok: true, sheets, truncated } : { ok: true, sheets }
  } catch (err) {
    return fail(err)
  }
}

export async function readStyles(
  path: string,
  sheet?: string,
  rangeSpec?: string
): Promise<ReadStylesResult> {
  try {
    if (rangeSpec) parseRange(rangeSpec)
    const workbook = await loadWorkbook(path)
    const sheets: Record<string, SheetStylesResult> = {}
    let visited = 0
    let truncated = false
    for (const ws of pickWorksheets(workbook, sheet)) {
      const rect = resolveRect(ws, rangeSpec)
      const cells: Record<string, XlsxCellStyle> = {}
      const columns: SheetStylesResult['columns'] = []
      const rows: SheetStylesResult['rows'] = []
      outer: for (let r = rect.tl.row; r <= rect.br.row; r++) {
        for (let c = rect.tl.col; c <= rect.br.col; c++) {
          if (++visited > MAX_READ_CELLS) {
            truncated = true
            break outer
          }
          const key = cellKey(r, c)
          const style = styleOfCell(ws.getCell(r, c))
          if (style) cells[key] = style
        }
        if (truncated) break
      }
      for (let c = rect.tl.col; c <= rect.br.col; c++) {
        const width = ws.getColumn(c).width
        if (width != null) columns.push({ index: c, letter: colToLetters(c), width })
      }
      for (let r = rect.tl.row; r <= rect.br.row; r++) {
        const height = ws.getRow(r).height
        if (height != null) rows.push({ index: r, height })
      }
      sheets[ws.name] = {
        range: formatRange(rect),
        rowCount: rect.br.row - rect.tl.row + 1,
        columnCount: rect.br.col - rect.tl.col + 1,
        cells,
        columns,
        rows
      }
    }
    return truncated ? { ok: true, sheets, truncated } : { ok: true, sheets }
  } catch (err) {
    return fail(err)
  }
}

// ---- writing ----

export interface XlsxCellSpec {
  cell: string
  value?: unknown
  formula?: string
  styleRef?: string
  style?: XlsxCellStyle
}

export interface XlsxRowsSpec {
  startCell: string
  values: unknown[]
  styleRef?: string
  style?: XlsxCellStyle
}

export interface XlsxImageSpec {
  png: string
  anchor?: string
  to?: string
  widthPx?: number
  heightPx?: number
}

export interface XlsxSheetSpec {
  name: string
  templateSheet?: string
  styles?: Record<string, XlsxCellStyle>
  cells?: XlsxCellSpec[]
  rows?: XlsxRowsSpec[]
  columns?: number[]
  rowHeights?: { row: number; height: number }[]
  freeze?: string
  merges?: [string, string][]
  images?: XlsxImageSpec[]
}

export interface XlsxDesign {
  templateMode?: 'clone-layout' | 'style-source'
  theme?: { fontName?: string; fontSize?: number }
  sheets?: XlsxSheetSpec[]
}

export type XlsxTemplateMode = 'clone-layout' | 'style-source'

export interface XlsxTemplateRef {
  path: string
  mode?: XlsxTemplateMode
}

export type XlsxBuildResult =
  { ok: true; path: string; sheetCount: number; cellCount: number } | { ok: false; error: string }

interface ExtractedTemplateSheet {
  cells: [string, XlsxCellStyle][]
  widths: [number, number][]
  heights: [number, number][]
}

const LIMITS = {
  sheets: 32,
  cellsPerSheet: 20_000,
  imagesPerSheet: 64,
  templateRows: 5000,
  templateCols: 256
}

function coerceValue(v: unknown): ExcelJS.CellValue {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  switch (typeof v) {
    case 'string':
      return v.startsWith('=') ? { formula: v.slice(1) } : v
    case 'number':
    case 'boolean':
      return v
    case 'object': {
      const o = v as Record<string, unknown>
      if (typeof o.formula === 'string') return { formula: o.formula }
      break
    }
  }
  throw new Error(`Unsupported cell value: ${JSON.stringify(v)}`)
}

function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  const lower = name.trim().toLowerCase()
  return wb.worksheets.find((w) => w.name.toLowerCase() === lower)
}

function extractTemplateSheets(wb: ExcelJS.Workbook): Map<string, ExtractedTemplateSheet> {
  const map = new Map<string, ExtractedTemplateSheet>()
  for (const ws of wb.worksheets) {
    const cells: [string, XlsxCellStyle][] = []
    const widths: [number, number][] = []
    const heights: [number, number][] = []
    const maxRows = Math.min(Math.max(ws.rowCount, ws.actualRowCount), LIMITS.templateRows)
    const maxCols = Math.min(Math.max(ws.columnCount, ws.actualColumnCount), LIMITS.templateCols)
    let count = 0
    for (let r = 1; r <= maxRows; r++) {
      for (let c = 1; c <= maxCols; c++) {
        if (++count > MAX_READ_CELLS) break
        const style = styleOfCell(ws.getCell(r, c))
        if (style) cells.push([cellKey(r, c), style])
      }
      if (count > MAX_READ_CELLS) break
    }
    for (let c = 1; c <= maxCols; c++) {
      const width = ws.getColumn(c).width
      if (width != null) widths.push([c, width])
    }
    for (let r = 1; r <= maxRows; r++) {
      const height = ws.getRow(r).height
      if (height != null) heights.push([r, height])
    }
    map.set(ws.name.toLowerCase(), { cells, widths, heights })
  }
  return map
}

function applyExtracted(ws: ExcelJS.Worksheet, ex: ExtractedTemplateSheet): void {
  for (const [key, style] of ex.cells) {
    const addr = parseCellKey(key)
    applyCellStyle(ws.getCell(addr.row, addr.col), style)
  }
  for (const [col, width] of ex.widths) ws.getColumn(col).width = width
  for (const [row, height] of ex.heights) ws.getRow(row).height = height
}

/**
 * Build a real .xlsx file from a design object.
 * With `template`, either keeps the template's layout and applies the design on top
 * ("clone-layout", default) or copies the template's per-cell styles/widths/heights
 * onto a brand-new workbook ("style-source"; match by sheet name or per-sheet
 * "templateSheet").
 */
export async function buildXlsx(
  design: unknown,
  outPath: string,
  template?: XlsxTemplateRef
): Promise<XlsxBuildResult> {
  try {
    if (!design || typeof design !== 'object' || Array.isArray(design)) {
      return { ok: false, error: 'design must be a JSON object.' }
    }
    const d = design as XlsxDesign
    const specs = Array.isArray(d.sheets) ? d.sheets : []
    if (!specs.length) return { ok: false, error: 'design.sheets must contain at least one sheet.' }
    if (specs.length > LIMITS.sheets) {
      return { ok: false, error: `Too many sheets (${specs.length}); max is ${LIMITS.sheets}.` }
    }

    const mode: XlsxTemplateMode = d.templateMode ?? template?.mode ?? 'clone-layout'
    let workbook = new ExcelJS.Workbook()
    let extracted: Map<string, ExtractedTemplateSheet> | undefined
    if (template?.path) {
      const templateBook = await loadWorkbook(template.path)
      if (mode === 'clone-layout') {
        workbook = templateBook
      } else {
        extracted = extractTemplateSheets(templateBook)
      }
    }

    const theme =
      d.theme && typeof d.theme === 'object'
        ? {
            fontName:
              typeof d.theme.fontName === 'string' && d.theme.fontName.trim()
                ? d.theme.fontName.trim()
                : undefined,
            fontSize:
              typeof d.theme.fontSize === 'number' && d.theme.fontSize > 0
                ? d.theme.fontSize
                : undefined
          }
        : {}

    let cellCount = 0

    for (const spec of specs) {
      if (!spec || typeof spec !== 'object') {
        return { ok: false, error: 'each design.sheets entry must be an object.' }
      }
      const name = typeof spec.name === 'string' ? spec.name.trim() : ''
      if (!name) return { ok: false, error: 'sheet.name is required.' }

      let ws: ExcelJS.Worksheet | undefined
      if (template?.path && mode === 'clone-layout') ws = findSheet(workbook, name)
      if (!ws) ws = workbook.addWorksheet(name)

      if (extracted) {
        const sourceName = (spec.templateSheet ?? name).toLowerCase()
        const ex = extracted.get(sourceName)
        if (ex) applyExtracted(ws, ex)
      }

      if (Array.isArray(spec.cells) && spec.cells.length > LIMITS.cellsPerSheet) {
        return {
          ok: false,
          error: `Sheet "${name}": too many cells (${spec.cells.length}); max ${LIMITS.cellsPerSheet}.`
        }
      }

      for (const rs of Array.isArray(spec.rows) ? spec.rows : []) {
        if (!rs || !Array.isArray(rs.values)) {
          return {
            ok: false,
            error: `Sheet "${name}": each rows entry needs "startCell" and "values".`
          }
        }
        const start = parseCellKey(String(rs.startCell))
        if (start.col - 1 + rs.values.length > MAX_COL) {
          return {
            ok: false,
            error: `Sheet "${name}": row starting at ${rs.startCell} overflows past column XFD.`
          }
        }
        let rowStyle: XlsxCellStyle | undefined
        if (rs.styleRef) {
          const named = spec.styles?.[rs.styleRef]
          if (!named) {
            const known = Object.keys(spec.styles ?? {})
            return {
              ok: false,
              error: `Sheet "${name}": unknown styleRef "${rs.styleRef}". Defined styles: ${
                known.join(', ') || '(none)'
              }.`
            }
          }
          rowStyle = rs.style ? mergeStyles(named, rs.style) : named
        } else {
          rowStyle = rs.style
        }
        rs.values.forEach((v, i) => {
          const target = ws!.getCell(start.row, start.col + i)
          target.value = coerceValue(v)
          if (rowStyle) applyCellStyle(target, rowStyle, theme)
          cellCount++
        })
      }

      for (const cs of Array.isArray(spec.cells) ? spec.cells : []) {
        if (!cs || typeof cs.cell !== 'string') {
          return { ok: false, error: `Sheet "${name}": each cells entry needs a "cell" address.` }
        }
        const addr = parseCellKey(cs.cell)
        const target = ws.getCell(addr.row, addr.col)
        if (cs.formula !== undefined && cs.formula !== null) {
          target.value = { formula: String(cs.formula) }
        } else if (cs.value !== undefined) {
          target.value = coerceValue(cs.value)
        }
        let style: XlsxCellStyle | undefined
        if (cs.styleRef) {
          const named = spec.styles?.[cs.styleRef]
          if (!named) {
            const known = Object.keys(spec.styles ?? {})
            return {
              ok: false,
              error: `Sheet "${name}": unknown styleRef "${cs.styleRef}". Defined styles: ${
                known.join(', ') || '(none)'
              }.`
            }
          }
          style = cs.style ? mergeStyles(named, cs.style) : named
        } else {
          style = cs.style
        }
        if (style) applyCellStyle(target, style, theme)
        cellCount++
      }

      for (const merge of Array.isArray(spec.merges) ? spec.merges : []) {
        if (!Array.isArray(merge) || merge.length !== 2) {
          return { ok: false, error: `Sheet "${name}": merges entries must be [fromCell, toCell].` }
        }
        const a = parseCellKey(String(merge[0]))
        const b = parseCellKey(String(merge[1]))
        ws.mergeCells(
          cellKey(Math.min(a.row, b.row), Math.min(a.col, b.col)),
          cellKey(Math.max(a.row, b.row), Math.max(a.col, b.col))
        )
      }

      if (Array.isArray(spec.columns)) {
        spec.columns.forEach((w, i) => {
          if (typeof w === 'number' && Number.isFinite(w) && w > 0) {
            if (i + 1 > MAX_COL) return
            ws!.getColumn(i + 1).width = Math.min(w, 255)
          }
        })
      }
      for (const rh of Array.isArray(spec.rowHeights) ? spec.rowHeights : []) {
        if (rh && typeof rh.row === 'number' && typeof rh.height === 'number' && rh.height > 0) {
          ws.getRow(rh.row).height = Math.min(rh.height, 409)
        }
      }
      if (spec.freeze) {
        const f = parseCellKey(spec.freeze)
        ws.views = [{ state: 'frozen', xSplit: f.col - 1, ySplit: f.row - 1 }]
      }

      for (const img of Array.isArray(spec.images)
        ? spec.images.slice(0, LIMITS.imagesPerSheet)
        : []) {
        if (!img || typeof img.png !== 'string' || !img.png.trim()) {
          return { ok: false, error: `Sheet "${name}": image entries need a "png" path.` }
        }
        const extMatch = /\.(png|jpe?g|gif)$/i.exec(img.png)
        if (!extMatch) {
          return {
            ok: false,
            error: `Sheet "${name}": image "${img.png}" must be a .png, .jpg/.jpeg or .gif file.`
          }
        }
        const ext = extMatch[1].toLowerCase()
        const extension = ext === 'jpg' ? 'jpeg' : ext
        const imageId = workbook.addImage({
          base64: readFileSync(img.png).toString('base64'),
          extension: extension as 'png' | 'jpeg' | 'gif'
        })
        const anchor = img.anchor ? parseCellKey(img.anchor) : { row: 1, col: 1 }
        if (img.to) {
          const to = parseCellKey(img.to)
          ws.addImage(imageId, `${cellKey(anchor.row, anchor.col)}:${cellKey(to.row, to.col)}`)
        } else if (img.widthPx != null || img.heightPx != null) {
          ws.addImage(imageId, {
            tl: { col: anchor.col - 1, row: anchor.row - 1 },
            ext: {
              width: typeof img.widthPx === 'number' ? img.widthPx : 400,
              height: typeof img.heightPx === 'number' ? img.heightPx : 300
            }
          })
        } else {
          ws.addImage(imageId, cellKey(anchor.row, anchor.col))
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    await fs.writeFile(outPath, new Uint8Array(buffer))
    return { ok: true, path: outPath, sheetCount: specs.length, cellCount }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---- editing ----

interface EditOperation {
  type: string
  [key: string]: unknown
}

export async function editXlsx(
  path: string,
  sheet: string | undefined,
  operations: unknown[]
): Promise<{ ok: true; path: string; applied: number } | { ok: false; error: string }> {
  try {
    if (!Array.isArray(operations) || operations.length === 0) {
      return { ok: false, error: 'operations must be a non-empty array.' }
    }
    const workbook = await loadWorkbook(path)
    const targets = pickWorksheets(workbook, sheet)
    const ws = targets[0]
    if (!ws) return { ok: false, error: `Worksheet not found.` }

    let applied = 0
    for (const raw of operations) {
      const op = raw as EditOperation
      if (!op || typeof op !== 'object') {
        return { ok: false, error: `Each operation must be an object.` }
      }
      const type = String(op.type ?? '').trim()
      switch (type) {
        case 'set_cells': {
          if (typeof op.startCell !== 'string' || !op.startCell.trim()) {
            return { ok: false, error: 'set_cells requires a "startCell" address.' }
          }
          if (!Array.isArray(op.values)) {
            return { ok: false, error: 'set_cells requires a "values" array.' }
          }
          const start = parseCellKey(op.startCell)
          const values = op.values as unknown[]
          const styles = Array.isArray(op.styles) ? (op.styles as unknown[]) : []
          values.forEach((v, i) => {
            const cell = ws.getCell(start.row, start.col + i)
            cell.value = coerceValue(v)
            if (i < styles.length && styles[i] && typeof styles[i] === 'object') {
              applyCellStyle(cell, styles[i] as XlsxCellStyle)
            }
            applied++
          })
          break
        }
        case 'insert_rows': {
          const at = Number(op.at)
          if (!Number.isFinite(at) || at < 1) {
            return { ok: false, error: 'insert_rows "at" must be a positive integer.' }
          }
          const count = Math.max(1, Math.round(Number(op.count) || 1))
          ws.spliceRows(at, count)
          applied += count
          break
        }
        case 'delete_rows': {
          const at = Number(op.at)
          if (!Number.isFinite(at) || at < 1) {
            return { ok: false, error: 'delete_rows "at" must be a positive integer.' }
          }
          const count = Math.max(1, Math.round(Number(op.count) || 1))
          ws.spliceRows(at, count)
          applied += count
          break
        }
        case 'insert_columns': {
          const at = Number(op.at)
          if (!Number.isFinite(at) || at < 1) {
            return { ok: false, error: 'insert_columns "at" must be a positive integer.' }
          }
          const count = Math.max(1, Math.round(Number(op.count) || 1))
          ws.spliceColumns(at, count)
          applied += count
          break
        }
        case 'delete_columns': {
          const at = Number(op.at)
          if (!Number.isFinite(at) || at < 1) {
            return { ok: false, error: 'delete_columns "at" must be a positive integer.' }
          }
          const count = Math.max(1, Math.round(Number(op.count) || 1))
          ws.spliceColumns(at, count)
          applied += count
          break
        }
        default:
          return { ok: false, error: `Unknown operation type "${type}".` }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    await fs.writeFile(path, new Uint8Array(buffer))
    return { ok: true, path, applied }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Collect every picture PNG path referenced anywhere in a design (for temp-file cleanup). */
export function collectImagePaths(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectImagePaths(v, out)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'png' && typeof v === 'string' && v.trim()) out.push(v.trim())
      else collectImagePaths(v, out)
    }
  }
  return out
}
