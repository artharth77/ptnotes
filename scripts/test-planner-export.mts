import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const OUT = '/tmp/ptnotes-planner-export-test.xlsx'
const OUT2 = '/tmp/ptnotes-planner-export-test-2.xlsx'
const OUT3 = '/tmp/ptnotes-planner-export-test-3.xlsx'
const OUT4 = '/tmp/ptnotes-planner-export-test-4.xlsx'

const { overallPercentComplete, statusLabel } = await import('../src/shared/planner')
const { buildPlannerExportXlsx } = await import('../src/main/planner/exportXlsx')
const { readValues, readStyles } = await import('../src/main/modules/xlsx/builder')
import type { PlannerExportPayload, ScheduleTask } from '../src/shared/types'

// ---- shared helpers ----

assert.equal(statusLabel('not-started'), 'Not Started')
assert.equal(statusLabel('in-progress'), 'In Progress')
assert.equal(statusLabel('completed'), 'Completed')
assert.equal(statusLabel('pending'), 'Pending')
assert.equal(statusLabel('on-hold'), 'On Hold')

const mkTask = (over: Partial<ScheduleTask>): ScheduleTask => ({
  id: crypto.randomUUID(),
  title: '',
  status: 'not-started',
  owner: '',
  duration: null,
  planStart: null,
  planEnd: null,
  actualStart: null,
  actualEnd: null,
  percentComplete: 0,
  note: '',
  children: [],
  ...over
})

assert.equal(overallPercentComplete([]), 0, 'empty schedule is 0%')
assert.equal(
  overallPercentComplete([
    mkTask({ duration: 10, percentComplete: 100 }),
    mkTask({ duration: 10, percentComplete: 0 })
  ]),
  50,
  'duration-weighted mean across top-level tasks'
)
assert.equal(
  overallPercentComplete([
    mkTask({ duration: 3, percentComplete: 100 }),
    mkTask({ duration: 1, percentComplete: 0 })
  ]),
  75,
  'weights follow duration'
)
assert.equal(
  overallPercentComplete([mkTask({ percentComplete: 10 }), mkTask({ percentComplete: 20 })]),
  15,
  'plain mean when no durations'
)

// ---- workbook build + read back ----

await fs.rm(OUT, { force: true })
await fs.rm(OUT2, { force: true })
await fs.rm(OUT3, { force: true })
await fs.rm(OUT4, { force: true })

const payload: PlannerExportPayload = {
  scheduleName: 'Roadmap',
  overallPercent: 55,
  calendar: { weekStart: 1, weekEnd: 5, holidays: [] },
  progressDate: '2026-09-14',
  progressMode: 'percent-plan',
  planPercent: 60,
  ganttMode: 'day',
  columns: [
    { key: 'no', label: 'No.' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { key: 'owner', label: 'Owner' },
    { key: 'duration', label: 'Duration' },
    { key: 'planStart', label: 'Plan Start' },
    { key: 'planEnd', label: 'Plan End' },
    { key: 'percent', label: '%' },
    { key: 'note', label: 'Note' }
  ],
  rows: [
    {
      no: '1',
      title: 'Root',
      status: 'in-progress',
      owner: 'Alice',
      duration: 10,
      planStart: '2026-09-07',
      planEnd: '2026-09-18',
      actualStart: null,
      actualEnd: null,
      percentComplete: 50,
      note: '',
      depth: 0,
      hasChildren: true
    },
    {
      no: '1.1',
      title: 'Child A',
      status: 'completed',
      owner: 'Bob',
      duration: 5,
      planStart: '2026-09-07',
      planEnd: '2026-09-11',
      actualStart: null,
      actualEnd: null,
      percentComplete: 100,
      note: 'done',
      depth: 1,
      hasChildren: true
    },
    {
      no: '1.1.1',
      title: 'Grandchild A1',
      status: 'completed',
      owner: 'Carol',
      duration: 2,
      planStart: '2026-09-10',
      planEnd: '2026-09-15',
      actualStart: null,
      actualEnd: null,
      percentComplete: 100,
      note: '',
      depth: 2,
      hasChildren: false
    },
    {
      no: '1.2',
      title: 'Child B',
      status: 'not-started',
      owner: '',
      duration: 5,
      planStart: '2026-09-14',
      planEnd: '2026-09-18',
      actualStart: null,
      actualEnd: null,
      percentComplete: 0,
      note: '',
      depth: 1,
      hasChildren: false
    }
  ]
}

await buildPlannerExportXlsx(payload, OUT)

const vals = await readValues(OUT, 'Roadmap')
assert.ok(vals.ok, `readValues ok: ${vals.ok ? '' : vals.error}`)
const cells = vals.sheets.Roadmap?.cells ?? {}

// Column C title block
assert.equal(cells.C2, 'Roadmap', 'C2 schedule name')
assert.equal(cells.C3, 'Date: 07-Sep-2026 - 18-Sep-2026', 'C3 min plan start - max plan end')
assert.equal(cells.C4, 'Progress date: 14-Sep-2026', 'C4 progress date')
assert.equal(cells.C5, 'Progress: 55% (plan 60%)', 'C5 progress line with plan percent')

// Header row 8 from column B, uppercase
assert.equal(cells.B8, 'NO.', 'header No. uppercase')
assert.equal(cells.C8, 'TITLE', 'header Title uppercase')
assert.equal(cells.D8, 'STATUS', 'header Status uppercase')
assert.equal(cells.E8, 'OWNER', 'header Owner uppercase')
assert.equal(cells.F8, 'DURATION', 'header Duration uppercase')
assert.equal(cells.G8, 'PLAN START', 'header Plan Start uppercase')
assert.equal(cells.H8, 'PLAN END', 'header Plan End uppercase')
assert.equal(cells.I8, '%', 'header % label')
assert.equal(cells.J8, 'NOTE', 'header Note uppercase')

// Data rows from row 9
assert.equal(cells.B9, '1', 'row 1 no')
assert.equal(cells.C9, 'Root', 'row 1 title unindented at depth 0')
assert.equal(cells.D9, 'In Progress', 'row 1 status label')
assert.equal(cells.E9, 'Alice', 'row 1 owner')
assert.equal(cells.F9, 10, 'row 1 duration')
assert.equal(cells.I9, 50, 'row 1 percent cached result')
assert.equal(cells.B10, '1.1', 'row 2 no')
assert.equal(cells.C10, '    Child A', 'row 2 title indented 4 spaces at depth 1')
assert.equal(cells.D10, 'Completed', 'row 2 status label')
assert.equal(cells.J10, 'done', 'row 2 note')
assert.equal(cells.I10, 100, 'row 2 percent cached result')
assert.equal(cells.B11, '1.1.1', 'row 3 no')
assert.equal(cells.C11, '        Grandchild A1', 'row 3 title indented 8 spaces at depth 2')
assert.equal(cells.D11, 'Completed', 'row 3 status label')
assert.equal(cells.E11, 'Carol', 'row 3 owner')
assert.equal(cells.F11, 2, 'row 3 duration')
assert.equal(cells.I11, 100, 'row 3 percent as number')
assert.equal(cells.B12, '1.2', 'row 4 no')
assert.equal(cells.C12, '    Child B', 'row 4 title indented')
assert.equal(cells.D12, 'Not Started', 'row 4 status label')
assert.equal(cells.E12, undefined, 'empty owner omitted')
assert.equal(cells.J12, undefined, 'empty note omitted')
assert.equal(cells.I12, 0, 'row 4 percent as number')

const g9 = cells.G9
assert.ok(typeof g9 === 'string', 'plan start is a date value')
assert.equal(
  g9,
  '2026-09-07T00:00:00.000Z',
  'plan start stored at UTC midnight (date only, no time component)'
)
assert.equal(cells.H9, '2026-09-18T00:00:00.000Z', 'plan end stored at UTC midnight')

const styles = await readStyles(OUT, 'Roadmap', 'A1..AK13')
assert.ok(styles.ok, `readStyles ok: ${styles.ok ? '' : styles.error}`)
const st = styles.sheets.Roadmap?.cells ?? {}

// Header styling: white bold Calibri 11 on Blue Darker 50%
assert.equal(st.B8?.fill?.fgColor, 'FF203864', 'header fill Blue Darker 50%')
assert.equal(st.B8?.font?.color, 'FFFFFFFF', 'header font white')
assert.equal(st.B8?.font?.bold, true, 'header font bold')
assert.equal(st.B8?.font?.name, 'Calibri', 'header font Calibri')
assert.equal(st.B8?.font?.size, 11, 'header font size 11')

// Root-with-children row: light blue, bold
assert.equal(st.B9?.fill?.fgColor, 'FFBDD7EE', 'root-with-children fill Blue Accent 5 Lighter 60%')
assert.equal(st.B9?.font?.bold, true, 'row with children is bold')
assert.equal(st.B9?.font?.color, 'FF000000', 'data font black')
assert.equal(st.B9?.font?.name, 'Calibri', 'data font Calibri')
assert.equal(st.B9?.font?.size, 11, 'data font size 11')

// Child row with children: white, bold
assert.equal(st.B10?.fill?.fgColor, 'FFFFFFFF', 'child row fill white')
assert.equal(st.B10?.font?.bold, true, 'child row with children is bold')
assert.equal(st.B11?.font?.bold, undefined, 'leaf row without children not bold')

// Status cell accent fills
assert.equal(st.D9?.fill?.fgColor, 'FFFFF2CC', 'in-progress status fill Gold Accent 4 Lighter 80%')
assert.equal(st.D10?.fill?.fgColor, 'FFA9D18E', 'completed status fill Green Accent 6 Lighter 40%')
assert.equal(st.D11?.fill?.fgColor, 'FFA9D18E', 'grandchild completed status fill')
assert.equal(st.D12?.fill?.fgColor, 'FFFFFFFF', 'not-started status keeps row fill')

// Number formats
assert.equal(st.G9?.format, 'dd-mmm-yyyy', 'date numFmt dd-MMM-yyyy')
assert.equal(st.I9?.format, '0"%"', 'percent numFmt with % sign')

// Column alignment: No. right; Status/Owner/Duration/dates center (header + data)
assert.equal(st.B8?.alignment?.horizontal, 'right', 'No. header right-aligned')
assert.equal(st.B9?.alignment?.horizontal, 'right', 'No. right-aligned')
assert.equal(st.D8?.alignment?.horizontal, 'center', 'Status header center-aligned')
assert.equal(st.D9?.alignment?.horizontal, 'center', 'Status center-aligned')
assert.equal(st.E10?.alignment?.horizontal, 'center', 'Owner center-aligned')
assert.equal(st.F10?.alignment?.horizontal, 'center', 'Duration center-aligned')
assert.equal(st.G10?.alignment?.horizontal, 'center', 'Plan Start center-aligned')
assert.equal(st.H12?.alignment?.horizontal, 'center', 'Plan End center-aligned')
assert.equal(st.C9?.alignment?.horizontal, undefined, 'Title keeps default alignment')
assert.equal(st.I9?.alignment?.horizontal, undefined, '% keeps default alignment')

// Margin columns (A and right of the table) 2.33 wide
const colWidth = (letter: string): number | undefined =>
  styles.sheets.Roadmap?.columns.find((c) => c.letter === letter)?.width
assert.equal(colWidth('A'), 2.33, 'left margin column 2.33 wide')
assert.equal(colWidth('K'), 2.33, 'right margin column 2.33 wide')

// Borders: table area = White Background 1 Darker 15%, margin ring = white
assert.equal(st.B8?.border?.top?.color, 'FFD9D9D9', 'table border White Darker 15%')
assert.equal(
  st.J12?.border?.bottom?.color,
  'FFD9D9D9',
  'table border White Darker 15% (bottom-right)'
)
assert.equal(st.A8?.border?.top?.color, 'FFFFFFFF', 'left margin border white')
assert.equal(st.K9?.border?.top?.color, 'FFFFFFFF', 'right margin (+1 col) border white')
assert.equal(st.B13?.border?.top?.color, 'FFFFFFFF', 'bottom margin (+1 row) border white')
assert.equal(st.A1?.border?.top?.color, 'FFFFFFFF', 'A1 border white')

// Gantt: starts two columns right of the table (margin col K at tableRight+1, days from L)
// Timeline: min plan start 2026-09-07 − 7 = Aug 31 (Mon), max plan end 2026-09-18 + 7 = Sep 25
// → 26 day columns L..AK (cols 12..37)
assert.equal(cells.L5, 'Aug', 'gantt month label Aug (single day, unmerged)')
assert.equal(cells.M5, 'Sep', 'gantt month label Sep')
assert.equal(st.L5?.alignment?.horizontal, 'left', 'month label left-aligned')
assert.equal(st.M5?.alignment?.horizontal, 'left', 'merged month label left-aligned')
assert.equal(cells.L6, 'M', 'gantt weekday letter for Mon Aug 31')
assert.equal(cells.M6, 'T', 'gantt weekday letter for Tue Sep 1')
assert.equal(cells.L7, 31, 'gantt day-of-month 31')
assert.equal(cells.M7, 1, 'gantt day-of-month 1')
assert.equal(cells.L8, 'PLAN', 'gantt PLAN banner on the table header row')
assert.equal(st.L8?.fill?.fgColor, 'FF203864', 'PLAN banner fill = header fill')
assert.equal(st.L8?.font?.color, 'FFFFFFFF', 'PLAN banner white bold font')
assert.equal(st.L8?.font?.bold, true, 'PLAN banner bold')
assert.equal(st.L6?.font?.size, 8, 'weekday letter compact 8pt font')
assert.equal(st.L6?.font?.bold, true, 'weekday letter bold')
assert.equal(st.L7?.font?.size, 8, 'day-of-month compact 8pt font')

// Planner-date (as-of) column tinted light red (Sep 14 = col Z)
assert.equal(st.Z6?.fill?.fgColor, 'FFF8CBCB', 'as-of weekday header cell tinted light red')
assert.equal(st.Z7?.fill?.fgColor, 'FFF8CBCB', 'as-of day-of-month header cell tinted light red')
assert.equal(st.S6?.fill, undefined, 'non-as-of working-day header cell untinted')

// Task bars: Accent 5 for rows with children, lighter Accent 5 for leaves
assert.equal(st.S9?.fill?.fgColor, 'FF5B9BD5', 'Root bar starts at Sep 7 (col S)')
assert.equal(st.AD9?.fill?.fgColor, 'FF5B9BD5', 'Root bar ends at Sep 18 (col AD)')
assert.equal(st.X9?.fill?.fgColor, 'FF5B9BD5', 'bar paints over the Sep 12 weekend')
assert.equal(st.S10?.fill?.fgColor, 'FF5B9BD5', 'Child A (has children) bar Accent 5')
assert.equal(st.W10?.fill?.fgColor, 'FF5B9BD5', 'Child A bar ends at Sep 11 (col W)')
assert.equal(st.V11?.fill?.fgColor, 'FFBDD7EE', 'leaf bar lighter blue (Grandchild, col V)')
assert.equal(st.Z12?.fill?.fgColor, 'FFBDD7EE', 'leaf Child B bar lighter blue (col Z)')

// Non-working-day shading on empty cells (Sat Sep 5 = col Q, Sun Sep 6 = col R)
assert.equal(st.Q9?.fill?.fgColor, 'FFF2F2F2', 'empty cell on Saturday shaded')
assert.equal(st.R12?.fill?.fgColor, 'FFF2F2F2', 'empty cell on Sunday shaded')
assert.equal(st.Q6?.fill?.fgColor, 'FFF2F2F2', 'weekend weekday header cell shaded')
assert.equal(st.Q7?.fill?.fgColor, 'FFF2F2F2', 'weekend day-of-month header cell shaded')
assert.equal(st.L9?.fill, undefined, 'empty cell on a working day has no fill')
assert.equal(st.L10?.fill?.fgColor, undefined, 'leaf-row empty working-day cell unfilled')

// Gantt grid borders + column widths
assert.equal(st.L9?.border?.top?.color, 'FFD9D9D9', 'gantt grid border White Darker 15%')
assert.equal(st.AK12?.border?.right?.color, 'FFD9D9D9', 'gantt last day column bordered')
assert.equal(colWidth('L'), 2.6, 'gantt day column 2.6 wide')
assert.equal(colWidth('AK'), 2.6, 'gantt last day column 2.6 wide')

// Calibri 11 applied across the styled area (margin cells included)
assert.equal(st.A1?.font?.name, 'Calibri', 'margin cell font Calibri')
assert.equal(st.A1?.font?.size, 11, 'margin cell font size 11')
assert.equal(st.C2?.font?.name, 'Calibri', 'title block cell font Calibri')
assert.equal(st.C2?.font?.size, 14, 'title name font size 14')
assert.equal(st.C2?.font?.bold, true, 'title name bold')
assert.equal(st.C3?.font?.size, 12, 'title block date font size 12')
assert.equal(st.C4?.font?.size, 12, 'title block progress date font size 12')
assert.equal(st.C5?.font?.size, 12, 'title block progress line font size 12')

// Parent % cells are live formulas over their direct children (raw XML check)
const sheetXml = async (path: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await fs.readFile(path))
  const file = zip.file('xl/worksheets/sheet1.xml')
  assert.ok(file, 'sheet1.xml present')
  return (await file.async('string')) ?? ''
}
const cellXml = (xml: string, ref: string): string =>
  xml.match(new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?</c>`))?.[0] ?? ''

const xml = await sheetXml(OUT)
assert.ok(xml.includes('<mergeCell ref="M5:AK5"/>'), 'Sep month band merged across its days')
assert.ok(xml.includes('<mergeCell ref="L8:AK8"/>'), 'PLAN banner merged across the gantt')
assert.ok(!xml.includes('<mergeCell ref="L5:'), 'single-day Aug band is not merged')
const i9 = cellXml(xml, 'I9')
assert.ok(i9, 'I9 cell present')
assert.ok(i9.includes('<f>'), 'I9 (root with children) is a formula cell')
assert.ok(
  i9.includes('SUM(F10*I10,F12*I12)/SUM(F10,F12)'),
  'I9 weighted over direct children only (skips grandchild row 11)'
)
assert.ok(i9.includes('AVERAGE(I10,I12)'), 'I9 falls back to AVERAGE when no child has a duration')
assert.ok(i9.includes('<v>50</v>'), 'I9 carries the cached rolled-up result')
const i10 = cellXml(xml, 'I10')
assert.ok(i10, 'I10 cell present')
assert.ok(
  i10.includes('SUMPRODUCT(F11,I11)/SUM(F11)'),
  'I10 (single contiguous child) uses the SUMPRODUCT form'
)
assert.ok(cellXml(xml, 'I12'), 'I12 cell present')
assert.ok(!cellXml(xml, 'I12').includes('<f>'), 'I12 (leaf) stays a plain number')

// ganttMode 'none': no timeline columns at all; the styled sweep stops at the margin col
const payload3: PlannerExportPayload = { ...payload, ganttMode: 'none' }
await buildPlannerExportXlsx(payload3, OUT3)
const vals3 = await readValues(OUT3, 'Roadmap')
assert.ok(vals3.ok, `readValues ok: ${vals3.ok ? '' : vals3.error}`)
const cells3 = vals3.sheets.Roadmap?.cells ?? {}
assert.equal(cells3.C4, 'Progress date: 14-Sep-2026', 'none: C4 progress date still written')
assert.equal(cells3.L5, undefined, 'none: no month label column')
assert.equal(cells3.L8, undefined, 'none: no PLAN banner')
const styles3 = await readStyles(OUT3, 'Roadmap', 'A1..AK13')
assert.ok(styles3.ok, `readStyles ok: ${styles3.ok ? '' : styles3.error}`)
const st3 = styles3.sheets.Roadmap?.cells ?? {}
assert.equal(st3.L9, undefined, 'none: no gantt cell styles past the margin column')
assert.equal(st3.K13?.border?.top?.color, 'FFFFFFFF', 'none: sweep ends at the right margin col')
assert.equal(
  styles3.sheets.Roadmap?.columns.find((c) => c.letter === 'L')?.width,
  undefined,
  'none: no gantt column widths'
)

// Without the Duration column, parent % cells fall back to a plain AVERAGE formula;
// progressMode 'percent' drops the plan part of the progress line
const payload2: PlannerExportPayload = {
  ...payload,
  progressMode: 'percent',
  planPercent: null,
  columns: payload.columns.filter((c) => c.key !== 'duration')
}
await buildPlannerExportXlsx(payload2, OUT2)
const vals2 = await readValues(OUT2, 'Roadmap')
assert.ok(vals2.ok, `readValues ok: ${vals2.ok ? '' : vals2.error}`)
const cells2 = vals2.sheets.Roadmap?.cells ?? {}
assert.equal(cells2.H9, 50, 'no-duration export: percent cached result')
assert.equal(cells2.C5, 'Progress: 55%', 'percent-only progress line omits the plan part')
const xml2 = await sheetXml(OUT2)
const h9 = cellXml(xml2, 'H9')
assert.ok(h9, 'H9 cell present')
assert.ok(h9.includes('AVERAGE(H10,H12)'), 'no-duration export: plain AVERAGE over direct children')

// ganttMode 'week': one column per week (same width as a day column), weeks snapped to
// the calendar's week start (Mon): Aug 31 / Sep 7 / Sep 14 / Sep 21 = cols L..O. The week
// number resets to W1 at each new month, so Aug 31 = W1, Sep 7 = W1, Sep 14 = W2, Sep 21 = W3.
const payload4: PlannerExportPayload = { ...payload, ganttMode: 'week' }
await buildPlannerExportXlsx(payload4, OUT4)
const vals4 = await readValues(OUT4, 'Roadmap')
assert.ok(vals4.ok, `readValues ok: ${vals4.ok ? '' : vals4.error}`)
const cells4 = vals4.sheets.Roadmap?.cells ?? {}
assert.equal(cells4.L5, 'Aug', 'week: month label Aug (single week, unmerged)')
assert.equal(cells4.M5, 'Sep', 'week: month label Sep')
assert.equal(cells4.L6, 'W1', 'week: Aug week labeled W1')
assert.equal(cells4.M6, 'W1', 'week: week number resets to W1 in the new month (Sep)')
assert.equal(cells4.N6, 'W2', 'week: second Sep week labeled W2')
assert.equal(cells4.O6, 'W3', 'week: third Sep week labeled W3')
assert.equal(cells4.L7, 31, 'week: first day-of-month of week 1')
assert.equal(cells4.M7, 7, 'week: first day-of-month of week 2')
assert.equal(cells4.N7, 14, 'week: first day-of-month of week 3')
assert.equal(cells4.O7, 21, 'week: first day-of-month of week 4')
assert.equal(cells4.L8, 'PLAN', 'week: PLAN banner on the table header row')

const styles4 = await readStyles(OUT4, 'Roadmap', 'A1..AK13')
assert.ok(styles4.ok, `readStyles ok: ${styles4.ok ? '' : styles4.error}`)
const st4 = styles4.sheets.Roadmap?.cells ?? {}
const colWidth4 = (letter: string): number | undefined =>
  styles4.sheets.Roadmap?.columns.find((c) => c.letter === letter)?.width
assert.equal(colWidth4('L'), 2.6, 'week column same width as a day column')
assert.equal(colWidth4('O'), 2.6, 'week last column same width as a day column')
assert.equal(st4.L8?.fill?.fgColor, 'FF203864', 'week: PLAN banner fill = header fill')
assert.equal(st4.M5?.alignment?.horizontal, 'left', 'week: merged month label left-aligned')

// As-of week (Sep 14 falls in the week starting Sep 14 = col N) tinted light red
assert.equal(st4.N6?.fill?.fgColor, 'FFF8CBCB', 'week: as-of week label tinted light red')
assert.equal(st4.N7?.fill?.fgColor, 'FFF8CBCB', 'week: as-of week day tinted light red')
assert.equal(st4.M6?.fill, undefined, 'week: non-as-of week header untinted')

// Bars fill the week columns the task's plan range overlaps (no non-work shading)
assert.equal(st4.M9?.fill?.fgColor, 'FF5B9BD5', 'week: Root bar in week of Sep 7')
assert.equal(st4.N9?.fill?.fgColor, 'FF5B9BD5', 'week: Root bar in week of Sep 14')
assert.equal(st4.L9?.fill, undefined, 'week: Root has no bar in week of Aug 31')
assert.equal(st4.O9?.fill, undefined, 'week: Root has no bar in week of Sep 21')
assert.equal(st4.M10?.fill?.fgColor, 'FF5B9BD5', 'week: Child A bar in week of Sep 7')
assert.equal(st4.N10?.fill, undefined, 'week: Child A has no bar in week of Sep 14')
assert.equal(st4.M11?.fill?.fgColor, 'FFBDD7EE', 'week: leaf Grandchild bar week of Sep 7')
assert.equal(st4.N11?.fill?.fgColor, 'FFBDD7EE', 'week: leaf Grandchild bar week of Sep 14')
assert.equal(st4.N12?.fill?.fgColor, 'FFBDD7EE', 'week: leaf Child B bar in week of Sep 14')
assert.equal(st4.L10?.fill, undefined, 'week: no non-working-day shading on empty cells')

// Week grid borders
assert.equal(st4.L9?.border?.top?.color, 'FFD9D9D9', 'week: gantt grid border White Darker 15%')
assert.equal(st4.O12?.border?.right?.color, 'FFD9D9D9', 'week: last week column bordered')

const xml4 = await sheetXml(OUT4)
assert.ok(xml4.includes('<mergeCell ref="M5:O5"/>'), 'week: Sep month band merged across its weeks')
assert.ok(xml4.includes('<mergeCell ref="L8:O8"/>'), 'week: PLAN banner merged across the gantt')
assert.ok(!xml4.includes('<mergeCell ref="L5:'), 'week: single-week Aug band is not merged')

await fs.rm(OUT, { force: true })
await fs.rm(OUT2, { force: true })
await fs.rm(OUT3, { force: true })
await fs.rm(OUT4, { force: true })
console.log('test-planner-export: OK')
