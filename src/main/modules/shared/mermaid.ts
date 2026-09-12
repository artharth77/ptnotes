import { existsSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { Resvg } from '@resvg/resvg-js'

/**
 * In-process mermaid diagram engine. Renders a mermaid DSL source string to an
 * SVG via the jsdom/svgdom DOM shim (isomorphic-mermaid) and rasterizes it to a
 * PNG buffer via @resvg/resvg-js. Pure local rendering: no network calls, no
 * CLI exec/spawn, no headless browser/apps. Mermaid owns all layout / edge
 * routing / shape math, so the model only supplies the diagram source text.
 *
 * Mermaid is ESM-only, so the DOM-shimmed instance is always loaded via dynamic
 * `import()` (works from the CJS main bundle, worker bundles and the tsx test
 * runner alike).
 */

export type MermaidDiagramType =
  'flowchart' | 'sequence' | 'stateDiagram-v2' | 'classDiagram' | 'erDiagram' | 'pie' | 'gantt'

const SUPPORTED_TYPES: MermaidDiagramType[] = [
  'flowchart',
  'sequence',
  'stateDiagram-v2',
  'classDiagram',
  'erDiagram',
  'pie',
  'gantt'
]

export type MermaidValidationResult =
  { ok: true; diagramType: string } | { ok: false; error: string }

export interface MermaidSvgResult {
  svg: string
  diagramType: string
}

/** Width in pixels the SVG is rasterized to (kept generous for pptx embedding). */
export const DEFAULT_DIAGRAM_PIXEL_WIDTH = 1600

/** Bitmap-critical font: svgdom's bundled fallback (see LABEL normalization). */
const FONT_FAMILY = 'Open Sans'
const FONT_FILE = 'fonts/OpenSans-Regular.ttf'
const PIXEL_WIDTH_MIN = 400
const PIXEL_WIDTH_MAX = 4000

interface MermaidModule {
  parse(src: string): Promise<{ diagramType: string }>
  render(id: string, src: string): Promise<MermaidSvgResult>
  initialize(config: Record<string, unknown>): void
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Absolute path of the Open Sans TTF svgdom bundles (its metric fallback), for
 * handing the identical font to @resvg/resvg-js. In packaged builds the file
 * lives inside the asar archive, which native code cannot read — it points at
 * the `app.asar.unpacked` copy produced by electron-builder's asarUnpack.
 */
function svgdomFontFile(): string | null {
  try {
    const req = createRequire(join(process.cwd(), 'package.json'))
    const file = join(dirname(req.resolve('svgdom')), FONT_FILE)
    const unpacked = file.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    if (existsSync(unpacked)) return unpacked
    return existsSync(file) ? file : null
  } catch {
    return null
  }
}

let resvgFontOptions: Record<string, unknown> | null = null
let embeddedFontFace: string | null = null

function getResvgFontOptions(): Record<string, unknown> {
  if (!resvgFontOptions) {
    const fontFile = svgdomFontFile()
    resvgFontOptions = fontFile
      ? { font: { fontFiles: [fontFile], defaultFontFamily: FONT_FAMILY } }
      : {}
  }
  return resvgFontOptions
}

/**
 * The renderer machine may not have our label font installed, so the editor's
 * `<img>` preview falls back to a generic font. Embed the same TTF svgdom uses
 * as a data-URI `@font-face` into the SVG's `<style>` so every consumer
 * renders with the exact glyphs the geometry was laid out for (resvg ignores
 * it — it gets the font via `fontFiles` — and data URIs are allowed inside
 * SVG-as-image where external fetches are not).
 */
function embeddedFontCss(): string {
  const remember = (css: string): string => {
    embeddedFontFace = css
    return css
  }
  if (embeddedFontFace) return embeddedFontFace
  const fontFile = svgdomFontFile()
  if (!fontFile) return remember('')
  try {
    const base64 = readFileSync(fontFile).toString('base64')
    return remember(
      `@font-face{font-family:'${FONT_FAMILY}';src:url(data:font/ttf;base64,${base64}) format('truetype');}`
    )
  } catch {
    return remember('')
  }
}

/** Prepend the embedded font-face rule to the SVG's own `<style>` block. */
function embedDiagramFont(svg: string): string {
  const css = embeddedFontCss()
  if (!css || !/<style>/.test(svg)) return svg
  return svg.replace(/<style>/, (m) => m + css)
}

/**
 * Mermaid 11 requires a global CSSStyleSheet (it compiles theme CSS into one).
 * Neither svgdom nor jsdom expose it, so provide a minimal conformant shim.
 */
function installCssStyleSheetPolyfill(): void {
  const g = globalThis as Record<string, unknown>
  if (typeof g.CSSStyleSheet === 'function') return
  class CssRule {
    cssText: string
    constructor(cssText: string) {
      this.cssText = cssText
    }
  }
  class CssStyleSheet {
    cssRules: CssRule[] = []
    insertRule(css: string, index = this.cssRules.length): number {
      this.cssRules.splice(index, 0, new CssRule(css))
      return index
    }
    replaceSync(css: string): void {
      this.cssRules = css
        ? css.split(/\n(?=[^{}]*\{)/).map((ruleText) => new CssRule(ruleText))
        : []
    }
    deleteRule(index: number): void {
      this.cssRules.splice(index, 1)
    }
  }
  g.CSSStyleSheet = CssStyleSheet
  g.CSSRule = CssRule
}

let mermaidPromise: Promise<MermaidModule> | null = null
let renderCounter = 0

/**
 * Mermaid's gantt diagram reads `elem.parentElement.offsetWidth` to size the
 * timeline. svgdom (the DOM shim) has no `parentElement` property at all, so
 * that access throws before the `useWidth` fallback can run. Add a minimal
 * `parentElement` getter (delegating to svgdom's existing `parentNode`) on the
 * shared Node prototype; `offsetWidth` then simply returns undefined (no
 * layout in svgdom), which mermaid handles by falling back to its fixed width.
 */
function installParentElementPolyfill(): void {
  const g = globalThis as Record<string, unknown>
  const doc = g.document as { createElement?: (t: string) => unknown } | undefined
  if (!doc?.createElement) return
  const probe = doc.createElement('div')
  if (!probe || typeof probe !== 'object') return
  let proto = Object.getPrototypeOf(probe)
  while (proto && !('parentNode' in proto)) {
    const next = Object.getPrototypeOf(proto)
    if (!next || next === Object.prototype) break
    proto = next
  }
  if (!proto || Object.getOwnPropertyDescriptor(proto, 'parentElement')) return
  Object.defineProperty(proto, 'parentElement', {
    configurable: true,
    get(this: { parentNode?: unknown }): unknown {
      return this.parentNode ?? null
    }
  })
}

/** Font size from the theme `<style>` of the document the element lives in. */
function textFontPxFrom(el: SvgNodeLike): number {
  let node: SvgNodeLike | null | undefined = el
  while (node) {
    if (String(node.tagName ?? '').toLowerCase() === 'svg') {
      const styleEl = node.querySelector?.('style') as SvgNodeLike | null
      const text = styleEl?.textContent ?? ''
      const m = /font-size:\s*([\d.]+)px/.exec(text)
      return m ? Number(m[1]) : 16
    }
    node = node.parentNode
  }
  return 16
}

/** Resolve `<attr>` like `-0.1em` / `1em` / `42` (em against the theme font size). */
function resolveLengthPx(token: string | null, fontPx: number, fallback = 0): number {
  if (token == null) return fallback
  const m = /^\s*(-?[\d.]+)em/.exec(token)
  if (m) return Number(m[1]) * fontPx
  const v = Number(token)
  return Number.isFinite(v) ? v : fallback
}

function installTextBBoxPolyfill(): void {
  const doc = svgDoc()
  if (!doc) return
  const probe = doc.createElementNS('http://www.w3.org/2000/svg', 'text')
  const proto = Object.getPrototypeOf(probe) as { getBBox?: unknown } | null
  if (!proto || typeof proto.getBBox !== 'function') return
  if (Object.getOwnPropertyDescriptor(proto, '_ptnTextBBox')) return
  const original = proto.getBBox as (this: unknown) => {
    x: number
    y: number
    width: number
    height: number
  }
  Object.defineProperty(proto, '_ptnTextBBox', { value: true, configurable: true })
  proto.getBBox = function (this: SvgNodeLike): {
    x: number
    y: number
    width: number
    height: number
  } {
    if (String(this.tagName ?? '').toLowerCase() !== 'text') return original.call(this)
    const rows = this.childNodes
      ? (this.childNodes as SvgNodeLike[]).filter((n) => String(n.tagName ?? '') === 'tspan')
      : []
    const font = textFontPxFrom(this)
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let prevBaseline = resolveLengthPx(this.getAttribute('y'), font, 0)
    for (const row of rows) {
      const rowText = row.textContent ?? ''
      const dy = resolveLengthPx(row.getAttribute('dy'), font, 0)
      const yAttr = row.getAttribute('y')
      const baseline = yAttr != null ? resolveLengthPx(yAttr, font, 0) : prevBaseline + dy
      prevBaseline = baseline
      if (!rowText) continue
      const rowWidth = row.getComputedTextLength?.() ?? 0
      const anchor = row.getAttribute('text-anchor') ?? 'start'
      const x0 = resolveLengthPx(row.getAttribute('x'), font, 0)
      const [left, right] =
        anchor === 'middle'
          ? [x0 - rowWidth / 2, x0 + rowWidth / 2]
          : anchor === 'end'
            ? [x0 - rowWidth, x0]
            : [x0, x0 + rowWidth]
      minY = Math.min(minY, baseline - font * 1.06884)
      maxY = Math.max(maxY, baseline + font * 0.29305)
      minX = Math.min(minX, left)
      maxX = Math.max(maxX, right)
    }
    if (!Number.isFinite(minX)) return original.call(this)
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    }
  }
}

/**
 * DOM globals the isomorphic-mermaid shim installs; we isolate them around each
 * render. Not `navigator`: in Node 21+ it is a read-only global getter, and the
 * shim never touches it — only `window`/`document` need isolation.
 */
const DOM_GLOBAL_KEYS = ['window', 'document'] as const
const originalGlobals = new Map<string, unknown>()
const shimGlobals = new Map<string, unknown>()

function readGlobals(target: Map<string, unknown>): void {
  const g = globalThis as Record<string, unknown>
  for (const key of DOM_GLOBAL_KEYS) target.set(key, g[key])
}

function writeGlobals(target: Map<string, unknown>): void {
  const g = globalThis as Record<string, unknown>
  for (const key of DOM_GLOBAL_KEYS) {
    try {
      g[key] = target.get(key)
    } catch {
      // Ignore read-only globals (e.g. navigator) that we never need to restore.
    }
  }
}

/** Lazily import the DOM-shimmed mermaid (side-effectful: installs window/document). */
function loadMermaid(): Promise<MermaidModule> {
  installCssStyleSheetPolyfill()
  if (!mermaidPromise) {
    readGlobals(originalGlobals)
    mermaidPromise = import('isomorphic-mermaid').then((mod) => {
      readGlobals(shimGlobals)
      const mermaid = (mod.default ?? mod) as MermaidModule
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        // Pin the label font to the Open Sans TTF that svgdom falls back to, so
        // svgdom's text measurements and resvg's glyph rasterization agree.
        fontFamily: FONT_FAMILY,
        // The svgdom DOM shim has no layout ("offsetWidth" is undefined), so
        // gantt must render at a fixed width (see installParentElementPolyfill).
        gantt: { useMaxWidth: false, useWidth: 1200 }
      })
      return mermaid
    })
  }
  return mermaidPromise
}

/**
 * Run a mermaid operation with its DOM shim globals installed, then restore the
 * host globals so no browser-like `window`/`document`/`navigator` leaks back
 * (e.g. the OpenAI SDK refuses to run in a "browser-like" environment).
 */
async function withMermaidDom<T>(fn: () => Promise<T>): Promise<T> {
  await loadMermaid()
  writeGlobals(shimGlobals)
  installParentElementPolyfill()
  installTextBBoxPolyfill()
  try {
    return await fn()
  } finally {
    writeGlobals(originalGlobals)
  }
}

/**
 * Label geometry normalizer.
 *
 * mermaid lays out SVG-text labels assuming a real browser DOM: row tspans use
 * `y="-0.1em" dy="1.1em"` em math, the label box is measured with `getBBox()`,
 * and text is positioned only via CSS (font size) and per-tspan attributes.
 * Two engines disagree here:
 *  - svgdom's `getBBox()` for middle-anchored *nested* tspans is inconsistent,
 *    and its font size only applies as a presentation attribute, not via CSS.
 *  - @resvg/resvg-js resolves the fallback font on its own, so its glyph
 *    metrics (width/ink extents) drift from svgdom's measurements.
 *
 * Fix: pin every engine to the exact same font — the Open Sans TTF that svgdom
 * bundles and falls back to (`node_modules/svgdom/fonts/OpenSans-Regular.ttf`);
 * configure svgdom-free `initialize` with that family and hand the same file to
 * resvg (`svgToPng`). Then rewrite each label deterministically in the shim DOM:
 * rows become one `<text text-anchor="middle">` per row at explicitly computed
 * baselines (no em/dy chunking), the label's own background rect is sized from
 * a start-anchored svgdom measurement (which is stable), and everything is
 * centered on the shape/edge midpoint. The `<img>` preview embeds the same
 * output, and real text engines keep it correct because geometry is explicit.
 */

const LABEL_LINE_HEIGHT_EM = 1.1
/** Ink extent above / below the baseline per line (Open Sans at any size). */
const LABEL_INK_TOP_EM = -0.72
const LABEL_INK_BOTTOM_EM = 0.135
const LABEL_BG_PAD = 2

function labelFontPx(svg: string): number {
  const found = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(svg)?.[1]
  return found ? Number(found) : 16
}

interface SvgNodeLike {
  textContent: string | null
  innerHTML?: string
  outerHTML?: string
  tagName?: string
  childNodes?: { tagName?: string }[]
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  cloneNode(deep?: boolean): SvgNodeLike
  appendChild(child: SvgNodeLike): SvgNodeLike
  remove(): void
  querySelector(selector: string): SvgNodeLike | null
  querySelectorAll(selector: string): SvgNodeLike[]
  getComputedTextLength?(): number
  getBBox?(): { x: number; y: number; width: number; height: number }
  parentNode?: SvgNodeLike | null
}

interface SvgDocLike {
  createElementNS(namespace: string, tag: string): SvgNodeLike
  createElement(tag: string): SvgNodeLike
  querySelector(selector: string): SvgNodeLike | null
  querySelectorAll(selector: string): SvgNodeLike[]
  body: SvgNodeLike & { appendChild(child: SvgNodeLike): void }
}

function svgDoc(): SvgDocLike | undefined {
  return (globalThis as unknown as { document?: SvgDocLike }).document
}

/** Measure one row of text, start-anchored, with an explicit font-size (stable in svgdom). */
function measureRowWidth(
  doc: SvgDocLike,
  rows: SvgNodeLike[],
  fontPx: number
): { widths: number[]; max: number } {
  const widths: number[] = []
  for (const row of rows) {
    const text = doc.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('font-size', `${fontPx}px`)
    const tspan = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan')
    tspan.textContent = row.textContent ?? ''
    text.appendChild(tspan)
    // svgdom requires the element to be in a document for getBBox
    doc.body.appendChild(text)
    widths.push(Number(text.getBBox?.().width) || 0)
    text.remove()
  }
  return { widths, max: Math.max(...widths, 0) }
}

/**
 * Replace a label's `<text>` (mermaid's multi-chunk tspan markup with em-based
 * y/dy) by one anchored `<text>` per row at explicit baselines around cy.
 */
function rewriteLabelText(
  doc: SvgDocLike,
  text: SvgNodeLike,
  rows: SvgNodeLike[],
  fontPx: number,
  center: { cx: number; cy: number }
): void {
  const n = rows.length
  const lh = fontPx * LABEL_LINE_HEIGHT_EM
  const inkSpan = (LABEL_INK_BOTTOM_EM - LABEL_INK_TOP_EM) * fontPx
  // Ink block [top .. top+span+(n-1)*lh] centered on cy → row baselines:
  for (let i = 0; i < n; i++) {
    const baseline = center.cy - ((n - 1) * lh + inkSpan) / 2 + i * lh - LABEL_INK_TOP_EM * fontPx
    const newText = doc.createElementNS('http://www.w3.org/2000/svg', 'text')
    newText.setAttribute('y', baseline.toFixed(6))
    newText.setAttribute('x', center.cx.toFixed(6))
    newText.setAttribute('text-anchor', 'middle')
    newText.setAttribute('font-size', `${fontPx}px`)
    for (const inner of Array.from(rows[i].querySelectorAll(':scope > tspan.text-inner-tspan'))) {
      newText.appendChild(inner.cloneNode(true))
    }
    text.parentNode?.appendChild(newText)
  }
  text.remove()
}

/**
 * Run inside the DOM shim (after `mermaid.render`). Normalizes edge labels
 * (`g.edgeLabels > g.edgeLabel`) and node labels (`g.nodes > g.node`).
 */
function normalizeLabelGeometry(svg: string): string {
  const doc = svgDoc()
  if (!doc) return svg
  const fontPx = labelFontPx(svg)
  const holder = doc.createElement('div')
  holder.innerHTML = svg
  const root = holder.querySelector('svg')
  if (!root) return svg
  let touched = false

  // Edge labels: rect is centered on the outer g.edgeLabel origin (edge mid) —
  // rescale rect + rows; wrapper transform -> identity.
  for (const label of root.querySelectorAll('.edgeLabels > .edgeLabel > g.label')) {
    const rect = label.querySelector('rect.background')
    const text = label.querySelector('text')
    if (!rect || !text) continue
    const rows = [...text.querySelectorAll(':scope > tspan.text-outer-tspan')]
    if (rows.length === 0) continue
    const { max } = measureRowWidth(doc, rows, fontPx)
    if (max <= 0) continue
    // 8% width slack: the renderer (or a browser <img>) may substitute a wider
    // font than Open Sans; keep the label inside the box anyway.
    const w = max * 1.08 + LABEL_BG_PAD * 2
    const lh = fontPx * LABEL_LINE_HEIGHT_EM
    const inkTop = fontPx * LABEL_INK_TOP_EM - ((rows.length - 1) * lh) / 2
    const inkBottom = fontPx * LABEL_INK_BOTTOM_EM + ((rows.length - 1) * lh) / 2
    const h = inkBottom - inkTop + LABEL_BG_PAD * 2
    const y = -(h / 2)
    for (const [k, v] of [
      ['x', -w / 2],
      ['y', y],
      ['width', w],
      ['height', h]
    ] as [string, number][]) {
      rect.setAttribute(k, v.toFixed(6))
    }
    // Solid background so the box fully masks the edge line beneath it
    // (mermaid's CSS keeps it at 0.5 opacity, letting the line show through).
    rect.setAttribute('style', 'opacity: 1; fill: #e8e8e8')
    label.setAttribute('transform', 'translate(0, 0)')
    rewriteLabelText(doc, text, rows, fontPx, { cx: 0, cy: 0 })
    touched = true
  }

  // Node labels: rows centered on the node's label-container rect center;
  // wrapper's mermaid offset transform replaced by the rect center.
  // ER entities are skipped: their title row is positioned by mermaid itself
  // inside the header band, and their label rect covers the whole table.
  for (const node of root.querySelectorAll('.nodes > g.node')) {
    if (/-entity-/.test(node.getAttribute('id') ?? '')) continue
    if (node.querySelector('g.row-rect-odd') || node.querySelector('g.row-rect-even')) continue
    const shape = node.querySelector('rect.basic.label-container') ?? node.querySelector('rect')
    const label = node.querySelector('g.label')
    const text = label?.querySelector('text')
    if (!shape || !label || !text) continue
    const rows = [...text.querySelectorAll(':scope > tspan.text-outer-tspan')]
    if (rows.length === 0) continue
    const cx = Number(shape.getAttribute('x') ?? 0) + Number(shape.getAttribute('width') ?? 0) / 2
    const cy = Number(shape.getAttribute('y') ?? 0) + Number(shape.getAttribute('height') ?? 0) / 2
    label.setAttribute('transform', `translate(${cx.toFixed(6)}, ${cy.toFixed(6)})`)
    rewriteLabelText(doc, text, rows, fontPx, { cx: 0, cy: 0 })
    touched = true
  }
  if (!touched) return svg
  const out = root.outerHTML
  return typeof out === 'string' && out.startsWith('<svg') ? out : svg
}

function measureTextWidth(doc: SvgDocLike, text: string, fontPx: number): number {
  const el = doc.createElementNS('http://www.w3.org/2000/svg', 'text')
  el.setAttribute('font-size', `${fontPx}px`)
  el.textContent = text
  doc.body.appendChild(el)
  const width = Number(el.getBBox?.().width) || 0
  el.remove()
  return width
}

/**
 * Event-modeling boxes render their label as `<foreignObject>` HTML, which
 * neither resvg nor the editor's `<img>` preview can display — the block words
 * vanish. Inline them: replace each `g.em-box > foreignObject` with a plain
 * SVG `<text>` word-wrapped and centered on the box's own rect.
 */
function inlineEventModelingLabels(svg: string): string {
  const doc = svgDoc()
  if (!doc) return svg
  const holder = doc.createElement('div')
  if (/foreignObject/.test(svg)) holder.innerHTML = svg
  else return svg
  const root = holder.querySelector('svg')
  if (!root) return svg
  const fontPx = labelFontPx(svg)
  let touched = false
  for (const box of root.querySelectorAll('g.em-box')) {
    const rect = box.querySelector('rect')
    const foreign = box.querySelector('foreignObject')
    const text = (rect && foreign ? (foreign.textContent ?? '') : '').trim()
    if (!rect || !foreign || !text) continue
    const rx = Number(rect.getAttribute('x') ?? 0)
    const ry = Number(rect.getAttribute('y') ?? 0)
    const rw = Number(rect.getAttribute('width') ?? 0)
    const rh = Number(rect.getAttribute('height') ?? 0)
    if (!(rw > 0 && rh > 0)) continue
    // Wrap to the foreignObject's width with word breaks.
    const maxW = rw * 0.9
    const rows: string[] = []
    let current = ''
    for (const token of text.split(/\s+/)) {
      const candidate = current ? `${current} ${token}` : token
      if (current && measureTextWidth(doc, candidate, fontPx) > maxW) {
        rows.push(current)
        current = token
      } else {
        current = candidate
      }
    }
    if (current) rows.push(current)
    const n = rows.length
    const lh = fontPx * LABEL_LINE_HEIGHT_EM
    const inkSpan = (LABEL_INK_BOTTOM_EM - LABEL_INK_TOP_EM) * fontPx
    foreign.querySelectorAll('*').forEach((el) => el.remove())
    for (let i = 0; i < n; i++) {
      const baseline =
        ry + rh / 2 - ((n - 1) * lh + inkSpan) / 2 + i * lh - LABEL_INK_TOP_EM * fontPx
      const textEl = doc.createElementNS('http://www.w3.org/2000/svg', 'text')
      textEl.setAttribute('x', (rx + rw / 2).toFixed(6))
      textEl.setAttribute('y', baseline.toFixed(6))
      textEl.setAttribute('text-anchor', 'middle')
      textEl.setAttribute('font-size', `${fontPx}px`)
      textEl.setAttribute('font-weight', 'bold')
      textEl.textContent = rows[i]
      box.appendChild(textEl)
    }
    foreign.remove()
    touched = true
  }
  if (!touched) return svg
  const out = root.outerHTML
  return typeof out === 'string' && out.startsWith('<svg') ? out : svg
}

/**
 * Edge anchor correction.
 *
 * The layout pass records node dimensions from the measurement pass, and for
 * diamond (question) shapes those dims disagree with the drawn polygon — so
 * dagre's raw edge points start/stop several dozen px outside the shape border.
 * Fix deterministically from the final SVG: decode each edge's `data-points`,
 * and snap the first/last point onto the source/target node's actual drawn
 * boundary (rect / polygon / ellipse) when it overshoots it.
 */

interface EdgePoint {
  x: number
  y: number
}

interface NodeShape {
  cx: number
  cy: number
  kind: 'rect' | 'polygon' | 'ellipse'
  rect?: { w: number; h: number }
  poly?: EdgePoint[]
  ellipse?: { rx: number; ry: number }
}

const ANCHOR_SNAP_MIN = 1.5

/** Distance along unit ray (ux, uy) from the node center to its shape boundary. */
function rayShapeParam(shape: NodeShape, ux: number, uy: number): number {
  if (shape.kind === 'ellipse' && shape.ellipse) {
    const { rx, ry } = shape.ellipse
    return 1 / Math.sqrt((ux / rx) ** 2 + (uy / ry) ** 2)
  }
  if (shape.kind === 'rect' && shape.rect) {
    const { w, h } = shape.rect
    const tx = ux === 0 ? Number.POSITIVE_INFINITY : Math.abs(w / 2 / ux)
    const ty = uy === 0 ? Number.POSITIVE_INFINITY : Math.abs(h / 2 / uy)
    return Math.min(tx, ty)
  }
  const poly = shape.poly ?? []
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const dxx = b.x - a.x
    const dyy = b.y - a.y
    const denom = dxx * uy - ux * dyy
    if (Math.abs(denom) < 1e-9) continue
    const r = (dxx * a.y - a.x * dyy) / denom
    if (r <= 0) continue
    const t = Math.abs(dxx) > 1e-9 ? (r * ux - a.x) / dxx : (r * uy - a.y) / dyy
    if (t >= 0 && t <= 1) best = Math.min(best, r)
  }
  return best
}

function parseNodeShape(node: SvgNodeLike): NodeShape | null {
  const tf = node.getAttribute('transform')?.match(/translate\(([-\d.]+)[,.\s]+([-\d.]+)\)/)
  const shape: NodeShape = {
    cx: tf ? Number(tf[1]) : 0,
    cy: tf ? Number(tf[2]) : 0,
    kind: 'rect'
  }
  const polygon = node.querySelector('polygon')
  if (polygon) {
    const pts = (polygon.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [x, y] = pair.split(',')
        return { x: Number(x), y: Number(y) }
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    if (pts.length > 0) {
      const ptf = polygon.getAttribute('transform')?.match(/translate\(([-\d.]+)[,.\s]+([-\d.]+)\)/)
      const ox = ptf ? Number(ptf[1]) : 0
      const oy = ptf ? Number(ptf[2]) : 0
      shape.kind = 'polygon'
      shape.poly = pts.map((p) => ({ x: p.x + ox, y: p.y + oy }))
      return shape
    }
  }
  const ellipse = node.querySelector('ellipse')
  const circle = node.querySelector('circle')
  if (ellipse && Number(ellipse.getAttribute('rx') ?? 0) > 0) {
    shape.kind = 'ellipse'
    shape.ellipse = {
      rx: Number(ellipse.getAttribute('rx')),
      ry: Number(ellipse.getAttribute('ry') ?? ellipse.getAttribute('rx'))
    }
    return shape
  }
  if (circle && Number(circle.getAttribute('r') ?? 0) > 0) {
    const r = Number(circle.getAttribute('r'))
    shape.kind = 'ellipse'
    shape.ellipse = { rx: r, ry: r }
    return shape
  }
  const rect = node.querySelector('rect.basic.label-container') ?? node.querySelector('rect')
  if (rect) {
    const w = Number(rect.getAttribute('width') ?? 0)
    const h = Number(rect.getAttribute('height') ?? 0)
    if (w > 0 && h > 0) {
      shape.kind = 'rect'
      shape.rect = { w, h }
      return shape
    }
  }
  return null
}

function decodeDataPoints(raw: string): EdgePoint[] | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    return Array.isArray(parsed) &&
      parsed.every((p) => typeof p?.x === 'number' && typeof p?.y === 'number')
      ? (parsed as EdgePoint[])
      : undefined
  } catch {
    return undefined
  }
}

function fixEdgeAnchorGeometry(svg: string): string {
  const doc = svgDoc()
  if (!doc) return svg
  const holder = doc.createElement('div')
  holder.innerHTML = svg
  const root = holder.querySelector('svg')
  if (!root) return svg
  const shapes = new Map<string, NodeShape>()
  for (const node of root.querySelectorAll('.nodes > g.node')) {
    const id = node.getAttribute('id') ?? ''
    const key = /flowchart-([A-Za-z0-9]+)-\d+$/.exec(id)?.[1]?.toUpperCase()
    if (!key) continue
    const shape = parseNodeShape(node)
    if (shape) shapes.set(key, shape)
  }
  if (shapes.size === 0) return svg
  let touched = false
  for (const edge of root.querySelectorAll('.edgePaths path[data-points]')) {
    const attrClass = edge.getAttribute('class') ?? ''
    if (/edge-thickness-invisible/.test(attrClass)) continue
    const match = /L_([A-Za-z0-9]+)_([A-Za-z0-9]+)_\d+$/.exec(edge.getAttribute('data-id') ?? '')
    if (!match) continue
    const srcShape = shapes.get(match[1].toUpperCase())
    const dstShape = shapes.get(match[2].toUpperCase())
    const points = decodeDataPoints(edge.getAttribute('data-points') ?? '')
    if (!points || points.length < 2) continue
    let changed = false
    const snap = (point: EdgePoint, shape: NodeShape | undefined): void => {
      if (!shape) return
      const dx = point.x - shape.cx
      const dy = point.y - shape.cy
      const len = Math.hypot(dx, dy)
      if (len <= 0) return
      const ux = dx / len
      const uy = dy / len
      const r = rayShapeParam(shape, ux, uy)
      if (!Number.isFinite(r) || r <= 0 || len <= r + ANCHOR_SNAP_MIN) return
      point.x = shape.cx + ux * r
      point.y = shape.cy + uy * r
      changed = true
    }
    snap(points[0], srcShape)
    snap(points[points.length - 1], dstShape)
    if (!changed) continue
    edge.setAttribute('data-points', Buffer.from(JSON.stringify(points)).toString('base64'))
    const cur = edge.getAttribute('d') ?? ''
    const first = points[0]
    const last = points[points.length - 1]
    const nextD =
      cur
        .replace(/^M[\d.-]+,[\d.-]+/, `M${first.x.toFixed(3)},${first.y.toFixed(3)}`)
        .replace(/[\d.-]+,[\d.-]+$/, `${last.x.toFixed(3)},${last.y.toFixed(3)}`) || cur
    edge.setAttribute('d', nextD)
    touched = true
  }
  if (!touched) return svg
  const out = root.outerHTML
  return typeof out === 'string' && out.startsWith('<svg') ? out : svg
}

/**
 * Ishikawa head titles.
 *
 * mermaid sizes the fish-head text with `getBBox()`, then centers the block
 * with `translate(...)`; the stylesheet forces `text-anchor: middle` while
 * svgdom measured the rows anchored start — so the title ends up painted
 * across the head's flat left edge instead of inside the half-circle. Rewrite
 * the label: anchor middle and place the block's center at the head's arc
 * middle (apex/2), keeping mermaid's vertical placement.
 */
function fixIshikawaHeadLabel(svg: string): string {
  const doc = svgDoc()
  if (!doc || !/ishikawa-head-label/.test(svg)) return svg
  const holder = doc.createElement('div')
  holder.innerHTML = svg
  const root = holder.querySelector('svg')
  if (!root) return svg
  const fontPx = labelFontPx(svg)
  let touched = false
  for (const text of root.querySelectorAll('text.ishikawa-head-label')) {
    const group = text.parentNode
    const path = group ? group.querySelector('path.ishikawa-head') : null
    const dm = /M\s*0\s+(-?[\d.]+)\s+L\s*0\s+([\d.]+)\s+Q\s*([\d.]+)\s+0/.exec(
      path?.getAttribute('d') ?? ''
    )
    if (!dm) continue
    const apexX = Number(dm[3]) / 2
    const rows = [...text.querySelectorAll(':scope > tspan')]
    if (rows.length === 0) continue
    const maxW = Math.max(
      ...rows.map((row) => measureTextWidth(doc, row.textContent ?? '', fontPx)),
      0
    )
    if (maxW <= 0) continue
    // center the block inside the arc; keep the vertical translate
    const vy = (text.getAttribute('transform') ?? '').match(
      /translate\(([-\d.]+)(?:,|\s+)?([-\d.]+)\)/
    )
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('transform', `translate(${(apexX / 2).toFixed(3)}, ${Number(vy?.[2] ?? 0)})`)
    touched = true
  }
  if (!touched) return svg
  const out = root.outerHTML
  return typeof out === 'string' && out.startsWith('<svg') ? out : svg
}

/** Parse a mermaid source string and return the diagram type or the parse error. */
export async function validateMermaid(src: string): Promise<MermaidValidationResult> {
  const text = typeof src === 'string' ? src.trim() : ''
  if (!text) return { ok: false, error: 'Diagram source is empty.' }
  try {
    const diagramType = await withMermaidDom(async () => {
      const mermaid = await loadMermaid()
      const res = await mermaid.parse(text)
      return res?.diagramType ?? 'unknown'
    })
    if (diagramType === 'unknown') {
      return {
        ok: false,
        error: 'No diagram type detected. Use flowchart, sequence, state, class, ER, pie or gantt.'
      }
    }
    return { ok: true, diagramType }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Render a mermaid source string to an SVG string (throws on invalid source). */
export async function renderMermaidSvg(src: string): Promise<MermaidSvgResult> {
  const id = `diagram-${Date.now()}-${renderCounter++}`
  const res = await withMermaidDom(async () => {
    const mermaid = await loadMermaid()
    const rendered = await mermaid.render(id, src)
    return {
      svg: embedDiagramFont(
        fixEdgeAnchorGeometry(
          inlineEventModelingLabels(fixIshikawaHeadLabel(normalizeLabelGeometry(rendered.svg)))
        )
      ),
      diagramType: rendered.diagramType
    }
  })
  return { svg: res.svg, diagramType: res.diagramType }
}

/** Read the intrinsic SVG size from its viewBox (min-x min-y width height). */
export function svgBounds(svg: string): { width: number; height: number } {
  const m = /viewBox=["']([^"']+)["']/.exec(svg)
  if (!m)
    return {
      width: DEFAULT_DIAGRAM_PIXEL_WIDTH,
      height: Math.round(DEFAULT_DIAGRAM_PIXEL_WIDTH * 0.7)
    }
  const parts = m[1].split(/[\s,]+/).map(Number)
  const w = parts[2]
  const h = parts[3]
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return {
      width: DEFAULT_DIAGRAM_PIXEL_WIDTH,
      height: Math.round(DEFAULT_DIAGRAM_PIXEL_WIDTH * 0.7)
    }
  }
  return { width: w, height: h }
}

/** Rasterize an mermaid SVG string to a PNG buffer. */
export function svgToPng(svg: string, pixelWidth = DEFAULT_DIAGRAM_PIXEL_WIDTH): Buffer {
  const width = clamp(Math.floor(pixelWidth), PIXEL_WIDTH_MIN, PIXEL_WIDTH_MAX)
  const resvg = new Resvg(svg, {
    ...getResvgFontOptions(),
    fitTo: { mode: 'width', value: width }
  })
  return resvg.render().asPng()
}

/** One-shot in-process render: validate + SVG + PNG + bounds. Throws on failure. */
export async function renderMermaidPng(
  src: string,
  pixelWidth = DEFAULT_DIAGRAM_PIXEL_WIDTH
): Promise<{ svg: string; png: Buffer; diagramType: string; width: number; height: number }> {
  const checked = await validateMermaid(src)
  if (!checked.ok) throw new Error(checked.error)
  const res = await renderMermaidSvg(src)
  const bounds = svgBounds(res.svg)
  const png = svgToPng(res.svg, pixelWidth)
  return {
    svg: res.svg,
    png,
    diagramType: res.diagramType,
    width: bounds.width,
    height: bounds.height
  }
}

/** Allowed mermaid diagram types for tool documentation. */
export function supportedDiagramTypes(): string[] {
  return SUPPORTED_TYPES
}
