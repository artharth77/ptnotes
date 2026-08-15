import { promises as fs } from 'fs'
import type { PTTool, ToolContext } from '../../ai/tools'
import {
  categoryOfName,
  DEFAULT_INFOGRAPHIC_PIXEL_WIDTH,
  listInfographicTemplates,
  templateCategoryHint,
  templateDataHint,
  validateInfographic,
  type InfographicTemplateCategory
} from './infographic'
import { renderInfographicIsolated } from './infographicRenderer'
import { slugify } from '@shared/slug'

/**
 * Shared in-process infographic tools any module can opt into via
 * `tools: [...createInfographicTools(), ...]`. Rendering is pure local
 * (@antv/infographic SSR onto a linkedom DOM shim + @resvg/resvg-js in an
 * isolated utility process): no network, no CLI exec/spawn, no headless
 * browser. The runner already merges `module.tools`, so no framework changes
 * are needed to share them.
 */

const INFOGRAPHIC_CATEGORIES = 'list, sequence, compare, relation, hierarchy, chart, word-cloud'

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

function infographicMeta(out: { template: string; width: number; height: number }): {
  template: string
  width: number
  height: number
} {
  return {
    template: out.template,
    width: out.width,
    height: out.height
  }
}

function categoryLabel(category: InfographicTemplateCategory): string {
  return `${category} — ${templateCategoryHint(category)}`
}

function dataHintFor(template: string): string {
  return templateDataHint(categoryOfName(template))
}

const INFOGRAPHIC_SCHEMA_HINT =
  'Infographic design — either a DSL string starting with "infographic <template>" followed by "data" / "design" / "theme" blocks (2-space indent), or a JSON object { "template": "<name>", "data": { ... }, "theme"?, "width"?, "height"? }. Pick the template with list_infographic_templates first.'

const INFOGRAPHIC_ICON_HINT =
  'Item icons use the local Material Design Icons format "icon": "mdi/<name>" (kebab-case name from the bundled MDI catalog, e.g. "mdi/cog", "mdi/email", "mdi/rocket"). Only "mdi/<name>" icons render; other icon sources are ignored. When an item omits "icon", a matching name is auto-filled from the item label.'

/** List the built-in template catalog (model picks a template before rendering). */
const listTemplatesTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'list_infographic_templates',
      description: `List the built-in infographic templates you can render. Each template has a category (${INFOGRAPHIC_CATEGORIES}) and the data shape it expects. Call this FIRST to pick a template name, then author the infographic (DSL string or JSON design) for infographic_preview / render_infographic.`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Optional substring to filter template names, e.g. "timeline", "steps", "swot", "pie", "tree".'
          },
          category: {
            type: 'string',
            enum: ['list', 'sequence', 'compare', 'relation', 'hierarchy', 'chart', 'word-cloud'],
            description: 'Optional category filter. Leave empty to see all.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of templates to return (default 50).'
          }
        }
      }
    }
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
    const category = typeof args.category === 'string' ? args.category : ''
    const rawLimit = Number(args.limit)
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 300) : 50
    const templates = await listInfographicTemplates()
    const filtered = templates.filter((t) => {
      if (category && t.category !== category) return false
      if (query && !t.name.toLowerCase().includes(query)) return false
      return true
    })
    const items: { name: string; category: string; data: string }[] = filtered
      .slice(0, limit)
      .map((t) => ({ name: t.name, category: t.category, data: dataHintFor(t.name) }))
    const categories = new Set(filtered.map((t) => t.category))
    return JSON.stringify({
      ok: true,
      total: filtered.length,
      shown: items.length,
      categories: [...categories].map(categoryLabel),
      templates: items
    })
  }
}

/** Dry-run layout preview: validates + renders the infographic in memory, writes nothing. */
const infographicPreviewTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'infographic_preview',
      description: `Preview an @antv/infographic infographic WITHOUT creating any files. Pass the design (${INFOGRAPHIC_SCHEMA_HINT}) and optionally "pixelWidth" in pixels. Renders in-memory and returns the template name and canvas size so you can sanity-check before calling render_infographic. Local, in-process, deterministic (no network, no headless browser).`,
      parameters: {
        type: 'object',
        properties: {
          infographic: {
            type: ['string', 'object'],
            description: INFOGRAPHIC_SCHEMA_HINT
          },
          pixelWidth: {
            type: 'number',
            description: `Raster width in pixels for the in-memory preview (default ${DEFAULT_INFOGRAPHIC_PIXEL_WIDTH}; clamped 400-4000).`
          }
        },
        required: ['infographic']
      }
    }
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const { raw, error } = infographicOf(args)
    if (error) return JSON.stringify({ ok: false, error })
    const checked = await validateInfographic(raw)
    if (!checked.ok) return JSON.stringify(checked)
    try {
      const out = await renderInfographicIsolated(checked.renderArgs, pixelWidthOf(args))
      return JSON.stringify({ ok: true, ...infographicMeta(out) })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: `Could not render the infographic: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }
}

/** Render an infographic to temporary SVG + PNG + JSON files in the project. */
const renderInfographicTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'render_infographic',
      description:
        `Render an @antv/infographic infographic to temporary rasterized files in the project. Pure local rendering — NO network, CLI tools, or headless browser. Writes "<project>/.data/modules/temp/<slug>.png", ".svg" and ".json" (temp files that are deleted automatically once the final deck is built) and returns their absolute paths plus the template name and size. Use list_infographic_templates to pick the template and infographic_preview to sanity-check first. The returned "png" path can be embedded on an "infographic" slide via create_pptx_file.` +
        ` Data arrays: list templates use "lists", sequence use "sequences", compare use "compares", relation use "nodes" + "relations", hierarchy use "root" (with nested "children"), chart use "values". Items are { "label", "desc"?, "value"?, "icon"?, "children"? }. ${INFOGRAPHIC_ICON_HINT}`,
      parameters: {
        type: 'object',
        properties: {
          infographic: {
            type: ['string', 'object'],
            description: INFOGRAPHIC_SCHEMA_HINT
          },
          filename: {
            type: 'string',
            description: 'Suggested output stem (PNG/SVG/JSON share it). Defaults to "infographic".'
          },
          pixelWidth: {
            type: 'number',
            description: `Raster width in pixels for the PNG (default ${DEFAULT_INFOGRAPHIC_PIXEL_WIDTH}; clamped 400-4000).`
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
    stem = slugify(stem.replace(/\.(png|svg|json)$/i, '')) || 'infographic'

    let pngPath = ''
    let svgPath = ''
    let jsonPath = ''
    try {
      const outPath = await ctx.service.uniqueModuleTempPath(project, `${stem}.png`)
      pngPath = outPath
      svgPath = outPath.replace(/\.png$/, '.svg')
      jsonPath = outPath.replace(/\.png$/, '.json')

      const meta = {
        kind: 'infographic',
        template: out.template,
        width: out.width,
        height: out.height
      }

      await fs.writeFile(pngPath, out.png)
      await fs.writeFile(svgPath, out.svg, 'utf8')
      await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'utf8')

      const summary = infographicMeta(out)
      return JSON.stringify({
        ok: true,
        project,
        png: pngPath,
        svg: svgPath,
        json: jsonPath,
        ...summary
      })
    } catch (err) {
      for (const p of [pngPath, svgPath, jsonPath].filter(Boolean)) {
        await fs.unlink(p).catch(() => {})
      }
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
}

export function createInfographicTools(): PTTool[] {
  return [listTemplatesTool, infographicPreviewTool, renderInfographicTool]
}
