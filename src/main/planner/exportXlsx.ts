import { promises as fs } from 'fs'
import { dirname } from 'path'
import ExcelJS from 'exceljs'
import { statusLabel } from '@shared/planner'
import type { PlannerExportPayload, PlannerExportRow, ScheduleStatus } from '@shared/types'

const HEADER_ROW = 8
const HEADER_COL = 2
const TITLE_ROW = 2
const TITLE_COL = 3
const TITLE_FONT_SIZE = 12
const FONT_NAME = 'Calibri'
const FONT_SIZE = 11
const DATE_FMT = 'dd-mmm-yyyy'
const PERCENT_FMT = '0"%"'
const MARGIN_COL_WIDTH = 2.33
const WHITE = { argb: 'FFFFFFFF' } as const
const BLACK = { argb: 'FF000000' } as const
/** Blue, Darker 50% (accent 1 #4472C4). */
const HEADER_FILL = { argb: 'FF203864' } as const
/** Blue, Accent 5, Lighter 60% (#5B9BD5). */
const ROOT_FILL = { argb: 'FFBDD7EE' } as const
/** Green, Accent 6, Lighter 40% (#70AD47). */
const COMPLETED_FILL = { argb: 'FFA9D18E' } as const
/** Gold, Accent 4, Lighter 80% (#FFC000). */
const IN_PROGRESS_FILL = { argb: 'FFFFF2CC' } as const
/** White, Background 1, Darker 15%. */
const TABLE_BORDER_COLOR = { argb: 'FFD9D9D9' } as const

const COLUMN_WIDTHS: Record<string, number> = {
  no: 6,
  title: 40,
  status: 14,
  owner: 16,
  duration: 10,
  planStart: 12,
  planEnd: 12,
  actualStart: 12,
  actualEnd: 12,
  percent: 6,
  note: 40
}

type DateKey = 'planStart' | 'planEnd' | 'actualStart' | 'actualEnd'

const COLUMN_ALIGN: Record<string, 'center' | 'right'> = {
  no: 'right',
  status: 'center',
  owner: 'center',
  duration: 'center',
  planStart: 'center',
  planEnd: 'center',
  actualStart: 'center',
  actualEnd: 'center'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function statusFill(status: ScheduleStatus): { argb: string } | null {
  if (status === 'completed') return COMPLETED_FILL
  if (status === 'in-progress') return IN_PROGRESS_FILL
  return null
}

/** `YYYY-MM-DD` → `dd-MMM-yyyy` (e.g. `07-Sep-2026`). */
function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}

/** `YYYY-MM-DD` → Date at UTC midnight, so the cell holds a date with no time component. */
function parseDateUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1))
}

/** Sheet row numbers of the direct children of the row at index `i` (pre-order rows). */
function directChildRows(i: number, rows: PlannerExportRow[]): number[] {
  const out: number[] = []
  const depth = rows[i].depth
  for (let k = i + 1; k < rows.length; k++) {
    if (rows[k].depth <= depth) break
    if (rows[k].depth === depth + 1) out.push(HEADER_ROW + 1 + k)
  }
  return out
}

/** Cell refs for `rowNums` in column `letter`, consecutive runs compressed to ranges. */
function cellRefs(rowNums: number[], letter: string): string {
  const parts: string[] = []
  let start = rowNums[0]
  let prev = rowNums[0]
  for (let k = 1; k <= rowNums.length; k++) {
    const cur = rowNums[k]
    if (cur === prev + 1) {
      prev = cur
      continue
    }
    parts.push(start === prev ? `${letter}${start}` : `${letter}${start}:${letter}${prev}`)
    start = cur
    prev = cur
  }
  return parts.join(',')
}

function sheetNameOf(name: string): string {
  const cleaned = name
    .replace(/[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
    .trim()
  return cleaned || 'Schedule'
}

/**
 * Build the planner export workbook at `outPath`:
 * - column C title block: C2 schedule name, C3 date range, C4 overall progress (Calibri 12)
 * - header row 8 from column B (uppercase, white on Blue Darker 50%)
 * - data rows from row 9 (4-space indent per level, root-with-children light blue,
 *   bold when the row has children, status-cell accent fills)
 * - % cells of rows with children are live formulas: duration-weighted mean of the
 *   direct children (SUMPRODUCT, plain AVERAGE fallback when no child has a duration),
 *   or plain AVERAGE when the Duration column is not exported
 * - column alignment (header + data): No. right; Status/Owner/Duration/date columns center
 * - margin columns (A and the one right of the table) 2.33 wide
 * - Calibri 11 everywhere in A1..(right+1, lastRow+1); thin white borders across that
 *   whole area, replaced by thin White-Background-1-Darker-15% borders on the table.
 */
export async function buildPlannerExportXlsx(
  payload: PlannerExportPayload,
  outPath: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const ws = workbook.addWorksheet(sheetNameOf(payload.scheduleName))
  const cols = payload.columns
  const rows = payload.rows
  const tableRight = HEADER_COL + Math.max(1, cols.length) - 1
  const tableBottom = HEADER_ROW + rows.length
  const right = tableRight + 1
  const bottom = tableBottom + 1

  ws.getCell(TITLE_ROW, TITLE_COL).value = payload.scheduleName
  const starts = rows.map((r) => r.planStart).filter((v): v is string => !!v)
  const ends = rows.map((r) => r.planEnd).filter((v): v is string => !!v)
  const minStart = starts.length ? starts.reduce((a, b) => (b < a ? b : a)) : null
  const maxEnd = ends.length ? ends.reduce((a, b) => (b > a ? b : a)) : null
  const dateParts = [minStart, maxEnd].filter((v): v is string => !!v).map(formatDisplayDate)
  ws.getCell(TITLE_ROW + 1, TITLE_COL).value =
    `Date: ${dateParts.length ? dateParts.join(' - ') : '-'}`
  ws.getCell(TITLE_ROW + 2, TITLE_COL).value = `Progress: ${payload.overallPercent}%`

  cols.forEach((col, i) => {
    const cell = ws.getCell(HEADER_ROW, HEADER_COL + i)
    cell.value = col.label.toUpperCase()
    cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: WHITE }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: HEADER_FILL }
    const align = COLUMN_ALIGN[col.key]
    if (align) cell.alignment = { horizontal: align }
  })

  const durIdx = cols.findIndex((c) => c.key === 'duration')
  const durLetter = durIdx >= 0 ? ws.getColumn(HEADER_COL + durIdx).letter : ''

  rows.forEach((row, i) => {
    const r = HEADER_ROW + 1 + i
    const rowFill = row.depth === 0 && row.hasChildren ? ROOT_FILL : WHITE
    const bold = row.hasChildren
    cols.forEach((col, j) => {
      const cell = ws.getCell(r, HEADER_COL + j)
      let fill: { argb: string } = rowFill
      let value: ExcelJS.CellValue
      let numFmt: string | undefined
      switch (col.key) {
        case 'no':
          value = row.no
          break
        case 'title': {
          const title = '    '.repeat(row.depth) + row.title
          value = title || null
          break
        }
        case 'status':
          value = statusLabel(row.status)
          fill = statusFill(row.status) ?? rowFill
          break
        case 'owner':
          value = row.owner || null
          break
        case 'duration':
          value = row.duration
          break
        case 'planStart':
        case 'planEnd':
        case 'actualStart':
        case 'actualEnd': {
          const v = row[col.key as DateKey]
          value = v ? parseDateUTC(v) : null
          if (v) numFmt = DATE_FMT
          break
        }
        case 'percent': {
          numFmt = PERCENT_FMT
          const childRows = row.hasChildren ? directChildRows(i, rows) : []
          if (childRows.length > 0) {
            const pLetter = ws.getColumn(HEADER_COL + j).letter
            const pRefs = cellRefs(childRows, pLetter)
            const dRefs = cellRefs(childRows, durLetter)
            const contiguous = childRows.every((rn, k) => k === 0 || rn === childRows[k - 1] + 1)
            const weighted = durLetter
              ? contiguous
                ? `SUMPRODUCT(${dRefs},${pRefs})/SUM(${dRefs})`
                : `SUM(${childRows.map((rn) => `${durLetter}${rn}*${pLetter}${rn}`).join(',')})/SUM(${dRefs})`
              : null
            value = {
              formula: weighted
                ? `IF(SUM(${dRefs})>0,${weighted},AVERAGE(${pRefs}))`
                : `AVERAGE(${pRefs})`,
              result: row.percentComplete
            }
          } else {
            value = row.percentComplete
          }
          break
        }
        case 'note':
          value = row.note || null
          break
        default:
          value = null
      }
      cell.value = value
      cell.font = { name: FONT_NAME, size: FONT_SIZE, bold, color: BLACK }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: fill }
      if (numFmt) cell.numFmt = numFmt
      const align = COLUMN_ALIGN[col.key]
      if (align) cell.alignment = { horizontal: align }
    })
  })

  cols.forEach((col, i) => {
    const width = COLUMN_WIDTHS[col.key]
    if (width != null) ws.getColumn(HEADER_COL + i).width = width
  })
  ws.getColumn(1).width = MARGIN_COL_WIDTH
  ws.getColumn(right).width = MARGIN_COL_WIDTH

  const whiteBorder: ExcelJS.Border = { style: 'thin', color: WHITE }
  for (let r = 1; r <= bottom; r++) {
    for (let c = 1; c <= right; c++) {
      const cell = ws.getCell(r, c)
      cell.font = { ...cell.font, name: FONT_NAME, size: FONT_SIZE }
      cell.border = { top: whiteBorder, right: whiteBorder, bottom: whiteBorder, left: whiteBorder }
    }
  }

  const tableBorder: ExcelJS.Border = { style: 'thin', color: TABLE_BORDER_COLOR }
  for (let r = HEADER_ROW; r <= tableBottom; r++) {
    for (let c = HEADER_COL; c <= tableRight; c++) {
      ws.getCell(r, c).border = {
        top: tableBorder,
        right: tableBorder,
        bottom: tableBorder,
        left: tableBorder
      }
    }
  }

  for (let r = TITLE_ROW; r <= TITLE_ROW + 2; r++) {
    const cell = ws.getCell(r, TITLE_COL)
    cell.font = { ...cell.font, size: TITLE_FONT_SIZE }
  }

  await fs.mkdir(dirname(outPath), { recursive: true })
  await workbook.xlsx.writeFile(outPath)
}
