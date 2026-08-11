import PptxGenJS from 'pptxgenjs'
import { readFileSync } from 'fs'
import { lucideIconPngDataUri } from '../shared/lucideIcons'

export type SlideLayout =
  | 'title'
  | 'bullets'
  | 'section'
  | 'statement'
  | 'two-column'
  | 'table'
  | 'chart'
  | 'diagram'
  | 'infographic'
  | 'blank'

export interface PptxTableSpec {
  headers?: string[]
  rows?: string[][]
}

export interface PptxIconSpec {
  name: string
  size?: number
  x?: number
  y?: number
  color?: string
}

export interface PptxChartSpec {
  png?: string
  x?: number
  y?: number
  w?: number
  h?: number
}

/** A picture slot fed by render_chart (chart), render_diagram (diagram) or render_infographic (infographic). */
export interface PptxPictureSpec {
  png?: string
  x?: number
  y?: number
  w?: number
  h?: number
}

export interface PptxSlideSpec {
  layout?: SlideLayout | string
  title?: string
  subtitle?: string
  body?: string[] | string
  left?: string[]
  right?: string[]
  statement?: string
  table?: PptxTableSpec
  icon?: string | PptxIconSpec
  chart?: string | PptxChartSpec
  diagram?: string | PptxPictureSpec
  infographic?: string | PptxPictureSpec
  notes?: string
}

export interface PptxDesign {
  title?: string
  slideSize?: '16x9' | '4x3'
  theme?: { primary?: string; accent?: string; fontFace?: string }
  footer?: string
  slides?: PptxSlideSpec[]
}

export type PptxBuildResult =
  { ok: true; path: string; slideCount: number } | { ok: false; error: string }

interface Palette {
  primary: string
  accent: string
  fontFace: string
}

interface BulletText {
  text: string
  options: { fontFace: string; fontSize: number; color: string; bullet: { indent: number } }
}

function bullets(lines: string[], t: Palette): BulletText[] {
  return lines.map((line) => ({
    text: line,
    options: { fontFace: t.fontFace, fontSize: 16, color: '222222', bullet: { indent: 15 } }
  }))
}

function addHeader(slide: PptxGenJS.Slide, title: string, t: Palette, shrinkForIcon = false): void {
  const w = shrinkForIcon ? 7.3 : 8.8
  slide.addText(title, {
    x: 0.6,
    y: 0.35,
    w,
    h: 0.8,
    fontFace: t.fontFace,
    fontSize: 28,
    bold: true,
    color: t.primary
  })
  slide.addShape('line', { x: 0.6, y: 1.15, w, h: 0, line: { color: t.accent, width: 2 } })
}

interface SlideDims {
  w: number
  h: number
}

const SLIDE_16x9: SlideDims = { w: 10, h: 5.625 }
const SLIDE_4x3: SlideDims = { w: 10, h: 7.5 }

interface IconSpec {
  name: string
  size: number
  x?: number
  y?: number
  color?: string
}

function parseIconSpec(
  raw: string | PptxIconSpec | undefined,
  defaultSize: number
): IconSpec | null {
  if (typeof raw === 'string') return raw.trim() ? { name: raw.trim(), size: defaultSize } : null
  if (raw && typeof raw === 'object' && typeof raw.name === 'string' && raw.name.trim()) {
    return {
      name: raw.name.trim(),
      size: typeof raw.size === 'number' && raw.size > 0 ? raw.size : defaultSize,
      x: typeof raw.x === 'number' && raw.x >= 0 ? raw.x : undefined,
      y: typeof raw.y === 'number' && raw.y >= 0 ? raw.y : undefined,
      color: typeof raw.color === 'string' ? raw.color : undefined
    }
  }
  return null
}

/** Rasterize a Lucide icon to PNG and stamp it onto the slide, or throw for the caller to surface. */
async function placeIcon(
  slide: PptxGenJS.Slide,
  icon: IconSpec,
  defaults: { x?: number; y?: number },
  defaultColor?: string
): Promise<void> {
  const png = lucideIconPngDataUri(icon.name, { color: icon.color || defaultColor, sizePx: 512 })
  if (!png.ok) throw new Error(png.error)
  const size = icon.size
  slide.addImage({
    data: png.dataUri,
    x: icon.x ?? defaults.x ?? 0,
    y: icon.y ?? defaults.y ?? 0,
    w: size,
    h: size,
    altText: icon.name
  })
}

/** Read the intrinsic pixel size of a PNG file from its IHDR chunk, or null. */
function pngDimensions(path: string): { w: number; h: number } | null {
  try {
    const buf = readFileSync(path)
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)
    if (!(w > 0 && h > 0 && w <= 100000 && h <= 100000)) return null
    return { w, h }
  } catch {
    return null
  }
}

/** Normalize a picture slot spec (a png path string or an object of placement). */
function parsePictureSpec(raw: string | PptxPictureSpec | undefined): PptxPictureSpec | null {
  if (!raw) return null
  if (typeof raw === 'string') return raw.trim() ? { png: raw.trim() } : null
  const g = raw as PptxPictureSpec
  const png = typeof g.png === 'string' && g.png.trim() ? g.png.trim() : ''
  if (!png) return null
  return {
    png,
    x: typeof g.x === 'number' && g.x >= 0 ? g.x : undefined,
    y: typeof g.y === 'number' && g.y >= 0 ? g.y : undefined,
    w: typeof g.w === 'number' && g.w > 0 ? g.w : undefined,
    h: typeof g.h === 'number' && g.h > 0 ? g.h : undefined
  }
}

/** Fit a picture into the slide body area, preserving its aspect ratio. Throws if the PNG is unreadable. */
function placePicture(
  slide: PptxGenJS.Slide,
  spec: PptxPictureSpec,
  title: string,
  dims: SlideDims,
  altText: string
): void {
  const px = pngDimensions(spec.png || '')
  if (!px) {
    throw new Error(`Image not found or not a valid PNG: "${spec.png}". Render the image first.`)
  }
  const bodyX = 0.6
  const bodyY = title ? 1.35 : 0.6
  const bodyW = 8.8
  const bodyH = dims.h - bodyY - 0.4
  const targetW = spec.w ?? bodyW
  const targetH = spec.h ?? bodyH
  const scale = Math.min(targetW / px.w, targetH / px.h)
  const w = px.w * scale
  const h = px.h * scale
  const x = spec.x ?? bodyX + (bodyW - w) / 2
  const y = spec.y ?? bodyY + (bodyH - h) / 2
  slide.addImage({ path: spec.png, x, y, w, h, altText })
}

/** Convert a module-authored slide JSON into a real .pptx file. */
export async function buildPptx(spec: unknown, outPath: string): Promise<PptxBuildResult> {
  const design = spec as PptxDesign
  if (!design || typeof design !== 'object') {
    return { ok: false, error: 'Design must be a JSON object with a non-empty "slides" array.' }
  }
  const slides = Array.isArray(design.slides) ? design.slides : []
  if (slides.length === 0) {
    return { ok: false, error: 'Design has no slides. Provide at least one slide.' }
  }

  const pptx = new PptxGenJS()
  pptx.author = 'PTNotes'
  pptx.company = 'PTNotes'
  if (typeof design.title === 'string') pptx.title = design.title.slice(0, 160)
  pptx.layout = design.slideSize === '4x3' ? 'LAYOUT_4x3' : 'LAYOUT_16x9'

  const theme = design.theme ?? {}
  const t: Palette = {
    primary: String(theme.primary || '1F4CA8'),
    accent: String(theme.accent || 'ED7D31'),
    fontFace: String(theme.fontFace || 'Calibri')
  }

  try {
    for (const raw of slides) {
      const s = raw ?? {}
      const slide = pptx.addSlide()
      const layout = (s.layout as SlideLayout) || 'bullets'
      const title = typeof s.title === 'string' ? s.title : ''
      const dims = design.slideSize === '4x3' ? SLIDE_4x3 : SLIDE_16x9
      const iconDefault =
        layout === 'title' ? 1.0 : layout === 'section' || layout === 'statement' ? 1.6 : 0.6
      const icon = parseIconSpec(s.icon, iconDefault)

      switch (layout) {
        case 'title': {
          slide.background = { color: t.primary }
          slide.addText(title || 'Presentation', {
            x: 0.6,
            y: 2.2,
            w: 8.8,
            h: 1.3,
            fontFace: t.fontFace,
            fontSize: 38,
            bold: true,
            color: 'FFFFFF'
          })
          if (typeof s.subtitle === 'string') {
            slide.addText(s.subtitle, {
              x: 0.6,
              y: 3.5,
              w: 8.8,
              h: 1.0,
              fontFace: t.fontFace,
              fontSize: 20,
              color: 'F5F5F5'
            })
          }
          if (icon) await placeIcon(slide, icon, { x: (dims.w - icon.size) / 2, y: 4.5 }, 'FFFFFF')
          break
        }
        case 'section':
        case 'statement': {
          slide.background = { color: 'F2F6FC' }
          const text = (typeof s.statement === 'string' ? s.statement : title) || 'Section'
          if (icon) await placeIcon(slide, icon, { x: (dims.w - icon.size) / 2, y: 0.8 }, t.accent)
          slide.addText(text, {
            x: 0.6,
            y: 2.4,
            w: 8.8,
            h: 2.0,
            fontFace: t.fontFace,
            fontSize: 36,
            bold: true,
            color: t.primary,
            valign: 'middle',
            align: 'center'
          })
          break
        }
        case 'two-column': {
          if (title) addHeader(slide, title, t, Boolean(icon))
          const y0 = title ? 1.35 : 0.6
          slide.addText(bullets(s.left && s.left.length ? s.left.map(String) : [''], t), {
            x: 0.55,
            y: y0,
            w: 4.1,
            h: 4.6,
            valign: 'top'
          })
          slide.addText(bullets(s.right && s.right.length ? s.right.map(String) : [''], t), {
            x: 5.3,
            y: y0,
            w: 4.1,
            h: 4.6,
            valign: 'top'
          })
          if (icon) await placeIcon(slide, icon, { x: dims.w - icon.size - 0.55, y: 0.3 }, t.accent)
          break
        }
        case 'table': {
          if (title) addHeader(slide, title, t, Boolean(icon))
          const table = s.table ?? {}
          const headers = Array.isArray(table.headers) ? table.headers.map(String) : []
          const rows = Array.isArray(table.rows)
            ? table.rows.filter((r): r is string[] => Array.isArray(r)).map((r) => r.map(String))
            : []
          if (headers.length === 0 && rows.length === 0) break
          const cols = Math.max(headers.length, ...rows.map((r) => r.length))
          const allRows: string[][] = []
          if (headers.length > 0) allRows.push(headers)
          for (const r of rows) {
            while (r.length < cols) r.push('')
            allRows.push(r)
          }
          slide.addTable(
            allRows.map((r, i) =>
              r.map((c) => ({
                text: c,
                options: {
                  fontFace: t.fontFace,
                  fontSize: 13,
                  bold: i === 0,
                  color: i === 0 ? 'FFFFFF' : '222222',
                  fill: i === 0 ? { color: t.primary } : { color: 'F5F5F5' },
                  valign: 'middle',
                  hAlign: 'left'
                }
              }))
            ),
            { x: 0.6, y: 1.6, w: 8.8, h: 0.6, colW: Array(cols).fill(8.8 / cols) }
          )
          if (icon) await placeIcon(slide, icon, { x: dims.w - icon.size - 0.55, y: 0.3 }, t.accent)
          break
        }
        case 'chart': {
          if (title) addHeader(slide, title, t)
          const chart = parsePictureSpec(s.chart)
          if (!chart || !chart.png) {
            return {
              ok: false,
              error:
                'A slide with layout "chart" needs a "chart" field set to the PNG path from render_chart (the path string or { "png": path }).'
            }
          }
          placePicture(slide, chart, title, dims, 'chart')
          break
        }
        case 'diagram': {
          if (title) addHeader(slide, title, t)
          const diagram = parsePictureSpec(s.diagram)
          if (!diagram || !diagram.png) {
            return {
              ok: false,
              error:
                'A slide with layout "diagram" needs a "diagram" field set to the PNG path from render_diagram (the path string or { "png": path }).'
            }
          }
          placePicture(slide, diagram, title, dims, 'diagram')
          break
        }
        case 'infographic': {
          if (title) addHeader(slide, title, t)
          const infographic = parsePictureSpec(s.infographic)
          if (!infographic || !infographic.png) {
            return {
              ok: false,
              error:
                'A slide with layout "infographic" needs an "infographic" field set to the PNG path from render_infographic (the path string or { "png": path }).'
            }
          }
          placePicture(slide, infographic, title, dims, 'infographic')
          break
        }
        case 'blank': {
          slide.background = { color: 'FFFFFF' }
          break
        }
        default: {
          if (title) addHeader(slide, title, t, Boolean(icon))
          if (typeof s.subtitle === 'string' && s.subtitle) {
            slide.addText(s.subtitle, {
              x: 0.6,
              y: 1.25,
              w: 8.8,
              h: 0.6,
              fontFace: t.fontFace,
              fontSize: 16,
              color: t.accent
            })
          }
          const body: string[] = []
          if (Array.isArray(s.body)) body.push(...s.body.map(String))
          else if (typeof s.body === 'string' && s.body.trim()) {
            body.push(
              ...s.body
                .split('\n')
                .map((x) => x.trim())
                .filter(Boolean)
            )
          }
          slide.addText(bullets(body.length ? body : ['(empty slide)'], t), {
            x: 0.6,
            y: s.subtitle ? 1.9 : 1.35,
            w: 8.6,
            h: 4.3,
            valign: 'top'
          })
          if (icon) await placeIcon(slide, icon, { x: dims.w - icon.size - 0.55, y: 0.3 }, t.accent)
          break
        }
      }

      if (typeof s.notes === 'string' && s.notes.trim()) {
        slide.addNotes(String(s.notes).trim())
      }
    }

    if (typeof design.footer === 'string' && design.footer.trim()) {
      const foot = pptx.addSlide()
      foot.addText(design.footer, {
        x: 0.5,
        y: 4.6,
        w: 9.0,
        h: 0.6,
        fontFace: t.fontFace,
        fontSize: 10,
        color: '777777',
        align: 'center'
      })
    }

    await pptx.writeFile({ fileName: outPath })
  } catch (err) {
    return {
      ok: false,
      error: `Could not build the presentation: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  return { ok: true, path: outPath, slideCount: slides.length }
}
