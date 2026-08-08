import PptxGenJS from 'pptxgenjs'

export type SlideLayout =
  'title' | 'bullets' | 'section' | 'statement' | 'two-column' | 'table' | 'blank'

export interface PptxTableSpec {
  headers?: string[]
  rows?: string[][]
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

function addHeader(slide: PptxGenJS.Slide, title: string, t: Palette): void {
  slide.addText(title, {
    x: 0.6,
    y: 0.35,
    w: 8.8,
    h: 0.8,
    fontFace: t.fontFace,
    fontSize: 28,
    bold: true,
    color: t.primary
  })
  slide.addShape('line', { x: 0.6, y: 1.15, w: 8.8, h: 0, line: { color: t.accent, width: 2 } })
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
          break
        }
        case 'section':
        case 'statement': {
          slide.background = { color: 'F2F6FC' }
          const text = (typeof s.statement === 'string' ? s.statement : title) || 'Section'
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
          if (title) addHeader(slide, title, t)
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
          break
        }
        case 'table': {
          if (title) addHeader(slide, title, t)
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
          break
        }
        case 'blank': {
          slide.background = { color: 'FFFFFF' }
          break
        }
        default: {
          if (title) addHeader(slide, title, t)
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
