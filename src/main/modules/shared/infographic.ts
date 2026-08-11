import { Resvg } from '@resvg/resvg-js'

/**
 * In-process infographic engine. Renders an `@antv/infographic` design (a DSL
 * syntax string or a JSON options object) to an SVG string via the package's
 * node SSR entry (`@antv/infographic/ssr` → `renderToString`, which uses
 * `linkedom` for its DOM) and rasterizes it to a PNG buffer via
 * @resvg/resvg-js. Pure local rendering: no network calls (model-supplied
 * `icon`/`illus` fields are stripped — the offline renderer would otherwise
 * query a remote icon service), no CLI exec/spawn, no headless browser/apps.
 *
 * The SSR entry installs browser-like globals (`window`, `document`, DOM
 * classes, requestAnimationFrame) on `globalThis` and never restores them, so
 * this module snapshots and restores those globals around every render to keep
 * the host environment clean (the OpenAI SDK refuses to run in a
 * "browser-like" environment).
 */

export type InfographicTemplateCategory =
  'list' | 'sequence' | 'compare' | 'relation' | 'hierarchy' | 'chart' | 'word-cloud' | 'other'

export interface InfographicTemplateInfo {
  name: string
  category: InfographicTemplateCategory
  hint: string
}

/**
 * What gets passed to `renderToString`: either the model's DSL string or a
 * validated JSON options object. The allowed keys mirror `InfographicOptions`.
 */
export type InfographicRenderArgs = string | InfographicDesignObject

export interface InfographicDesignObject {
  template: string
  data: Record<string, unknown>
  theme?: string
  themeConfig?: Record<string, unknown>
  design?: unknown
  width?: number | string
  height?: number | string
}

export type InfographicValidationResult =
  | {
      ok: true
      template: string
      templateInfo: InfographicTemplateInfo
      renderArgs: InfographicRenderArgs
    }
  | { ok: false; error: string }

export interface InfographicSvgResult {
  svg: string
  template: string
}

/** Width in pixels the SVG is rasterized to (kept generous for pptx embedding). */
export const DEFAULT_INFOGRAPHIC_PIXEL_WIDTH = 1200
const PIXEL_WIDTH_MIN = 400
const PIXEL_WIDTH_MAX = 4000

interface SyntaxParseResult {
  options?: Partial<InfographicDesignObject> & { [k: string]: unknown }
  errors: { path: string; message: string; code?: string }[]
}

interface InfographicModule {
  renderToString: (options: InfographicRenderArgs) => Promise<string>
  getTemplates: () => string[]
  getTemplate: (name: string) => unknown
  parseSyntax: (input: string) => SyntaxParseResult
}

let infographicPromise: Promise<InfographicModule> | null = null

/** Lazily import the infographic package (ESM deps → always via dynamic import). */
function loadInfographic(): Promise<InfographicModule> {
  if (!infographicPromise) {
    infographicPromise = Promise.all([
      import('@antv/infographic/ssr'),
      import('@antv/infographic')
    ]).then(([ssr, main]) => {
      const ssrMod = ssr as { renderToString: (o: InfographicRenderArgs) => Promise<string> }
      const mainMod = main as unknown as {
        getTemplates: () => string[]
        getTemplate: (name: string) => unknown
        parseSyntax: (input: string) => SyntaxParseResult
      }
      return {
        renderToString: ssrMod.renderToString,
        getTemplates: mainMod.getTemplates,
        getTemplate: mainMod.getTemplate,
        parseSyntax: mainMod.parseSyntax
      }
    })
  }
  return infographicPromise
}

// ---- DOM global isolation (the ssr DOM shim installs these and never cleans up) ----

const DOM_GLOBAL_KEYS = [
  'window',
  'document',
  'DOMParser',
  'HTMLElement',
  'HTMLDivElement',
  'HTMLSpanElement',
  'HTMLImageElement',
  'HTMLCanvasElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'Element',
  'Node',
  'Text',
  'Comment',
  'DocumentFragment',
  'Document',
  'XMLSerializer',
  'MutationObserver',
  'SVGElement',
  'SVGSVGElement',
  'SVGGraphicsElement',
  'SVGGElement',
  'SVGPathElement',
  'SVGRectElement',
  'SVGCircleElement',
  'SVGTextElement',
  'SVGLineElement',
  'SVGPolygonElement',
  'SVGPolylineElement',
  'SVGEllipseElement',
  'SVGImageElement',
  'SVGDefsElement',
  'SVGUseElement',
  'SVGClipPathElement',
  'SVGLinearGradientElement',
  'SVGRadialGradientElement',
  'SVGStopElement',
  'SVGPatternElement',
  'SVGMaskElement',
  'SVGForeignObjectElement',
  'Image',
  'requestAnimationFrame',
  'cancelAnimationFrame'
] as const

const originalGlobals = new Map<string, unknown>()

function snapshotOriginalGlobals(): void {
  const g = globalThis as Record<string, unknown>
  for (const key of DOM_GLOBAL_KEYS) {
    if (!originalGlobals.has(key)) originalGlobals.set(key, g[key])
  }
}

function restoreOriginalGlobals(): void {
  const g = globalThis as Record<string, unknown>
  for (const key of DOM_GLOBAL_KEYS) {
    try {
      g[key] = originalGlobals.get(key)
    } catch {
      // Ignore read-only globals we never need to restore.
    }
  }
}

// ---- template catalog ----

const CATEGORY_HINTS: Record<InfographicTemplateCategory, string> = {
  list: 'A vertical/horizontal list or grid of labeled items (steps, features, milestones, todo lists).',
  sequence: 'An ordered sequence: steps, timeline, roadmap, snake, pyramid or funnel.',
  compare: 'A side-by-side comparison, quadrant or SWOT.',
  relation: 'A network / dependency graph of nodes connected by relations.',
  hierarchy: 'A tree or mindmap rooted at one node with nested children.',
  chart: 'A data chart (e.g. pie) driven by labeled values.',
  'word-cloud': 'A word cloud of weighted terms.',
  other: 'A general infographic layout.'
}

const CATEGORY_DATA: Record<InfographicTemplateCategory, string> = {
  list: 'data: { title?, lists: [{ label, desc?, value? }] }',
  sequence: 'data: { title?, sequences: [{ label, desc?, value? }] }',
  compare: 'data: { title?, compares: [{ label, desc?, value? }] }',
  relation: 'data: { nodes: [{ id, label }], relations: [{ from, to, label?, direction? }] }',
  hierarchy: 'data: { root: { label, children: [{ label, children? }] } }',
  chart: 'data: { values: [{ label, value }] }',
  'word-cloud': 'data: { lists: [{ label, value? }] }',
  other: 'data: { items: [{ label, desc?, value? }] }'
}

export function categoryOfName(name: string): InfographicTemplateCategory {
  if (name.startsWith('list-')) return 'list'
  if (name.startsWith('word-cloud')) return 'word-cloud'
  if (name.startsWith('sequence-')) return 'sequence'
  if (name.startsWith('compare-')) return 'compare'
  if (name.startsWith('relation-')) return 'relation'
  if (name.startsWith('hierarchy-')) return 'hierarchy'
  if (name.startsWith('chart-')) return 'chart'
  return 'other'
}

function templateInfoOf(name: string): InfographicTemplateInfo {
  const category = categoryOfName(name)
  return { name, category, hint: CATEGORY_HINTS[category] }
}

/** List every built-in template with its category + data hint (for the model). */
export async function listInfographicTemplates(): Promise<InfographicTemplateInfo[]> {
  const mod = await loadInfographic()
  return mod.getTemplates().map((name) => templateInfoOf(name))
}

export function templateDataHint(category: InfographicTemplateCategory): string {
  return CATEGORY_DATA[category]
}

export function templateCategoryHint(category: InfographicTemplateCategory): string {
  return CATEGORY_HINTS[category]
}

// ---- validation ----

const DATA_ARRAY_KEYS = ['items', 'lists', 'sequences', 'compares', 'nodes', 'values'] as const

function dataHasContent(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const obj = data as Record<string, unknown>
  if (obj.root && typeof obj.root === 'object') return true
  for (const key of DATA_ARRAY_KEYS) {
    const arr = obj[key]
    if (Array.isArray(arr) && arr.length > 0) return true
  }
  return false
}

/**
 * Remove `icon` / `illus` fields anywhere in the design/data so the offline
 * renderer never queries the package's remote icon service.
 */
function stripRemoteResources(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) stripRemoteResources(v)
    return
  }
  if (!value || typeof value !== 'object') return
  const obj = value as Record<string, unknown>
  delete obj.icon
  delete obj.illus
  for (const v of Object.values(obj)) stripRemoteResources(v)
}

function templateNameOfObject(o: Record<string, unknown>): string {
  return typeof o.template === 'string' && o.template.trim() ? o.template.trim() : ''
}

function templateNameOfDsl(dsl: string): string {
  const m = /^\s*infographic\s+([\w-]+)/m.exec(dsl)
  return m ? m[1] : ''
}

function buildDesignObject(o: Record<string, unknown>, template: string): InfographicDesignObject {
  const design = {
    template,
    data: (o.data && typeof o.data === 'object' ? o.data : {}) as Record<string, unknown>
  }
  for (const key of ['theme', 'themeConfig', 'design', 'width', 'height'] as const) {
    if (o[key] !== undefined) design[key] = o[key] as never
  }
  return design
}

/**
 * Validate a model-authored infographic design (DSL string or JSON options
 * object). Returns the normalized render args or a clear error.
 */
export async function validateInfographic(raw: unknown): Promise<InfographicValidationResult> {
  if (typeof raw === 'string') {
    const dsl = raw.trim()
    if (!dsl) return { ok: false, error: 'Infographic syntax is empty.' }
    const mod = await loadInfographic()
    const parsed = mod.parseSyntax(dsl)
    if (parsed.errors && parsed.errors.length > 0) {
      return {
        ok: false,
        error: `Invalid infographic syntax: ${parsed.errors
          .map((e) => e.message || e.code || e.path)
          .join('; ')}`
      }
    }
    const template = templateNameOfDsl(dsl)
    if (!template || !mod.getTemplate(template)) {
      return {
        ok: false,
        error: `Unknown infographic template "${template}". Start with "infographic <template>" using a template from list_infographic_templates.`
      }
    }
    const parsedOptions = (parsed.options ?? {}) as Record<string, unknown>
    if (!dataHasContent(parsedOptions.data)) {
      return {
        ok: false,
        error:
          'The infographic data block is empty. Add at least one item to the relevant data array (see the tool description).'
      }
    }
    // Normalize to the validated object form so icon/illus fields can be
    // stripped (the DSL form would otherwise trigger remote icon lookups).
    const design = buildDesignObject(parsedOptions, template)
    stripRemoteResources(design)
    return { ok: true, template, templateInfo: templateInfoOf(template), renderArgs: design }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error:
        'Infographic must be a DSL syntax string (starting with "infographic <template>") or a JSON design object with "template" and "data".'
    }
  }
  const o = raw as Record<string, unknown>
  const mod = await loadInfographic()
  const template = templateNameOfObject(o)
  if (!template || !mod.getTemplate(template)) {
    return {
      ok: false,
      error: `Unknown infographic template "${template}". Use a template from list_infographic_templates.`
    }
  }
  if (!dataHasContent(o.data)) {
    return {
      ok: false,
      error:
        'Infographic "data" must be a non-empty object with at least one item in a data array (items/lists/sequences/compares/nodes/values) or a "root" node.'
    }
  }
  const design = buildDesignObject(o, template)
  stripRemoteResources(design)
  return { ok: true, template, templateInfo: templateInfoOf(template), renderArgs: design }
}

// ---- rendering ----

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Render an infographic design to an SVG string (throws on invalid design). */
export async function renderInfographicSvg(
  renderArgs: InfographicRenderArgs
): Promise<InfographicSvgResult> {
  const mod = await loadInfographic()
  snapshotOriginalGlobals()
  let svg: string
  try {
    svg = await mod.renderToString(renderArgs)
  } finally {
    restoreOriginalGlobals()
  }
  const template =
    typeof renderArgs === 'string' ? templateNameOfDsl(renderArgs) : renderArgs.template
  return { svg, template }
}

/** Read the intrinsic SVG size from its width/height attributes (fallback viewBox). */
export function svgBounds(svg: string): { width: number; height: number } {
  const attrs = /<svg[^>]*\s(width|height)="([0-9.]+)"[^>]*\s(width|height)="([0-9.]+)"/.exec(svg)
  if (attrs) {
    const a = Number(attrs[2])
    const b = Number(attrs[4])
    const width = attrs[1] === 'width' ? a : b
    const height = attrs[1] === 'width' ? b : a
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height }
    }
  }
  const vb = /viewBox=["']([^"']+)["']/.exec(svg)
  if (vb) {
    const parts = vb[1].split(/[\s,]+/).map(Number)
    const w = parts[2]
    const h = parts[3]
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: w, height: h }
    }
  }
  return { width: DEFAULT_INFOGRAPHIC_PIXEL_WIDTH, height: 600 }
}

/**
 * The SSR export prepends `<?xml …?>` / `<?xml-stylesheet …?>` processing
 * instructions (remote font CSS). They are irrelevant to rasterization — strip
 * them so Resvg parses a clean SVG document.
 */
export function stripXmlProcessingInstructions(svg: string): string {
  return svg.replace(/^\s*(<\?xml[^>]*\?>\s*|<\?xml-stylesheet[^>]*\?>\s*)+/, '')
}

// ---- foreignObject → <text> conversion (Resvg/usvg drops <foreignObject>) ----

/**
 * Parse an HTML inline style attribute into a declaration map.
 *
 * The `@antv/infographic` SSR renders every piece of text as an HTML `<span>`
 * styled with inline CSS (font-size, font-weight, color, and flex alignment)
 * and places it inside an SVG `<foreignObject>`. Resvg/usvg does not support
 * `<foreignObject>` and silently drops it, so text disappears from rasterized
 * PNGs. We rewrite those elements into plain SVG `<text>` nodes before
 * rasterization, approximating the span's CSS layout:
 *
 * - `justify-content` / `text-align` → `text-anchor` + `x`
 * - `align-items` / `align-content` → baseline `y`
 * - `font-size`, `font-weight`, `color` → font-size / font-weight / fill
 * - flex wrapping → word-wrapped `<tspan>` lines with the span's `line-height`
 */
function parseInlineStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of style.split(';')) {
    const m = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(decl)
    if (m) out[m[1].toLowerCase()] = m[2]
  }
  return out
}

/** Decode HTML entities to raw characters (the span content is entity-encoded). */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function numAttr(attrs: string, name: string): number | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([0-9.+-]+)"`).exec(attrs)
  return m ? Number(m[1]) : undefined
}

/** Approximate per-glyph width (in em) for rough flex-wrap emulation. */
function glyphEm(ch: string): number {
  if (ch === ' ') return 0.3
  if (/[MW@mw]/.test(ch)) return 0.8
  if (/[A-Z0-9]/.test(ch)) return 0.62
  if (/[iIljt.,'|!:;]/.test(ch)) return 0.32
  return 0.5
}

/** Approximate word-wrapping to mimic the span's `flex-wrap: wrap`. */
function wrappedLines(text: string, fontSize: number, boxWidth: number): string[] {
  if (!boxWidth || boxWidth <= 0) return text ? [text] : []
  const width = (s: string): number => [...s].reduce((acc, ch) => acc + glyphEm(ch), 0) * fontSize
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  let curW = 0
  for (const w of words) {
    const wWidth = width(w)
    const sep = cur ? width(' ') : 0
    if (!cur || curW + sep + wWidth <= boxWidth) {
      cur += (cur ? ' ' : '') + w
      curW += sep + wWidth
    } else {
      lines.push(cur)
      cur = w
      curW = wWidth
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/**
 * Replace every `<foreignObject>` text block with an equivalent SVG `<text>`
 * element so Resvg can render it. Returns the rasterization-only SVG string.
 */
export function replaceForeignObjectText(svg: string): string {
  if (!svg.includes('<foreignObject')) return svg
  return svg.replace(
    /<foreignObject\b([^>]*)>([\s\S]*?)<\/foreignObject>/g,
    (_block, attrs, inner) => {
      const span = /<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(inner)
      if (!span) return ''
      const styleMatch = /<span\b[^>]*style="([^"]*)"/i.exec(inner)
      const style = parseInlineStyle(styleMatch?.[1] ?? '')

      const boxX = numAttr(attrs, 'x') ?? 0
      const boxY = numAttr(attrs, 'y') ?? 0
      const boxW = numAttr(attrs, 'width') ?? 0
      const boxH = numAttr(attrs, 'height') ?? 0

      const fontSize = Number.parseFloat(style['font-size'] ?? '14') || 14
      const fontWeight = /^(bold|bolder|500|600|700|800|900)$/.test(style['font-weight'] ?? '')
        ? 'font-weight="bold" '
        : ''
      const color = style.color || '#262626'
      const lineHeight = (Number.parseFloat(style['line-height'] ?? '1.4') || 1.4) * fontSize

      const justify = (style['justify-content'] ?? '').toLowerCase()
      const textAlign = (style['text-align'] ?? 'left').toLowerCase()
      const align = (style['align-items'] ?? style['align-content'] ?? 'flex-start').toLowerCase()

      let anchor: string
      let anchorX: number
      const hCenter = justify.includes('center') || textAlign === 'center'
      const hEnd = justify.includes('flex-end') || justify.includes('end') || textAlign === 'right'
      if (hCenter) {
        anchor = 'middle'
        anchorX = boxX + boxW / 2
      } else if (hEnd) {
        anchor = 'end'
        anchorX = boxX + boxW
      } else {
        anchor = 'start'
        anchorX = boxX
      }

      const text = decodeHtmlEntities(span[1].replace(/[\t\r\n]+/g, ' ').trim())
      const lines = wrappedLines(text, fontSize, boxW)
      const blockH = lines.length * lineHeight
      const contentTop = align.includes('center')
        ? boxY + Math.max(0, (boxH - blockH) / 2)
        : align.includes('flex-end') || align.includes('end')
          ? boxY + Math.max(0, boxH - blockH)
          : boxY
      const ascent = fontSize * 0.8
      const tspans = lines
        .map((l, i) => {
          const lineY = contentTop + ascent + i * lineHeight
          return i === 0
            ? escapeXml(l)
            : `<tspan x="${anchorX}" y="${lineY}">${escapeXml(l)}</tspan>`
        })
        .join('')
      const firstY = contentTop + ascent

      return `<text x="${anchorX}" y="${firstY}" fill="${escapeXml(color)}" font-size="${fontSize}" text-anchor="${anchor}" ${fontWeight}>${tspans}</text>`
    }
  )
}

/**
 * Rasterize an infographic SVG string to a PNG buffer.
 *
 * The `@antv/infographic` SSR encodes text as HTML inside `<foreignObject>`
 * elements, which Resvg/usvg does not render. `replaceForeignObjectText` turns
 * those into real `<text>` nodes first so the PNG contains the labels.
 */
export function svgToPng(svg: string, pixelWidth = DEFAULT_INFOGRAPHIC_PIXEL_WIDTH): Buffer {
  const width = clamp(Math.floor(pixelWidth), PIXEL_WIDTH_MIN, PIXEL_WIDTH_MAX)
  const resvg = new Resvg(stripXmlProcessingInstructions(replaceForeignObjectText(svg)), {
    fitTo: { mode: 'width', value: width }
  })
  return resvg.render().asPng()
}

/** One-shot in-process render: validate-free (assumes validated args) → SVG + PNG + bounds. */
export async function renderInfographicPng(
  renderArgs: InfographicRenderArgs,
  pixelWidth = DEFAULT_INFOGRAPHIC_PIXEL_WIDTH
): Promise<{ svg: string; png: Buffer; template: string; width: number; height: number }> {
  const res = await renderInfographicSvg(renderArgs)
  const bounds = svgBounds(res.svg)
  const png = svgToPng(res.svg, pixelWidth)
  return { svg: res.svg, png, template: res.template, width: bounds.width, height: bounds.height }
}
