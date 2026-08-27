import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  NumberFormat,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip
} from 'docx'
import { promises as fs, readFileSync } from 'fs'
import { lucideIconPngDataUri } from '../shared/lucideIcons'

export type DocxBlock =
  | { type: 'title-page'; title?: string; subtitle?: string; icon?: string | DocxIconSpec }
  | { type: 'heading'; level?: number; text?: string }
  | {
      type: 'paragraph'
      text?: string
      bold?: boolean
      italic?: boolean
      align?: 'left' | 'center' | 'right' | 'justify'
    }
  | { type: 'bullets'; items?: string[] }
  | { type: 'numbered'; items?: string[] }
  | {
      type: 'table'
      title?: string
      headers?: string[]
      rows?: string[][]
      widths?: number[]
      width?: number
    }
  | { type: 'quote'; text?: string; author?: string }
  | { type: 'callout'; title?: string; text?: string }
  | { type: 'chart' | 'diagram' | 'infographic'; png?: string; caption?: string; width?: number }
  | { type: 'divider' }
  | { type: 'page-break' }

export interface DocxIconSpec {
  name: string
  color?: string
}

export interface DocxDesign {
  title?: string
  author?: string
  orientation?: 'portrait' | 'landscape'
  margins?: 'normal' | 'narrow' | 'wide'
  theme?: { primary?: string; accent?: string; fontFace?: string }
  footer?: string
  blocks?: DocxBlock[]
}

export type DocxBuildResult =
  { ok: true; path: string; blockCount: number } | { ok: false; error: string }

interface Palette {
  primary: string
  accent: string
  fontFace: string
}

function paletteOf(design: DocxDesign): Palette {
  const theme = design.theme ?? {}
  const hex = (v: unknown, fallback: string): string =>
    typeof v === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(v.trim())
      ? v.trim().replace(/^#/, '')
      : fallback
  return {
    primary: hex(theme.primary, '1F4CA8'),
    accent: hex(theme.accent, 'ED7D31'),
    fontFace: String(theme.fontFace || 'Calibri')
  }
}

interface PageSpec {
  width: number
  height: number
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
}

function pageOf(design: DocxDesign): PageSpec {
  const landscape = design.orientation === 'landscape'
  const width = landscape ? convertInchesToTwip(11) : convertInchesToTwip(8.5)
  const height = landscape ? convertInchesToTwip(8.5) : convertInchesToTwip(11)
  const m =
    design.margins === 'narrow'
      ? convertInchesToTwip(0.5)
      : design.margins === 'wide'
        ? convertInchesToTwip(1.25)
        : convertInchesToTwip(1)
  return { width, height, marginTop: m, marginBottom: m, marginLeft: m, marginRight: m }
}

function listIndent(level: number): { left: number; hanging: number } {
  return { left: convertInchesToTwip(0.5 + level * 0.5), hanging: convertInchesToTwip(0.25) }
}

/** Rasterize a Lucide icon to a PNG buffer for embedding, or throw for the caller to surface. */
function iconPngBuffer(name: string, color?: string): Buffer {
  const res = lucideIconPngDataUri(name, { color, sizePx: 256 })
  if (!res.ok) throw new Error(res.error)
  const idx = res.dataUri.indexOf('base64,')
  if (idx < 0) throw new Error(`Could not decode icon "${name}".`)
  return Buffer.from(res.dataUri.slice(idx + 7), 'base64')
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

type DocAlignment = 'left' | 'center' | 'right' | 'both'

function alignmentOf(v: string | undefined): DocAlignment | undefined {
  switch (v) {
    case 'center':
      return 'center'
    case 'right':
      return 'right'
    case 'justify':
      return 'both'
    default:
      return 'left'
  }
}

function bodyRuns(
  text: string,
  t: Palette,
  opts: { bold?: boolean; italic?: boolean } = {}
): TextRun[] {
  return [
    new TextRun({
      text,
      font: t.fontFace,
      size: 22,
      color: '222222',
      bold: opts.bold,
      italics: opts.italic
    })
  ]
}

/** Fit a picture into the usable page width preserving aspect ratio. Throws if the PNG is unreadable. */
function imageParagraph(
  spec: { png?: string; caption?: string; width?: number },
  page: PageSpec,
  t: Palette,
  altText: string
): Paragraph[] {
  const png = spec.png
  if (typeof png !== 'string' || !png.trim()) {
    throw new Error(
      `Image block needs a "png" path from render_chart / render_diagram / render_infographic.`
    )
  }
  const px = pngDimensions(png)
  if (!px) {
    throw new Error(`Image not found or not a valid PNG: "${png}". Render the image first.`)
  }
  const usablePx = (page.width - page.marginLeft - page.marginRight) / 20
  let targetW =
    typeof spec.width === 'number' && spec.width > 0
      ? convertInchesToTwip(spec.width) / 20
      : usablePx
  if (targetW > usablePx) targetW = usablePx
  const scale = targetW / px.w
  const w = Math.max(1, Math.round(px.w * scale))
  const h = Math.max(1, Math.round(px.h * scale))
  const img = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 80 },
    children: [
      new ImageRun({
        type: 'png',
        data: readFileSync(png),
        transformation: { width: w, height: h },
        altText: { name: altText, description: altText }
      })
    ]
  })
  const out: Paragraph[] = [img]
  if (typeof spec.caption === 'string' && spec.caption.trim()) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: spec.caption.trim(),
            font: t.fontFace,
            size: 18,
            italics: true,
            color: '777777'
          })
        ]
      })
    )
  }
  return out
}

/** Convert a module-authored block JSON into a real .docx file. */
export async function buildDocx(spec: unknown, outPath: string): Promise<DocxBuildResult> {
  const design = spec as DocxDesign
  if (!design || typeof design !== 'object') {
    return { ok: false, error: 'Design must be a JSON object with a non-empty "blocks" array.' }
  }
  const blocks = Array.isArray(design.blocks) ? design.blocks : []
  if (blocks.length === 0) {
    return { ok: false, error: 'Design has no blocks. Provide at least one block.' }
  }

  const t = paletteOf(design)
  const page = pageOf(design)
  const children: (Paragraph | Table)[] = []

  try {
    for (const raw of blocks) {
      const b = raw ?? {}
      const type = (b as { type?: string }).type || 'paragraph'

      switch (type) {
        case 'title-page': {
          children.push(new Paragraph({ children: [], spacing: { before: 2000 } }))
          const title = (b as { title?: string }).title || design.title || 'Document'
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
              children: [
                new TextRun({
                  text: title,
                  font: t.fontFace,
                  size: 56,
                  bold: true,
                  color: t.primary
                })
              ]
            })
          )
          const subtitle = (b as { subtitle?: string }).subtitle
          if (typeof subtitle === 'string' && subtitle.trim()) {
            children.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 240 },
                children: [
                  new TextRun({
                    text: subtitle.trim(),
                    font: t.fontFace,
                    size: 24,
                    color: t.accent
                  })
                ]
              })
            )
          }
          const iconRaw = (b as { icon?: string | DocxIconSpec }).icon
          if (typeof iconRaw === 'string' && iconRaw.trim()) {
            children.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    type: 'png',
                    data: iconPngBuffer(iconRaw.trim(), t.accent),
                    transformation: { width: 120, height: 120 },
                    altText: { name: iconRaw.trim() }
                  })
                ]
              })
            )
          } else if (
            iconRaw &&
            typeof iconRaw === 'object' &&
            typeof iconRaw.name === 'string' &&
            iconRaw.name.trim()
          ) {
            children.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    type: 'png',
                    data: iconPngBuffer(iconRaw.name.trim(), iconRaw.color || t.accent),
                    transformation: { width: 120, height: 120 },
                    altText: { name: iconRaw.name.trim() }
                  })
                ]
              })
            )
          }
          children.push(new Paragraph({ children: [new PageBreak()] }))
          break
        }
        case 'heading': {
          const h = b as { level?: number; text?: string }
          const text = typeof h.text === 'string' ? h.text : ''
          if (!text) break
          const level = Math.max(
            1,
            Math.min(6, Number.isFinite(Number(h.level)) ? Number(h.level) : 1)
          )
          const headingLevels: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
            1: HeadingLevel.HEADING_1,
            2: HeadingLevel.HEADING_2,
            3: HeadingLevel.HEADING_3,
            4: HeadingLevel.HEADING_4,
            5: HeadingLevel.HEADING_5,
            6: HeadingLevel.HEADING_6
          }
          const sizes: Record<number, number> = { 1: 32, 2: 28, 3: 24, 4: 22, 5: 22, 6: 20 }
          children.push(
            new Paragraph({
              heading: headingLevels[level],
              spacing: { before: level <= 2 ? 360 : 260, after: 140 },
              children: [
                new TextRun({
                  text,
                  font: t.fontFace,
                  size: sizes[level] ?? 22,
                  bold: true,
                  color: level <= 2 ? t.primary : '333333'
                })
              ]
            })
          )
          break
        }
        case 'paragraph': {
          const p = b as {
            text?: string
            bold?: boolean
            italic?: boolean
            align?: 'left' | 'center' | 'right' | 'justify'
          }
          const text = typeof p.text === 'string' ? p.text : ''
          if (!text) break
          children.push(
            new Paragraph({
              alignment: alignmentOf(p.align),
              spacing: { after: 120, line: 276 },
              children: bodyRuns(text, t, { bold: p.bold, italic: p.italic })
            })
          )
          break
        }
        case 'bullets':
        case 'numbered': {
          const list = b as { items?: string[] }
          const items = Array.isArray(list.items)
            ? list.items.map(String).filter((x) => x.trim())
            : []
          for (const item of items) {
            const sub = /^[\t ]+/.test(item)
            const text = item.replace(/^[\t ]+/, '').trim()
            if (!text) continue
            const level = sub ? 1 : 0
            children.push(
              new Paragraph({
                bullet: type === 'bullets' ? { level } : undefined,
                numbering:
                  type === 'numbered' ? { reference: 'ptnotes-numbering', level } : undefined,
                indent: { left: convertInchesToTwip(0.5 + level * 0.5) },
                spacing: { after: 80 },
                children: bodyRuns(text, t)
              })
            )
          }
          break
        }
        case 'table': {
          const table = b as {
            title?: string
            headers?: string[]
            rows?: string[][]
            widths?: unknown
            width?: unknown
          }
          const title =
            typeof table.title === 'string' && table.title.trim() ? table.title.trim() : ''
          if (title) {
            children.push(
              new Paragraph({
                spacing: { before: 160, after: 100 },
                children: [
                  new TextRun({
                    text: title,
                    font: t.fontFace,
                    size: 20,
                    bold: true,
                    color: t.primary
                  })
                ]
              })
            )
          }
          const headers = Array.isArray(table.headers) ? table.headers.map(String) : []
          const rows = Array.isArray(table.rows)
            ? table.rows.filter((r): r is string[] => Array.isArray(r)).map((r) => r.map(String))
            : []
          if (headers.length === 0 && rows.length === 0) break
          const cols = Math.max(headers.length, ...rows.map((r) => r.length))
          const rawWidths = Array.isArray(table.widths)
            ? (table.widths as unknown[])
                .map((v) => Number(v))
                .filter((n) => Number.isFinite(n) && n > 0)
            : []
          let colWidths: number[] = []
          if (rawWidths.length === cols) {
            const sum = rawWidths.reduce((a, b) => a + b, 0)
            colWidths = sum > 0 ? rawWidths.map((w) => (w / sum) * 100) : []
          }
          if (colWidths.length !== cols) {
            colWidths = Array(cols).fill(100 / cols)
          }
          const tableWidth =
            typeof table.width === 'number' && Number.isFinite(table.width) && table.width > 0
              ? Math.min(100, Math.max(10, table.width))
              : 100
          const allRows: string[][] = []
          if (headers.length > 0) allRows.push(headers)
          for (const r of rows) {
            while (r.length < cols) r.push('')
            allRows.push(r)
          }
          const borders = {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
            left: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
            right: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' }
          }
          const tableRows = allRows.map(
            (r, i) =>
              new TableRow({
                tableHeader: i === 0,
                children: r.map(
                  (cell, colIdx) =>
                    new TableCell({
                      width: { size: colWidths[colIdx] ?? 100 / cols, type: WidthType.PERCENTAGE },
                      shading: {
                        type: ShadingType.CLEAR,
                        fill: i === 0 ? t.primary : i % 2 === 0 ? 'FFFFFF' : 'F2F6FC'
                      },
                      margins: { top: 80, bottom: 80, left: 100, right: 100 },
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.LEFT,
                          children: [
                            new TextRun({
                              text: cell,
                              font: t.fontFace,
                              size: 20,
                              bold: i === 0,
                              color: i === 0 ? 'FFFFFF' : '222222'
                            })
                          ]
                        })
                      ]
                    })
                )
              })
          )
          children.push(
            new Table({
              width: { size: tableWidth, type: WidthType.PERCENTAGE },
              borders,
              rows: tableRows
            })
          )
          children.push(new Paragraph({ spacing: { after: 120 } }))
          break
        }
        case 'quote': {
          const q = b as { text?: string; author?: string }
          const text = typeof q.text === 'string' ? q.text : ''
          if (!text) break
          children.push(
            new Paragraph({
              shading: { type: ShadingType.CLEAR, fill: 'F2F6FC' },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: t.accent } },
              indent: { left: convertInchesToTwip(0.3) },
              spacing: { before: 160, after: 160 },
              children: [
                new TextRun({ text, font: t.fontFace, size: 22, italics: true, color: '444444' })
              ]
            })
          )
          const author = typeof q.author === 'string' && q.author.trim() ? q.author.trim() : ''
          if (author) {
            children.push(
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                indent: { left: convertInchesToTwip(0.3) },
                spacing: { after: 160 },
                children: [
                  new TextRun({ text: `— ${author}`, font: t.fontFace, size: 20, color: t.accent })
                ]
              })
            )
          }
          break
        }
        case 'callout': {
          const c = b as { title?: string; text?: string }
          const text = typeof c.text === 'string' ? c.text : ''
          const title = typeof c.title === 'string' && c.title.trim() ? c.title.trim() : ''
          if (!text && !title) break
          const runs: TextRun[] = []
          if (title)
            runs.push(
              new TextRun({ text: title, font: t.fontFace, size: 22, bold: true, color: t.primary })
            )
          if (text) {
            if (title) runs.push(new TextRun({ text: '  ' }))
            runs.push(new TextRun({ text, font: t.fontFace, size: 22, color: '333333' }))
          }
          children.push(
            new Paragraph({
              shading: { type: ShadingType.CLEAR, fill: 'FFF6EC' },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: t.accent } },
              indent: { left: convertInchesToTwip(0.3) },
              spacing: { before: 160, after: 160 },
              children: runs
            })
          )
          break
        }
        case 'chart':
        case 'diagram':
        case 'infographic': {
          children.push(
            ...imageParagraph(
              b as { png?: string; caption?: string; width?: number },
              page,
              t,
              type
            )
          )
          break
        }
        case 'divider': {
          children.push(
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: t.accent } },
              spacing: { before: 160, after: 160 }
            })
          )
          break
        }
        case 'page-break': {
          children.push(new Paragraph({ children: [new PageBreak()] }))
          break
        }
        default: {
          const p = b as { text?: string }
          const text = typeof p.text === 'string' ? p.text : ''
          if (text) {
            children.push(
              new Paragraph({ spacing: { after: 120, line: 276 }, children: bodyRuns(text, t) })
            )
          }
          break
        }
      }
    }

    const numbering = {
      config: [
        {
          reference: 'ptnotes-numbering',
          levels: [
            {
              level: 0,
              format: NumberFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: listIndent(0) } }
            },
            {
              level: 1,
              format: NumberFormat.LOWER_LETTER,
              text: '%2.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: listIndent(1) } }
            }
          ]
        }
      ]
    }

    const footerText =
      typeof design.footer === 'string' && design.footer.trim() ? design.footer.trim() : ''
    const footer = footerText
      ? new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: footerText, font: t.fontFace, size: 16, color: '777777' }),
                new TextRun({ text: '   ·   ', font: t.fontFace, size: 16, color: '999999' }),
                new TextRun({
                  children: ['Page ', PageNumber.CURRENT],
                  font: t.fontFace,
                  size: 16,
                  color: '777777'
                })
              ]
            })
          ]
        })
      : undefined

    const doc = new Document({
      numbering,
      styles: {
        default: {
          document: { run: { font: t.fontFace, size: 22, color: '222222' } }
        }
      },
      sections: [
        {
          properties: {
            page: {
              size: {
                width: page.width,
                height: page.height,
                orientation:
                  design.orientation === 'landscape'
                    ? PageOrientation.LANDSCAPE
                    : PageOrientation.PORTRAIT
              },
              margin: {
                top: page.marginTop,
                bottom: page.marginBottom,
                left: page.marginLeft,
                right: page.marginRight
              }
            },
            ...(footer ? { footer: { default: footer } } : {})
          },
          children
        }
      ]
    })

    const buffer = await Packer.toBuffer(doc)
    await fs.writeFile(outPath, buffer)
  } catch (err) {
    return {
      ok: false,
      error: `Could not build the document: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  return { ok: true, path: outPath, blockCount: blocks.length }
}
