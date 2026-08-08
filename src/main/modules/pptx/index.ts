import { promises as fs } from 'fs'
import { basename } from 'path'
import type { PTTool, ToolContext } from '../../ai/tools'
import type { RegisteredModule } from '../types'
import { buildPptx } from './builder'

const DESIGN_SCHEMA = `{
  "title": "Deck title (optional)",
  "slideSize": "16x9 | 4x3 (optional, default 16x9)",
  "theme": { "primary": "#hex", "accent": "#hex", "fontFace": "Calibri" },
  "footer": "optional footer text",
  "slides": [
    {
      "layout": "title | bullets | section | statement | two-column | table | blank",
      "title": "Slide title",
      "subtitle": "Optional subtitle",
      "body": ["bullet 1", "sub-bullet text starting with a tab or indentation"],
      "left": ["..."] , "right": ["..."]         (two-column only)
      "statement": "Big centered text",            (section/statement only)
      "table": { "headers": ["A","B"], "rows": [["1","2"]] },   (table only)
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
      'Design slides with clean, consistent layouts. Use layout "bullets" (with "title" and "body" bullet lines) for most content, "title" for the opening slide, "section" for divider slides, "two-column" for comparisons and "table" for tabular data. Prefer 3-6 bullets per slide, short phrases. Add speaker "notes" to important slides. Call create_pptx_file when the design is final.',
    tools: [createPptxFileTool]
  }
}
