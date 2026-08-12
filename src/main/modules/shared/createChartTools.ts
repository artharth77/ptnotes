import { promises as fs } from 'fs'
import type { PTTool, ToolContext } from '../../ai/tools'
import {
  chartPointCount,
  DEFAULT_CHART_H,
  DEFAULT_CHART_W,
  validateChart,
  type ChartDesign
} from './chart'
import { renderChartIsolated } from './chartRenderer'
import { slugify } from '@shared/slug'

/**
 * Shared in-process chart tools any module can opt into via
 * `tools: [...createChartTools(), ...]`. Rendering is pure local (Chart.js onto
 * @napi-rs/canvas in the main process): no network, no CLI exec/spawn, no
 * headless browser/apps. The runner already merges `module.tools`, so no
 * framework changes are needed to share them.
 */
export function createChartTools(): PTTool[] {
  return [chartPreviewTool, renderChartTool]
}

function parseChart(args: Record<string, unknown>): { raw: unknown; error?: string } {
  let raw = args.chart
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return { raw: null, error: '"chart" must be a JSON object or a JSON string.' }
    }
  }
  return { raw }
}

function outputSizeOf(args: Record<string, unknown>, key: string): number | undefined {
  const n = Number(args[key])
  return Number.isFinite(n) && n >= 120 && n <= 4000 ? Math.floor(n) : undefined
}

function chartSummary(
  design: ChartDesign,
  size?: { width?: number; height?: number }
): { chartType: string; width: number; height: number; datasetCount: number; pointCount: number } {
  return {
    chartType: design.type as string,
    width: size?.width ?? design.width ?? DEFAULT_CHART_W,
    height: size?.height ?? design.height ?? DEFAULT_CHART_H,
    datasetCount: (design.data?.datasets ?? []).length,
    pointCount: chartPointCount(design)
  }
}

const CHART_SCHEMA_HINT =
  'chart design JSON: { "type": "bar"|"line"|"pie"|"doughnut"|"radar"|"polarArea"|"scatter"|"bubble", "data": { "labels"?: string[], "datasets": [{ "label"?, "data": number[] (or { x, y } pairs for scatter/bubble) }] }, "options"?: Chart.js options, "width"?: px, "height"?: px }'

/** Dry-run layout preview: validates + renders the chart in memory, writes nothing. */
const chartPreviewTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'chart_preview',
      description: `Preview a Chart.js data chart WITHOUT creating any files. Pass the chart design (type, labels, datasets) and optionally "outWidth"/"outHeight" in pixels. Renders in-memory and returns the chart type, canvas size, dataset and point counts so you can sanity-check before calling render_chart. Local, in-process, deterministic.`,
      parameters: {
        type: 'object',
        properties: {
          chart: { type: 'object', description: CHART_SCHEMA_HINT },
          outWidth: {
            type: 'number',
            description:
              'Raster width in pixels for the in-memory preview (default from the chart JSON).'
          },
          outHeight: {
            type: 'number',
            description:
              'Raster height in pixels for the in-memory preview (default from the chart JSON).'
          }
        },
        required: ['chart']
      }
    }
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const { raw, error } = parseChart(args)
    if (error) return JSON.stringify({ ok: false, error })
    const checked = validateChart(raw)
    if (!checked.ok) return JSON.stringify(checked)
    const size = {
      width: outputSizeOf(args, 'outWidth') ?? checked.design.width,
      height: outputSizeOf(args, 'outHeight') ?? checked.design.height
    }
    try {
      await renderChartIsolated(checked.design, size)
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: `Could not render the chart preview: ${err instanceof Error ? err.message : String(err)}`
      })
    }
    return JSON.stringify({ ok: true, ...chartSummary(checked.design, size) })
  }
}

/** Render a chart to a temporary PNG + JSON pair in <project>/modules/temp/. */
const renderChartTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'render_chart',
      description: `Render a Chart.js data chart to temporary rasterized files in the project. Pure local rendering — NO network, CLI tools, or headless browser. Writes "<project>/modules/temp/<slug>.png" and ".json" (temp files that are deleted automatically once the final deck is built) and returns their absolute paths plus the canvas size. Use chart_preview to sanity-check first. The returned "png" path can be embedded on a "chart" slide via create_pptx_file.`,
      parameters: {
        type: 'object',
        properties: {
          chart: { type: 'object', description: CHART_SCHEMA_HINT },
          filename: {
            type: 'string',
            description:
              'Suggested output stem (PNG/JSON share it). Defaults to the chart type + "chart", e.g. "bar-chart".'
          },
          outWidth: {
            type: 'number',
            description:
              'Raster width in pixels for the PNG (default from the chart JSON, usually 1200).'
          },
          outHeight: {
            type: 'number',
            description:
              'Raster height in pixels for the PNG (default from the chart JSON, usually 675).'
          }
        },
        required: ['chart']
      }
    }
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const project =
      typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : ctx.activeProject

    const { raw, error } = parseChart(args)
    if (error) return JSON.stringify({ ok: false, error })
    const checked = validateChart(raw)
    if (!checked.ok) return JSON.stringify(checked)
    const size = {
      width: outputSizeOf(args, 'outWidth') ?? checked.design.width,
      height: outputSizeOf(args, 'outHeight') ?? checked.design.height
    }

    let png: Buffer
    try {
      png = await renderChartIsolated(checked.design, size)
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: `Could not render the chart: ${err instanceof Error ? err.message : String(err)}`
      })
    }

    let stem = String(args.filename || '')
    if (!stem.trim()) stem = `${String(checked.design.type ?? 'chart')}-chart`
    stem = slugify(stem.replace(/\.(png|json)$/i, '')) || 'chart'

    let pngPath = ''
    let jsonPath = ''
    try {
      const outPath = await ctx.service.uniqueModuleTempPath(project, `${stem}.png`)
      pngPath = outPath
      jsonPath = outPath.replace(/\.png$/, '.json')

      const summary = chartSummary(checked.design, size)
      const meta = {
        chartType: checked.design.type,
        width: summary.width,
        height: summary.height,
        datasetCount: summary.datasetCount,
        pointCount: summary.pointCount
      }

      await fs.writeFile(pngPath, png)
      await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'utf8')

      return JSON.stringify({ ok: true, project, png: pngPath, json: jsonPath, ...summary })
    } catch (err) {
      for (const p of [pngPath, jsonPath].filter(Boolean)) {
        await fs.unlink(p).catch(() => {})
      }
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
}
