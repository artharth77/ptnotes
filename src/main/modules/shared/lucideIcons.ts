import { Resvg } from '@resvg/resvg-js'
import * as lucide from 'lucide-static'
import tagsJson from 'lucide-static/tags.json'

export interface IconHit {
  name: string
  tags: string[]
}

export type LucideSvgResult = { ok: true; name: string; svg: string } | { ok: false; error: string }

export type LucidePngResult =
  { ok: true; name: string; dataUri: string; bytes: number } | { ok: false; error: string }

const DEFAULT_COLOR = '#222222'

/** Convert a kebab-case icon name to its PascalCase export key, e.g. 'arrow-big-down' -> 'ArrowBigDown'. */
function kebabToPascal(name: string): string {
  return name
    .split('-')
    .map((s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join('')
}

/**
 * Map of lowercase icon names (canonical kebab names from tags.json and raw export
 * keys) to the actual `lucide-static` export key. Built lazily once; only SVG-string
 * exports are kept.
 */
let nameIndex: Map<string, string> | null = null

function getNameIndex(): Map<string, string> {
  if (nameIndex) return nameIndex
  const index = new Map<string, string>()
  for (const key of Object.keys(lucide)) {
    const svg = (lucide as Record<string, unknown>)[key]
    if (typeof svg !== 'string' || !svg.includes('<svg')) continue
    index.set(key.toLowerCase(), key)
  }
  for (const kebab of Object.keys(getTags())) {
    const key = index.get(kebabToPascal(kebab).toLowerCase())
    if (key) index.set(kebab.toLowerCase(), key)
  }
  nameIndex = index
  return index
}

let tagsCache: Record<string, string[]> | null = null

function getTags(): Record<string, string[]> {
  if (tagsCache === null) {
    try {
      tagsCache = tagsJson as unknown as Record<string, string[]>
    } catch {
      tagsCache = {}
    }
  }
  return tagsCache
}

export function tagsOf(name: string): string[] {
  const t = getTags()[name]
  return Array.isArray(t) ? t : []
}

/** Canonical kebab-case name per export key (tags.json keys are canonical). */
let canonicalOf: Map<string, string> | null = null

function canonicalNameFor(key: string): string {
  if (!canonicalOf) {
    canonicalOf = new Map<string, string>()
    for (const kebab of Object.keys(getTags())) {
      const exportKey = getNameIndex().get(kebab.toLowerCase())
      if (exportKey) canonicalOf.set(exportKey, kebab)
    }
  }
  return canonicalOf.get(key) ?? key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** Search the Lucide catalog by keywords, scoring icon names and their tags. */
export function searchLucideIcons(query: string, limit = 20): IconHit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const index = getNameIndex()
  const seen = new Set<string>()
  const scored: { name: string; score: number }[] = []
  for (const lower of index.keys()) {
    const key = index.get(lower)!
    if (seen.has(key)) continue
    seen.add(key)
    const name = canonicalNameFor(key)
    const tags = tagsOf(name)
    let score = 0
    for (const token of tokens) {
      if (lower.startsWith(token)) score += 10
      if (lower.includes(token)) score += 6
      if (tags.some((t) => t.includes(token) || token.includes(t))) score += 4
    }
    if (score > 0) scored.push({ name, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((h) => ({ name: h.name, tags: tagsOf(h.name) }))
}

/** Does the request look like a hex color? Returns the normalized #rrggbb form. */
function normalizeColor(color: string | undefined): string {
  const c = (color || '').trim().replace(/^#/, '')
  return /^[0-9a-fA-F]{3,8}$/.test(c) ? `#${c.slice(0, 8)}` : DEFAULT_COLOR
}

/** Resolve the export key for an icon name, or undefined if unknown. */
function resolveKey(name: string): string | undefined {
  if (!name) return undefined
  return getNameIndex().get(name.toLowerCase())
}

/** Return the raw SVG source for a Lucide icon, recolored to the given hex color. */
export function getLucideIconSvg(name: string, color?: string): LucideSvgResult {
  const key = resolveKey(name)
  if (!key) {
    return {
      ok: false,
      error: `Unknown Lucide icon "${name}". Use search_lucide_icons to find valid names.`
    }
  }
  const raw = (lucide as Record<string, string>)[key]
  const stroke = normalizeColor(color)
  const svg = raw.replace(/stroke="currentColor"/g, `stroke="${stroke}"`)
  return { ok: true, name: canonicalNameFor(key), svg }
}

/** Rasterize a Lucide icon SVG to a PNG data URI, reliable in all slide viewers. */
export function lucideIconPngDataUri(
  name: string,
  opts?: { color?: string; sizePx?: number }
): LucidePngResult {
  const svgResult = getLucideIconSvg(name, opts?.color)
  if (!svgResult.ok) return svgResult
  try {
    const sizePx = opts?.sizePx ?? 256
    const resvg = new Resvg(svgResult.svg, { fitTo: { mode: 'width', value: sizePx } })
    const png = resvg.render().asPng()
    return {
      ok: true,
      name: svgResult.name,
      dataUri: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
      bytes: png.length
    }
  } catch (err) {
    return {
      ok: false,
      error: `Could not render icon "${name}": ${err instanceof Error ? err.message : String(err)}`
    }
  }
}
