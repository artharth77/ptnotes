import { promises as fs } from 'fs'
import { basename } from 'path'
import type { PTTool, ToolContext } from '../../ai/tools'
import type { RegisteredModule } from '../types'
import { createInfographicTools } from '../shared/createInfographicTools'
import { DEFAULT_INFOGRAPHIC_PIXEL_WIDTH, validateInfographic } from '../shared/infographic'
import { renderInfographicIsolated } from '../shared/infographicRenderer'
import { slugify } from '../../utils/slug'

function infographicOf(args: Record<string, unknown>): { raw: unknown; error?: string } {
  const raw = args.infographic
  if (typeof raw === 'string' && raw.trim()) return { raw: raw.trim() }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { raw }
  return {
    raw: null,
    error:
      '"infographic" must be a DSL syntax string (starting with "infographic <template>") or a JSON design object.'
  }
}

function pixelWidthOf(args: Record<string, unknown>): number | undefined {
  const n = Number(args.pixelWidth)
  return Number.isFinite(n) && n >= 400 && n <= 4000 ? Math.floor(n) : undefined
}

/** Save the final infographic deliverable (.svg + .png) into <project>/files/. */
const createInfographicFileTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'create_infographic_file',
      description: `Create the final infographic deliverable in the project files folder. Pure local rendering — NO network, CLI tools, or headless browser. Accepts an @antv/infographic design (DSL string starting with "infographic <template>" or a JSON object { "template", "data", ... }); pick the template with list_infographic_templates first and sanity-check with infographic_preview. Writes "<project>/files/<slug>.svg" (the primary vector deliverable) plus a matching ".png" raster and returns both absolute paths.`,
      parameters: {
        type: 'object',
        properties: {
          project: {
            type: 'string',
            description: 'Project name. Defaults to the current project.'
          },
          infographic: {
            type: ['string', 'object'],
            description:
              'Infographic design — DSL string starting with "infographic <template>" followed by data/design/theme blocks, or a JSON object { "template": "<name>", "data": { ... }, "theme"?, "width"?, "height"? }.'
          },
          filename: {
            type: 'string',
            description:
              'Suggested output stem for the .svg and .png files (may be deduplicated). Defaults to "infographic".'
          },
          pixelWidth: {
            type: 'number',
            description: `Raster width in pixels for the .png (default ${DEFAULT_INFOGRAPHIC_PIXEL_WIDTH}; clamped 400-4000).`
          }
        },
        required: ['infographic']
      }
    }
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const project =
      typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : ctx.activeProject

    const { raw, error } = infographicOf(args)
    if (error) return JSON.stringify({ ok: false, error })
    const checked = await validateInfographic(raw)
    if (!checked.ok) return JSON.stringify(checked)

    let out: { svg: string; png: Buffer; template: string; width: number; height: number }
    try {
      out = await renderInfographicIsolated(checked.renderArgs, pixelWidthOf(args))
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: `Could not render the infographic: ${err instanceof Error ? err.message : String(err)}`
      })
    }

    let stem = String(args.filename || '')
    if (!stem.trim()) stem = 'infographic'
    stem = slugify(stem.replace(/\.(png|svg)$/i, '')) || 'infographic'

    let svgPath = ''
    let pngPath = ''
    try {
      svgPath = await ctx.service.uniqueOutputPath(project, `${stem}.svg`)
      pngPath = svgPath.replace(/\.svg$/, '.png')
      await fs.writeFile(svgPath, out.svg, 'utf8')
      await fs.writeFile(pngPath, out.png)
      return JSON.stringify({
        ok: true,
        project,
        path: svgPath,
        file: basename(svgPath),
        files: [svgPath, pngPath],
        png: pngPath,
        template: out.template,
        width: out.width,
        height: out.height
      })
    } catch (err) {
      for (const p of [svgPath, pngPath].filter(Boolean)) {
        await fs.unlink(p).catch(() => {})
      }
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
}

/** Register the standalone infographic module. Call via ModuleRegistry.register(createInfographicModule()). */
export function createInfographicModule(): RegisteredModule {
  return {
    id: 'infographic',
    name: 'Infographic',
    summary:
      'Creates a polished data-story infographic (.svg + .png) from a topic, outline or source notes.',
    description:
      'Creates a professional infographic using @antv/infographic built-in templates (lists, sequences/timelines, comparisons/SWOT, hierarchies/mindmaps, relations/networks, word clouds, pie charts). When the user asks for an infographic, poster, one-pager or visual summary, prepare a DETAILED prompt: the topic, the key points/data to visualize, and any source notes/files. The module subagent will pick a template, author the design and save a ready-to-share .svg + .png into the project files folder.',
    systemPrompt:
      'Author clean, data-driven infographics. FIRST call list_infographic_templates to pick a fitting template and follow its data shape: list templates use "lists", sequence use "sequences", compare use "compares", relation use "nodes" + "relations", hierarchy use "root" (with nested "children"), chart use "values". Items are { "label", "desc"?, "value"? }. Prefer 3-8 items so the infographic stays legible. Then call infographic_preview to sanity-check size and totals, iterate on the design if needed, and finally call create_infographic_file to save the .svg (primary) + .png deliverable into the project files folder. Rendering is pure local (in-process; no network, CLI tools or headless browser). Do NOT invent data — use only the numbers, names and facts from the user prompt or read any referenced note:/file: inputs.',
    outputTool: 'create_infographic_file',
    tools: [...createInfographicTools(), createInfographicFileTool]
  }
}
