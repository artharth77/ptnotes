import { createCanvas } from '@napi-rs/canvas'
import { Chart } from 'chart.js/auto'

/**
 * In-process chart engine. Draws a Chart.js chart onto a Skia canvas via
 * @napi-rs/canvas and rasterizes it to a PNG buffer. Pure local rendering: no
 * network calls, no CLI exec/spawn, no headless browser/apps. Chart.js owns all
 * axis/scale/layout math, so the model only supplies data and options.
 */

export type ChartType =
  'bar' | 'line' | 'pie' | 'doughnut' | 'radar' | 'polarArea' | 'scatter' | 'bubble'

export type ChartDataPoint = number | { x: number; y: number } | { x: number; y: number; r: number }

export interface ChartDatasetInput {
  label?: string
  data?: unknown[]
  [key: string]: unknown
}

export interface ChartDesign {
  type?: ChartType | string
  data?: { labels?: unknown[]; datasets?: ChartDatasetInput[] }
  options?: Record<string, unknown>
  width?: number
  height?: number
}

export type ChartValidationResult = { ok: true; design: ChartDesign } | { ok: false; error: string }

const CHART_TYPES: ChartType[] = [
  'bar',
  'line',
  'pie',
  'doughnut',
  'radar',
  'polarArea',
  'scatter',
  'bubble'
]
const PIE_TYPES: ChartType[] = ['pie', 'doughnut', 'polarArea']

const MAX_DATASETS = 10
const MAX_POINTS = 500
const MAX_PIE_POINTS = 50
const MAX_OPTIONS_LEN = 100_000

export const DEFAULT_CHART_W = 1200
export const DEFAULT_CHART_H = 675
const SIZE_MIN = 120
const SIZE_MAX = 4000

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function sizeOf(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? Math.floor(raw) : Number.NaN
  return Number.isFinite(n) ? clamp(n, SIZE_MIN, SIZE_MAX) : fallback
}

/**
 * Validate a model-authored chart design. Returns the normalized design
 * (clamped size, fixed type casing, kept datasets) or a clear error.
 */
export function validateChart(raw: unknown): ChartValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Chart must be a JSON object with a "type" and "data".' }
  }
  const d = raw as ChartDesign

  const type = typeof d.type === 'string' ? d.type.toLowerCase() : ''
  if (!CHART_TYPES.includes(type as ChartType)) {
    return {
      ok: false,
      error: `Unknown chart type "${type}". Must be one of: ${CHART_TYPES.join(', ')}.`
    }
  }
  const chartType = type as ChartType

  const data = d.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Chart needs a "data" object with a non-empty "datasets" array.' }
  }

  const datasets = Array.isArray(data.datasets) ? data.datasets : []
  if (datasets.length === 0) {
    return { ok: false, error: 'Chart "data.datasets" must be a non-empty array.' }
  }
  if (datasets.length > MAX_DATASETS) {
    return { ok: false, error: `Chart has more than ${MAX_DATASETS} datasets.` }
  }

  const isPointPair = chartType === 'scatter' || chartType === 'bubble'
  const pointLimit = PIE_TYPES.includes(chartType) ? MAX_PIE_POINTS : MAX_POINTS
  for (const ds of datasets) {
    if (!ds || typeof ds !== 'object' || Array.isArray(ds)) {
      return { ok: false, error: 'Each dataset must be an object with a "data" array.' }
    }
    const arr = Array.isArray(ds.data) ? ds.data : []
    if (arr.length === 0) {
      return {
        ok: false,
        error: `Dataset "${typeof ds.label === 'string' && ds.label ? ds.label : ''}" needs a non-empty "data" array.`
      }
    }
    if (arr.length > pointLimit) {
      return {
        ok: false,
        error: `Dataset "${typeof ds.label === 'string' && ds.label ? ds.label : ''}" has more than ${pointLimit} points.`
      }
    }
    for (const v of arr) {
      if (isPointPair) {
        if (v && typeof v === 'object') {
          const x = (v as { x?: unknown }).x
          const y = (v as { y?: unknown }).y
          if (typeof x !== 'number' || typeof y !== 'number') {
            return { ok: false, error: 'Scatter/bubble points need numeric "x" and "y".' }
          }
        } else {
          return {
            ok: false,
            error: 'Scatter/bubble points must be { x, y } (or { x, y, r }) objects.'
          }
        }
      } else if (typeof v !== 'number' || Number.isNaN(v)) {
        return { ok: false, error: 'Chart data points must be numbers.' }
      }
    }
  }

  const options =
    d.options && typeof d.options === 'object' && !Array.isArray(d.options) ? d.options : undefined
  if (options) {
    let len = 0
    try {
      len = JSON.stringify(options).length
    } catch {
      return { ok: false, error: 'Chart "options" must be JSON-serializable.' }
    }
    if (len > MAX_OPTIONS_LEN) {
      return { ok: false, error: `Chart "options" is too large (max ${MAX_OPTIONS_LEN} chars).` }
    }
  }

  return {
    ok: true,
    design: {
      type: chartType,
      data: {
        labels: Array.isArray(data.labels) ? data.labels : undefined,
        datasets
      },
      options,
      width: sizeOf(d.width, DEFAULT_CHART_W),
      height: sizeOf(d.height, DEFAULT_CHART_H)
    }
  }
}

/** Rasterize a validated chart design to a PNG buffer (throws on failure). */
export function renderChartPng(
  design: ChartDesign,
  size?: { width?: number; height?: number }
): Buffer {
  const width = clamp(
    Math.floor(size?.width ?? design.width ?? DEFAULT_CHART_W),
    SIZE_MIN,
    SIZE_MAX
  )
  const height = clamp(
    Math.floor(size?.height ?? design.height ?? DEFAULT_CHART_H),
    SIZE_MIN,
    SIZE_MAX
  )

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const chart = new Chart(
    ctx as never,
    {
      type: design.type,
      data: design.data,
      options: {
        responsive: false,
        animation: false,
        devicePixelRatio: 1,
        ...(design.options ?? {})
      }
    } as never
  )
  try {
    chart.render()
    return canvas.toBuffer('image/png')
  } finally {
    chart.destroy()
  }
}

export function chartPointCount(design: ChartDesign): number {
  let total = 0
  for (const ds of design.data?.datasets ?? []) {
    total += Array.isArray(ds.data) ? ds.data.length : 0
  }
  return total
}
