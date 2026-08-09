import type { PTTool } from '../../ai/tools'
import { getLucideIconSvg, lucideIconPngDataUri, searchLucideIcons, tagsOf } from './lucideIcons'

/**
 * Shared Lucide icon tools any module can opt into via `tools: [...createLucideIconTools(), ...]`.
 * The runner already merges `module.tools`, so no framework changes are needed to share them.
 */
export function createLucideIconTools(): PTTool[] {
  return [searchLucideIconsTool, getLucideIconTool]
}

const searchLucideIconsTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_lucide_icons',
      description:
        'Search the Lucide open-source SVG icon library by keyword(s) and return matching icon names (canonical kebab-case, e.g. "rocket", "trending-up"). Use the returned name wherever a module needs an icon — e.g. the "icon" field of a slide design or the "name" argument of get_lucide_icon.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Keyword describing the icon you want, e.g. "chart", "arrow right", "phone".'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default 20).'
          }
        },
        required: ['query']
      }
    }
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const query = typeof args.query === 'string' ? args.query : ''
    const rawLimit = Number(args.limit)
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 20
    const results = searchLucideIcons(query, limit)
    return JSON.stringify({
      ok: true,
      query,
      count: results.length,
      results
    })
  }
}

const getLucideIconTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'get_lucide_icon',
      description:
        'Resolve a single Lucide icon by its canonical name. Defaults to returning the raw SVG string (small, ~1KB) so you can embed it directly. Use format "png" only when you need a rasterized image (returns a PNG data URI); specify color for the stroke color and size for the render size. Unknown names return an error — search_lucide_icons first.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Canonical Lucide icon name, e.g. "rocket", "check-circle".'
          },
          format: {
            type: 'string',
            enum: ['svg', 'png'],
            description: 'Return the icon as an SVG string (default) or as a PNG data URI.'
          },
          color: {
            type: 'string',
            description: 'Hex stroke color, e.g. "#ED7D31" (defaults to near-black).'
          },
          sizePx: {
            type: 'number',
            description: 'Raster resolution for format "png" (default 256).'
          }
        },
        required: ['name']
      }
    }
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const name = typeof args.name === 'string' ? args.name.trim() : ''
    if (!name) return JSON.stringify({ ok: false, error: 'get_lucide_icon requires a "name".' })
    const format = args.format === 'png' ? 'png' : 'svg'
    const sizePx = Number(args.sizePx)
    const opts = {
      color: typeof args.color === 'string' ? args.color : undefined,
      sizePx: Number.isInteger(sizePx) && sizePx > 0 ? sizePx : undefined
    }

    if (format === 'png') {
      const png = lucideIconPngDataUri(name, opts)
      if (!png.ok) return JSON.stringify(png)
      return JSON.stringify({
        ok: true,
        name: png.name,
        format: 'png',
        sizePx: opts.sizePx ?? 256,
        dataUri: png.dataUri,
        bytes: png.bytes,
        tags: tagsOf(png.name)
      })
    }

    const svg = getLucideIconSvg(name, opts.color)
    if (!svg.ok) return JSON.stringify(svg)
    return JSON.stringify({
      ok: true,
      name: svg.name,
      format: 'svg',
      svg: svg.svg,
      tags: tagsOf(svg.name)
    })
  }
}
