import { promises as fs } from 'fs'
import type { PTTool, ToolContext } from '../../ai/tools'
import { renderDiagramIsolated } from './diagramRenderer'
import { slugify } from '@shared/slug'

/**
 * Shared in-process mermaid diagram tools any module can opt into via
 * `tools: [...createDiagramTools(), ...]`. Rendering is pure local (mermaid onto
 * a jsdom/svgdom DOM shim + @resvg/resvg-js in an isolated utility process): no
 * network, no CLI exec/spawn, no headless browser. The runner already merges
 * `module.tools`, so no framework changes are needed to share them.
 */

const MERMAID_DIAGRAM_TYPES =
  'flowchart (TD or LR), sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, pie, gantt'

function diagramOf(args: Record<string, unknown>): { src: string; error?: string } {
  const raw = args.diagram
  if (typeof raw === 'string' && raw.trim()) return { src: raw.trim() }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    if (typeof obj.source === 'string' && obj.source.trim()) return { src: obj.source.trim() }
    if (typeof obj.code === 'string' && obj.code.trim()) return { src: obj.code.trim() }
    if (typeof obj.text === 'string' && obj.text.trim()) return { src: obj.text.trim() }
  }
  return { src: '', error: '"diagram" must be a non-empty mermaid source string.' }
}

function pixelWidthOf(args: Record<string, unknown>): number | undefined {
  const n = Number(args.pixelWidth)
  return Number.isFinite(n) && n >= 400 && n <= 4000 ? Math.floor(n) : undefined
}

function diagramMeta(out: {
  diagramType: string
  width: number
  height: number
  png?: Buffer
  svg?: string
}): { diagramType: string; width: number; height: number } {
  return {
    diagramType: out.diagramType,
    width: out.width,
    height: out.height
  }
}

/** Dry-run render preview: validates + renders in memory, writes nothing. */
const diagramPreviewTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'diagram_preview',
      description: `Preview a mermaid diagram WITHOUT creating any files. Pass the diagram source as mermaid DSL (${MERMAID_DIAGRAM_TYPES}). Renders in-memory and returns the diagram type, width and height so you can sanity-check before calling render_diagram. Local, in-process, deterministic (no network, no headless browser).`,
      parameters: {
        type: 'object',
        properties: {
          diagram: {
            type: 'string',
            description:
              'The mermaid diagram source text, e.g. `"flowchart TD\\n  A[Start] --> B{Decision}\\n  B --> C[OK]"` or `"sequenceDiagram\\n  Alice->>Bob: Hi"`.'
          },
          pixelWidth: {
            type: 'number',
            description:
              'Raster width in pixels for the in-memory preview (default 1600; clamped 400-4000).'
          }
        },
        required: ['diagram']
      }
    }
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const { src, error } = diagramOf(args)
    if (error) return JSON.stringify({ ok: false, error })
    try {
      const out = await renderDiagramIsolated(src, pixelWidthOf(args))
      return JSON.stringify({ ok: true, ...diagramMeta(out) })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: `Could not render the diagram: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }
}

/** Render a mermaid diagram to temporary SVG + PNG + JSON files in the project. */
const renderDiagramTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'render_diagram',
      description:
        `Render a mermaid diagram to temporary rasterized files in the project. Pure local rendering — NO network, CLI tools, or headless browser. Writes "<project>/modules/temp/<slug>.png", ".svg" and ".json" (temp files that are deleted automatically once the final deck is built) and returns their absolute paths plus the diagram type and size. Use diagram_preview to sanity-check first. The returned "png" path can be embedded on a "diagram" slide via create_pptx_file.` +
        ` Supported diagram types: ${MERMAID_DIAGRAM_TYPES}. Labels must stay SVG text (no HTML labels).`,
      parameters: {
        type: 'object',
        properties: {
          diagram: {
            type: 'string',
            description:
              'The mermaid diagram source text, e.g. `"flowchart LR\\n  A[Parse] --> B[Render]\\n  B --> C[Embed]"`.'
          },
          filename: {
            type: 'string',
            description: 'Suggested output stem (PNG/SVG/JSON share it). Defaults to "diagram".'
          },
          pixelWidth: {
            type: 'number',
            description: 'Raster width in pixels for the PNG (default 1600; clamped 400-4000).'
          }
        },
        required: ['diagram']
      }
    }
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const project =
      typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : ctx.activeProject

    const { src, error } = diagramOf(args)
    if (error) return JSON.stringify({ ok: false, error })

    let out: { svg: string; png: Buffer; diagramType: string; width: number; height: number }
    try {
      out = await renderDiagramIsolated(src, pixelWidthOf(args))
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: `Could not render the diagram: ${err instanceof Error ? err.message : String(err)}`
      })
    }

    let stem = String(args.filename || '')
    if (!stem.trim()) stem = 'diagram'
    stem = slugify(stem.replace(/\.(png|svg|json)$/i, '')) || 'diagram'

    let pngPath = ''
    let svgPath = ''
    let jsonPath = ''
    try {
      const outPath = await ctx.service.uniqueModuleTempPath(project, `${stem}.png`)
      pngPath = outPath
      svgPath = outPath.replace(/\.png$/, '.svg')
      jsonPath = outPath.replace(/\.png$/, '.json')

      const meta = {
        kind: 'diagram',
        diagramType: out.diagramType,
        width: out.width,
        height: out.height
      }

      await fs.writeFile(pngPath, out.png)
      await fs.writeFile(svgPath, out.svg, 'utf8')
      await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'utf8')

      const summary = diagramMeta(out)
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

export function createDiagramTools(): PTTool[] {
  return [diagramPreviewTool, renderDiagramTool]
}
