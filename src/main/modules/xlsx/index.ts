import { promises as fs } from 'fs'
import { basename } from 'path'
import type { PTTool, ToolContext } from '../../ai/tools'
import type { RegisteredModule } from '../types'
import { createChartTools } from '../shared/createChartTools'
import { createDiagramTools } from '../shared/createDiagramTools'
import { createInfographicTools } from '../shared/createInfographicTools'
import {
  buildXlsx,
  collectImagePaths,
  listSheets,
  readStyles,
  readValues,
  type XlsxTemplateRef
} from './builder'

async function resolveProjectFile(
  ctx: ToolContext,
  project: string,
  file: string
): Promise<{ path: string } | { error: string }> {
  const path = await ctx.service.projectFilePath(project, file.trim())
  if (path) return { path }
  const files = await ctx.service.listFiles(project)
  return {
    error: `File "${file}" not found in this project. Available files: ${
      files.join(', ') || '(none)'
    }`
  }
}

function parseDesign(args: Record<string, unknown>): unknown | undefined {
  let raw = args.design
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  return raw ?? undefined
}

const RANGE_DOC =
  'Excel range in A1 notation, e.g. "A1..G20" or "A1-G20" (top-left..bottom-right). Omit for the whole used area.'

const excelListSheetsTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'excel_list_sheets',
      description:
        'List the worksheets of an Excel (.xlsx/.xlsm) file in the project files folder, with their 1-based index, name and used dimensions.',
      parameters: {
        type: 'object',
        properties: {
          project: {
            type: 'string',
            description: 'Project name. Defaults to the current project.'
          },
          file: {
            type: 'string',
            description: 'File name of the workbook, e.g. budget.xlsx.'
          }
        },
        required: ['file']
      }
    }
  },
  async execute(args, ctx): Promise<string> {
    const project =
      typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : ctx.activeProject
    const file = String(args.file ?? '').trim()
    if (!file) return JSON.stringify({ ok: false, error: 'No file name provided.' })
    const resolved = await resolveProjectFile(ctx, project, file)
    if ('error' in resolved) return JSON.stringify({ ok: false, error: resolved.error })
    const res = await listSheets(resolved.path)
    return JSON.stringify({ project, file, ...res })
  }
}

const excelReadValuesTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'excel_read_values',
      description:
        'Read cell VALUES from an Excel (.xlsx/.xlsm) file in the project files folder. Returns each non-empty cell value keyed by its address (e.g. {"B2": 42}) for the requested worksheet/range.',
      parameters: {
        type: 'object',
        properties: {
          project: {
            type: 'string',
            description: 'Project name. Defaults to the current project.'
          },
          file: {
            type: 'string',
            description: 'File name of the workbook, e.g. budget.xlsx.'
          },
          sheet: {
            type: 'string',
            description:
              'Worksheet by name or 1-based number, e.g. "Sales" or "2". Defaults to all worksheets.'
          },
          range: {
            type: 'string',
            description: RANGE_DOC
          }
        },
        required: ['file']
      }
    }
  },
  async execute(args, ctx): Promise<string> {
    const project =
      typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : ctx.activeProject
    const file = String(args.file ?? '').trim()
    if (!file) return JSON.stringify({ ok: false, error: 'No file name provided.' })
    const resolved = await resolveProjectFile(ctx, project, file)
    if ('error' in resolved) return JSON.stringify({ ok: false, error: resolved.error })
    const res = await readValues(
      resolved.path,
      args.sheet as string | undefined,
      args.range as string | undefined
    )
    return JSON.stringify({ project, file, ...res })
  }
}

const excelReadStylesTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'excel_read_styles',
      description:
        'Read cell STYLES from an Excel (.xlsx/.xlsm) file in the project files folder. Returns font (name/size/bold/italic/underline/strike/color), fill/background color, borders (style/width/color), alignment (vertical/horizontal/wrapText) and number format per styled cell, plus column widths and row heights. Use it to study an existing file before producing a matching workbook.',
      parameters: {
        type: 'object',
        properties: {
          project: {
            type: 'string',
            description: 'Project name. Defaults to the current project.'
          },
          file: {
            type: 'string',
            description: 'File name of the workbook, e.g. budget.xlsx.'
          },
          sheet: {
            type: 'string',
            description:
              'Worksheet by name or 1-based number, e.g. "Sales" or "2". Defaults to all worksheets.'
          },
          range: {
            type: 'string',
            description: RANGE_DOC
          }
        },
        required: ['file']
      }
    }
  },
  async execute(args, ctx): Promise<string> {
    const project =
      typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : ctx.activeProject
    const file = String(args.file ?? '').trim()
    if (!file) return JSON.stringify({ ok: false, error: 'No file name provided.' })
    const resolved = await resolveProjectFile(ctx, project, file)
    if ('error' in resolved) return JSON.stringify({ ok: false, error: resolved.error })
    const res = await readStyles(
      resolved.path,
      args.sheet as string | undefined,
      args.range as string | undefined
    )
    return JSON.stringify({ project, file, ...res })
  }
}

const STYLE_SCHEMA = `{
  "font": { "name": "Calibri", "size": 11, "bold": true, "italic": false, "underline": false, "strike": false, "color": "#FFFFFF" },
  "fill": { "pattern": "solid", "fgColor": "#4472C4", "bgColor": "#optional" },
  "border": {
    "top":    { "style": "thin", "width": 1, "color": "#000000" },
    "right":  { "style": "thin" }, "bottom": { "style": "medium" }, "left": { "style": "thin" }
  },
  "alignment": { "vertical": "top|middle|bottom", "horizontal": "left|center|right", "wrapText": false },
  "format": "#,##0.00"
}
(border style: hair/thin/medium/thick/dotted/double/dashDot/...; give "style" OR numeric "width" 0.5-3;
 colors: hex "#RRGGBB"/"AARRGGBB", theme/indexed palette refs "theme-0..11" or "indexed-0..65" (exactly what
 excel_read_styles returns; indexed-64/65 are the system fg/bg markers Excel writes as bgColor), each optionally "@tint" -1..1 e.g. "theme-4@-0.15"; "format" is a number format
 e.g. "#,##0.00", "0%", "yyyy-mm-dd")`

const DESIGN_SCHEMA = `{
  "templateMode": "clone-layout | style-source (only relevant when the tool got a template file;
       clone-layout keeps the template's layout/cells and applies this design on top;
       style-source starts a fresh workbook and copies the template's styles onto matching addresses)",
  "theme": { "fontName": "Calibri", "fontSize": 11 },
  "sheets": [
    {
      "name": "Sheet1",
      "templateSheet": "optional source sheet name for style-source mode when names differ",
      "styles": { "header": { STYLE }, "money": { STYLE } },
      "cells": [
        { "cell": "A1", "value": "Region", "styleRef": "header" },
        { "cell": "B2", "value": 1234.5, "style": { STYLE } },
        { "cell": "C2", "formula": "SUM(B2:B2)" },
        { "cell": "D2", "value": "=TODAY()" }
      ],
      "rows": [ { "startCell": "A5", "values": ["EMEA", 100, "=B5*2"] } ],
      "columns": [22, 14],
      "rowHeights": [ { "row": 1, "height": 24 } ],
      "freeze": "A2",
      "merges": [ ["A1", "D1"] ],
      "images": [ { "png": "/abs/path/chart.png", "anchor": "F2", "to": "K16" } ]
    }
  ]
}
(STYLE = ${STYLE_SCHEMA}
 values: strings starting with "=" become formulas; numbers/booleans/null pass through.
 columns is an array of widths (char units) starting at column A.
 images: anchor/to accept cells; use "to" to stretch over a range or widthPx/heightPx to scale.)`

const createXlsxFileTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'create_xlsx_file',
      description: `Create an Excel (.xlsx) workbook in the project files folder from a design JSON. Returns the output path on success. Design schema:
${DESIGN_SCHEMA}`,
      parameters: {
        type: 'object',
        properties: {
          project: {
            type: 'string',
            description: 'Project name. Defaults to the current project.'
          },
          design: {
            type: 'string',
            description: 'JSON string describing the workbook (see schema in the tool description).'
          },
          filename: {
            type: 'string',
            description: 'Suggested output file name (may be deduplicated). Defaults to "workbook".'
          },
          template: {
            type: 'string',
            description:
              'Optional file name of an existing .xlsx in the project files folder to build from (its styles/layout).'
          },
          templateMode: {
            type: 'string',
            enum: ['clone-layout', 'style-source'],
            description:
              'How to use the template: "clone-layout" (default) keeps its cells/layout and applies the design on top; "style-source" copies its styles onto a fresh workbook.'
          }
        },
        required: ['design']
      }
    }
  },
  async execute(args, ctx): Promise<string> {
    const project =
      typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : ctx.activeProject

    const design = parseDesign(args)
    if (!design || typeof design !== 'object' || Array.isArray(design)) {
      return JSON.stringify({ ok: false, error: 'design must be a JSON object or JSON string.' })
    }

    let templateRef: XlsxTemplateRef | undefined
    const templateName = String(args.template ?? '').trim()
    if (templateName) {
      const resolved = await resolveProjectFile(ctx, project, templateName)
      if ('error' in resolved) return JSON.stringify({ ok: false, error: resolved.error })
      const mode =
        args.templateMode === 'style-source' || args.templateMode === 'clone-layout'
          ? args.templateMode
          : undefined
      templateRef = { path: resolved.path, mode }
    }

    let suggested = String(args.filename ?? '').trim() || 'workbook'
    suggested = suggested.replace(/(\.xlsx)?$/i, '')

    try {
      const outPath = await ctx.service.uniqueOutputPath(project, `${suggested}.xlsx`)
      const res = await buildXlsx(design, outPath, templateRef)
      if (!res.ok) {
        await fs.unlink(outPath).catch(() => {})
        return JSON.stringify(res)
      }
      const tempImages = collectImagePaths(design)
      await ctx.service.cleanupModuleTempFiles(project, tempImages)
      return JSON.stringify({ ...res, project, file: basename(outPath) })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
}

/** Register the XLSX module. Call via ModuleRegistry.register(createXlsxModule()). */
export function createXlsxModule(): RegisteredModule {
  return {
    id: 'xlsx',
    name: 'Excel (XLSX)',
    summary:
      'Creates or edits styled Excel (.xlsx) workbooks, optionally reusing an existing file as a style template.',
    description:
      'Creates real Excel (.xlsx) workbooks with values, formulas and full styling (fonts, fills, borders, alignment, number formats, column widths, frozen headers, embedded chart images). When the user asks for a spreadsheet, Excel file, budget, tracker, timesheet, invoice-like table or any tabular deliverable as .xlsx — including making a new file that follows the look of an existing one — prepare a DETAILED prompt: the goal, the exact data (or which note:/file: sources to pull it from), the desired layout (columns, header styling, formats) and, when applicable, the name of an existing .xlsx file in the project files folder to use as the template. The module subagent can inspect existing workbooks (sheets, values and styles by range) and will produce a real .xlsx saved to the project files folder.',
    systemPrompt:
      'Build workbooks cell-by-cell with explicit addresses so layouts are deterministic. Workflow: (1) If an existing file should be reused or matched, first call excel_list_sheets, then excel_read_styles (and excel_read_values) on the relevant range — ranges look like "A1..G20" or "A1-G20"; sheet accepts a name or 1-based number. (2) TEMPLATE MATCHING: when the user points at an existing workbook to use as a template, read BOTH values and styles over the header row plus at least the 2-3 data rows below it (e.g. range "A1..H5") before designing. Identify each column by its header TEXT and map incoming data onto matching headers BY NAME — fill values under the headers they belong to, never assume column order, and leave non-matching columns empty rather than guessing. Copy the observed DATA-ROW styling from those sample rows into your design: per-column font, fill fgColor/bgColor, borders, alignment and number format, including variations between consecutive rows (banded/alternating striping) — reproduce the pattern across all rows you write. Decide the mode explicitly: clone-layout keeps the template layout and overwrites/adds content; style-source borrows only its look for new content (match template sheets by name or set "templateSheet"). (3) Author ONE design JSON: reusable named "styles" per sheet plus cells referencing them via "styleRef"; bulk rows go in "rows" ({ startCell, values }). Strings starting with "=" become formulas. Give every column a sensible width, style header rows bold with a solid fill, white font and thin borders, freeze the header row with "freeze": "A2", and add number "format"s (#,##0.00 for money, 0% for percentages, yyyy-mm-dd for dates). (4) For a data chart, author Chart.js chart JSON, call chart_preview to sanity-check, then render_chart, and put the returned PNG path into sheet.images with an anchor cell (and "to" to size it). (5) Call create_xlsx_file once; fix any returned error and retry. All rendering is pure local — NO network, CLI tools or headless browser. Do NOT invent data — use only the numbers, names and facts from the user prompt or referenced note:/file: inputs.',
    outputTool: 'create_xlsx_file',
    tools: [
      ...createDiagramTools(),
      ...createChartTools(),
      ...createInfographicTools(),
      excelListSheetsTool,
      excelReadValuesTool,
      excelReadStylesTool,
      createXlsxFileTool
    ]
  }
}
