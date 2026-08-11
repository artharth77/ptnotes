import { promises as fs } from 'fs'
import { basename } from 'path'
import type { PTTool, ToolContext } from '../../ai/tools'
import type { RegisteredModule } from '../types'
import { createLucideIconTools } from '../shared/createLucideIconTools'
import { createChartTools } from '../shared/createChartTools'
import { createDiagramTools } from '../shared/createDiagramTools'
import { createInfographicTools } from '../shared/createInfographicTools'
import { buildDocx } from './builder'

/** Collect every picture PNG path referenced by the design (chart/diagram/infographic blocks). */
function collectChartPngPaths(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectChartPngPaths(v, out)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'png' && typeof v === 'string' && v.trim()) out.push(v.trim())
      else collectChartPngPaths(v, out)
    }
  }
  return out
}

const DESIGN_SCHEMA = `{
  "title": "Document title (optional)",
  "orientation": "portrait | landscape (optional, default portrait)",
  "margins": "normal | narrow | wide (optional, default normal)",
  "theme": { "primary": "#hex", "accent": "#hex", "fontFace": "Calibri" },
  "footer": "optional footer text (page number is appended)",
  "blocks": [
    {
      "type": "title-page",
      "title": "Big centered title", "subtitle": "Optional subtitle",
      "icon": "rocket" or { "name": "rocket", "color": "#ED7D31" }
    },
    { "type": "heading", "level": 1, "text": "Section heading (level 1-6)" },
    { "type": "paragraph", "text": "Body paragraph", "bold": false, "align": "left | center | right | justify" },
    { "type": "bullets", "items": ["bullet 1", "sub-bullet starting with a tab or indentation"] },
    { "type": "numbered", "items": ["item 1", "sub-item starting with a tab or indentation"] },
    { "type": "table", "title": "Optional caption", "headers": ["A","B"], "rows": [["1","2"]] },
    { "type": "quote", "text": "Quoted text", "author": "Optional attribution" },
    { "type": "callout", "title": "Optional bold heading", "text": "Highlighted note box" },
    { "type": "chart", "png": "/abs/path/chart.png", "caption": "Optional", "width": 6.0 },
      (chart block only — the PNG path returned by render_chart. width in inches is optional;
       by default the image fills the page width, preserving its aspect ratio.)
    { "type": "diagram", "png": "/abs/path/diagram.png", "caption": "Optional", "width": 6.0 },
      (diagram block only — the PNG path returned by render_diagram. Same placement semantics as chart.)
    { "type": "infographic", "png": "/abs/path/infographic.png", "caption": "Optional", "width": 6.0 },
      (infographic block only — the PNG path returned by render_infographic. Same placement semantics as chart.)
    { "type": "divider" },
    { "type": "page-break" }
  ]
}`

const createDocxFileTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'create_docx_file',
      description: `Create a Word (.docx) file in the project files folder from a document design JSON. Returns the output path on success. Design schema:
${DESIGN_SCHEMA}`,
      parameters: {
        type: 'object',
        properties: {
          project: {
            type: 'string',
            description: 'Project name. Defaults to the current project.'
          },
          document: {
            type: 'string',
            description: 'JSON string describing the document (see schema in the tool description).'
          },
          filename: {
            type: 'string',
            description:
              'Suggested output file name (may be deduplicated). Defaults to the document title.'
          }
        },
        required: ['document']
      }
    }
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const project =
      typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : ctx.activeProject

    let design: unknown
    if (typeof args.document === 'string') {
      try {
        design = JSON.parse(args.document)
      } catch {
        design = null
      }
    } else {
      design = args.document
    }
    if (!design || typeof design !== 'object') {
      return JSON.stringify({ ok: false, error: 'document must be a JSON object or JSON string.' })
    }

    let suggested = String(args.filename || '')
    if (!suggested.trim()) {
      const d = design as { title?: unknown }
      suggested = typeof d.title === 'string' && d.title.trim() ? d.title.trim() : 'document'
    }
    suggested = suggested.replace(/(\.docx)?$/i, '')

    try {
      const outPath = await ctx.service.uniqueOutputPath(project, `${suggested}.docx`)
      const res = await buildDocx(design, outPath)
      if (!res.ok) {
        await fs.unlink(outPath).catch(() => {})
        return JSON.stringify(res)
      }
      const tempImages = collectChartPngPaths(design)
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

/** Register the DOCX module. Call via ModuleRegistry.register(createDocxModule()). */
export function createDocxModule(): RegisteredModule {
  return {
    id: 'docx',
    name: 'Word (DOCX)',
    summary: 'Creates a polished Word document (.docx) report from an outline or source notes.',
    description:
      "Creates a professional Word (.docx) report. When the user asks for a Word document, report, article, memo, manual, proposal or meeting notes, prepare a DETAILED prompt: the document's goal/audience, the section-by-section outline (headings + content), and which files/notes to source from. The module subagent will plan steps, read any referenced note:/file: inputs, design the document as JSON blocks and produce a real .docx saved to the project files folder.",
    systemPrompt:
      'Write clean, well-structured documents. Use blocks in this order: "title-page" once at the start (title + optional subtitle + one tasteful Lucide icon — call search_lucide_icons with a keyword and use the returned canonical name), "heading" (level 1-6) for section/subsection titles, "paragraph" for body text, "bullets" or "numbered" for lists, "table" for tabular data (headers + rows), "quote" for a highlighted quotation, "callout" for an emphasized note box, "divider" to separate major parts, and "page-break" to start a new page. Prefer short paragraphs and 3-8 list items per list so the document stays readable. For a data chart (trends, comparisons, distribution): author a Chart.js chart JSON — { "type": "bar" | "line" | "pie" | "doughnut" | "radar" | "polarArea" | "scatter" | "bubble", "data": { "labels": [...], "datasets": [{ "label", "data": [...] }] }, "options"?, "width"? in px, "height"? in px } — call chart_preview to sanity-check, then render_chart to produce a rasterized PNG. For a diagram (flowcharts, workflows, sequence flows, state machines, class/ER relationships, GANTT charts / project timelines): author MERMAID source text (flowchart TD/LR, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, pie or gantt), call diagram_preview to sanity-check, then render_diagram to produce a rasterized PNG. For an infographic (visual summaries, timelines, comparisons/SWOT, hierarchies, processes, ROADMAPS, MINDMAPS): call list_infographic_templates to pick an @antv/infographic template, author the design using its data shape, call infographic_preview to sanity-check, then render_infographic to produce a rasterized PNG. Then add a "chart" / "diagram" / "infographic" block whose "png" field is the returned PNG path. All rendering is pure local — NO network, CLI tools or headless browser. Do NOT invent data — use only the numbers, names and facts from the user prompt or any referenced note:/file: inputs.',
    outputTool: 'create_docx_file',
    tools: [
      ...createDiagramTools(),
      ...createChartTools(),
      ...createInfographicTools(),
      ...createLucideIconTools(),
      createDocxFileTool
    ]
  }
}
