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
  try {
    return await fn()
  } finally {
    writeGlobals(originalGlobals)
  }
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
    return mermaid.render(id, src)
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
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } })
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
