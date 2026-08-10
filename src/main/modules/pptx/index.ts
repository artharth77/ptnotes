import { promises as fs } from 'fs'
import { basename } from 'path'
import type { PTTool, ToolContext } from '../../ai/tools'
import type { RegisteredModule } from '../types'
import { createLucideIconTools } from '../shared/createLucideIconTools'
import { createChartTools } from '../shared/createChartTools'
import { buildPptx } from './builder'

/** Collect every chart PNG path referenced by the design (chart slide specs). */
function collectChartPngPaths(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectChartPngPaths(v, out)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'png' && typeof v === 'string' && v.trim()) out.push(v.trim())
      else if (k === 'chart' && typeof v === 'string' && v.trim()) out.push(v.trim())
      else collectChartPngPaths(v, out)
    }
  }
  return out
}

const DESIGN_SCHEMA = `{
  "title": "Deck title (optional)",
  "slideSize": "16x9 | 4x3 (optional, default 16x9)",
  "theme": { "primary": "#hex", "accent": "#hex", "fontFace": "Calibri" },
  "footer": "optional footer text",
  "slides": [
    {
      "layout": "title | bullets | section | statement | two-column | table | chart | blank",
      "title": "Slide title",
      "subtitle": "Optional subtitle",
      "body": ["bullet 1", "sub-bullet text starting with a tab or indentation"],
      "left": ["..."] , "right": ["..."]         (two-column only)
      "statement": "Big centered text",            (section/statement only)
      "table": { "headers": ["A","B"], "rows": [["1","2"]] },   (table only)
      "icon": "rocket" or { "name": "rocket", "size": 0.6, "color": "#ED7D31", "x": 8.5, "y": 0.3 },
            (optional, any slide. Use search_lucide_icons to pick a canonical icon name.)
      "chart": { "png": "/abs/path/chart.png", "x": 1.0, "y": 1.5, "w": 8.0, "h": 4.0 },
            (chart layout only — the PNG path returned by render_chart. x/y/w/h are optional;
             by default the image is centered to fill the body area, preserving its aspect ratio.)
      "notes": "Speaker notes (optional)"
    }
  ]
}`

const createPptxFileTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'create_pptx_file',
      description: `Create a PowerPoint (.pptx) file in the project files folder from a slide design JSON. Returns the output path on success. Design schema:
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
            description:
              'JSON string describing the presentation (see schema in the tool description).'
          },
          filename: {
            type: 'string',
            description:
              'Suggested output file name (may be deduplicated). Defaults to the deck title.'
          }
        },
        required: ['design']
      }
    }
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const project =
      typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : ctx.activeProject

    let design: unknown
    if (typeof args.design === 'string') {
      try {
        design = JSON.parse(args.design)
      } catch {
        design = null
      }
    } else {
      design = args.design
    }
    if (!design || typeof design !== 'object') {
      return JSON.stringify({ ok: false, error: 'design must be a JSON object or JSON string.' })
    }

    let suggested = String(args.filename || '')
    if (!suggested.trim()) {
      const d = design as { title?: unknown }
      suggested = typeof d.title === 'string' && d.title.trim() ? d.title.trim() : 'presentation'
    }
    suggested = suggested.replace(/(\.pptx)?$/i, '')

    try {
      const outPath = await ctx.service.uniqueOutputPath(project, `${suggested}.pptx`)
      const res = await buildPptx(design, outPath)
      if (!res.ok) {
        await fs.unlink(outPath).catch(() => {})
        return JSON.stringify(res)
      }
      const tempCharts = collectChartPngPaths(design)
      await ctx.service.cleanupModuleTempFiles(project, tempCharts)
      return JSON.stringify({ ...res, project, file: basename(outPath) })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
}

/** Register the PPTX module. Call via ModuleRegistry.register(createPptxModule()). */
export function createPptxModule(): RegisteredModule {
  return {
    id: 'pptx',
    name: 'PowerPoint (PPTX)',
    summary: 'Generates a PowerPoint presentation (.pptx) from a detailed outline or source notes.',
    description:
      "Creates a polished PowerPoint (.pptx) deck. When the user asks to make a presentation, slides, or a PowerPoint, prepare a DETAILED prompt: the deck's goal/audience, the slide-by-slide outline (titles + bullet content), any theme preference, and which files/notes to source from. The module subagent will plan steps, read any referenced note:/file: inputs, design the slides as JSON and produce a real .pptx saved to the project files folder.",
    systemPrompt:
      'Design slides with clean, consistent layouts. Use layout "bullets" (with "title" and "body" bullet lines) for most content, "title" for the opening slide, "section" for divider slides, "two-column" for comparisons, "table" for tabular data and "chart" for a data chart picture. Prefer 3-6 bullets per slide, short phrases. Add tasteful Lucide icons: call search_lucide_icons with a keyword for section, statement and title slides (and optionally a corner icon on content slides), then set the slide "icon" field with the returned canonical name. For a "chart" slide (data, trends, comparisons, distribution): author a Chart.js chart JSON — { "type": "bar" | "line" | "pie" | "doughnut" | "radar" | "polarArea" | "scatter" | "bubble", "data": { "labels": [...], "datasets": [{ "label", "data": [...] }] }, "options"?, "width"? in px, "height"? in px } — call chart_preview to sanity-check size and counts first, then call render_chart to produce a rasterized PNG in the project files folder. Set the slide to { "layout": "chart", "chart": { "png": "<the returned png path>" } } — optionally refine placement with x/y/w/h. Do NOT build charts as node-edge diagrams; Chart.js handles all layout/axis math. Chart rendering is pure local (in-process Chart.js onto a Skia canvas), never use network calls, CLI tools or a headless browser. Add speaker "notes" to important slides. Call create_pptx_file when the design is final.',
    outputTool: 'create_pptx_file',
    tools: [...createChartTools(), ...createLucideIconTools(), createPptxFileTool]
  }
}
