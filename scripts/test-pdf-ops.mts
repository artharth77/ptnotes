import Module from 'node:module'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const SERVICE_ROOT = '/tmp/ptnotes-pdf-ops-test-root'

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return { app: { getPath: () => SERVICE_ROOT, getAppPath: () => SERVICE_ROOT } }
  }
  return origLoad.call(this, request, parent, isMain)
}

const { mergePdfs, pdfPageCount, rebuildPdfPages } = await import('../src/main/pdf/ops')
const { extractPdfText } = await import('../src/main/ai/pdfText')
const { closePdfRender, openPdfRender, renderPdfPage, shutdownPdfRenderer } =
  await import('../src/main/pdf/pdfRenderer')
const { PTNotesService } = await import('../src/main/service/PTNotesService')

async function makePdf(
  pages: string[],
  opts: { rotate?: number; width?: number; height?: number } = {}
): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages.length; i++) {
    const page = doc.addPage([opts.width ?? 220, opts.height ?? 220])
    if (opts.rotate) page.setRotation(degrees(opts.rotate))
    page.drawText(pages[i], { x: 20, y: 120, size: 14, font, color: rgb(0, 0, 0) })
    page.drawText(`#P${i + 1}`, { x: 20, y: 90, size: 10, font, color: rgb(0.4, 0.4, 0.4) })
  }
  return Buffer.from(await doc.save())
}

/** Split extracted text into one section per `-- n of total --` page marker. */
function pageSections(text: string): string[] {
  return text.split(/\n-- \d+ of \d+ --\n/).map((s) => s.trim())
}

// ---- ops: page count + rebuild (reorder/delete) ----
const four = await makePdf(['One', 'Two', 'Three', 'Four'])
assert.equal(await pdfPageCount(four), 4)

const rebuilt = await rebuildPdfPages(four, [{ page: 4 }, { page: 1 }, { page: 2 }])
assert.equal(await pdfPageCount(rebuilt), 3)
const sections = pageSections((await extractPdfText(rebuilt)).text)
assert.match(sections[0], /Four/)
assert.match(sections[0], /#P4/)
assert.match(sections[1], /One/)
assert.match(sections[2], /Two/)

// ---- ops: rotate + keep rotation ----
const single = await makePdf(['Solo'])
const rotated = await rebuildPdfPages(single, [{ page: 1, rotation: 90 }])
assert.equal((await PDFDocument.load(rotated)).getPage(0).getRotation().angle, 90)
const plain = await rebuildPdfPages(single, [{ page: 1 }])
assert.equal((await PDFDocument.load(plain)).getPage(0).getRotation().angle, 0)

// ---- ops: validation rejections ----
await assert.rejects(() => rebuildPdfPages(four, []), /at least one page must remain/i)
await assert.rejects(() => rebuildPdfPages(four, [{ page: 1 }, { page: 1 }]), /more than once/i)
await assert.rejects(() => rebuildPdfPages(four, [{ page: 9 }]), /out of range/i)
await assert.rejects(() => rebuildPdfPages(four, [{ page: 1, rotation: 45 }]), /invalid rotation/i)

// ---- ops: merge ----
const a = await makePdf(['A1', 'A2'])
const b = await makePdf(['B1', 'B2', 'B3'])
const merged = await mergePdfs([a, b], ['a.pdf', 'b.pdf'])
assert.equal(await pdfPageCount(merged), 5)
const mergedSections = pageSections((await extractPdfText(merged)).text)
assert.match(mergedSections[0], /A1/)
assert.match(mergedSections[1], /A2/)
assert.match(mergedSections[2], /B1/)
assert.match(mergedSections[3], /B2/)
assert.match(mergedSections[4], /B3/)
await assert.rejects(() => mergePdfs([]), /at least two/i)

// ---- ops: invalid PDF ----
await assert.rejects(() => pdfPageCount(Buffer.from('definitely not a pdf')), /invalid|corrupt/i)

// ---- renderer fallback (plain Node): open + render + rotate ----
const portrait = await makePdf(['R1', 'R2'], { width: 200, height: 300 })
const key = 'test|1|0'
const session = await openPdfRender(key, portrait)
assert.equal(session.pages, 2)
assert.deepEqual(session.rotations, [0, 0])
const t1 = await renderPdfPage(key, portrait, 1)
assert.match(t1.dataUrl, /^data:image\/jpeg;base64,/)
assert.ok(t1.width > 0 && t1.height > 0)
assert.equal(t1.rotation, 0)
assert.ok(t1.height > t1.width, 'portrait page renders taller than wide')
const t90 = await renderPdfPage(key, portrait, 1, 90)
assert.equal(t90.rotation, 90)
assert.ok(t90.height < t1.height, '90° rotation swaps the aspect ratio')
assert.notEqual(t1.dataUrl, t90.dataUrl)
await closePdfRender(key)
// self-healing: after an explicit close the next render silently re-opens the document
const t1Again = await renderPdfPage(key, portrait, 1)
assert.match(t1Again.dataUrl, /^data:image\/jpeg;base64,/)
shutdownPdfRenderer()

// pages with fractional / degenerate MediaBoxes must render without "Invalid canvas size"
const fractional = await makePdf(['F1'], { width: 100.5, height: 200.5 })
const fSession = await openPdfRender('fractional|1|0', fractional)
assert.equal(fSession.pages, 1)
const fThumb = await renderPdfPage('fractional|1|0', fractional, 1)
assert.match(fThumb.dataUrl, /^data:image\/jpeg;base64,/)
const degenerate = await makePdf(['D1'], { width: 0.001, height: 200 })
const dSession = await openPdfRender('degenerate|1|0', degenerate)
assert.equal(dSession.pages, 1)
const dThumb = await renderPdfPage('degenerate|1|0', degenerate, 1)
assert.match(dThumb.dataUrl, /^data:image\/jpeg;base64,/)
shutdownPdfRenderer()

// ---- service level: info / render / rebuild / merge ----
await fs.rm(SERVICE_ROOT, { recursive: true, force: true })
const service = new PTNotesService(SERVICE_ROOT)
await service.createProject('Docs')
const filesDir = join(SERVICE_ROOT, 'Docs', 'files')
await fs.mkdir(filesDir, { recursive: true })
await fs.writeFile(join(filesDir, 'src.pdf'), await makePdf(['S1', 'S2', 'S3']))
await fs.writeFile(join(filesDir, 'other.pdf'), await makePdf(['O1', 'O2']))

const info = await service.pdfInfo('Docs', 'src.pdf')
assert.equal(info.pages, 3)
assert.deepEqual(info.rotations, [0, 0, 0])

const thumb = await service.pdfRenderPage('Docs', 'src.pdf', 2)
assert.match(thumb.dataUrl, /^data:image\/jpeg;base64,/)

// rebuild → src (pages).pdf, original untouched
const outRel = await service.pdfRebuild('Docs', 'src.pdf', [{ page: 3 }, { page: 1 }])
assert.equal(outRel, 'src (pages).pdf')
const outBuf = await fs.readFile(join(filesDir, 'src (pages).pdf'))
assert.equal(await pdfPageCount(outBuf), 2)
const outSections = pageSections((await extractPdfText(outBuf)).text)
assert.match(outSections[0], /S3/)
assert.match(outSections[1], /S1/)
assert.equal(await pdfPageCount(await fs.readFile(join(filesDir, 'src.pdf'))), 3)

// conflict suffix
const out2 = await service.pdfRebuild('Docs', 'src.pdf', [{ page: 1 }])
assert.equal(out2, 'src (pages) (2).pdf')

// merge via service
const mergedRel = await service.pdfMerge('Docs', ['src.pdf', 'other.pdf'], '', 'merged.pdf')
assert.equal(mergedRel, 'merged.pdf')
const mergedBuf = await fs.readFile(join(filesDir, 'merged.pdf'))
assert.equal(await pdfPageCount(mergedBuf), 5)
const svcSections = pageSections((await extractPdfText(mergedBuf)).text)
assert.match(svcSections[0], /S1/)
assert.match(svcSections[1], /S2/)
assert.match(svcSections[2], /S3/)
assert.match(svcSections[3], /O1/)
assert.match(svcSections[4], /O2/)

// merge name conflict
const merged2 = await service.pdfMerge('Docs', ['src.pdf', 'other.pdf'], '', 'merged.pdf')
assert.equal(merged2, 'merged (2).pdf')

// rejections
await assert.rejects(() => service.pdfMerge('Docs', ['src.pdf'], '', 'm.pdf'), /at least two/i)
await assert.rejects(() => service.pdfInfo('Docs', 'missing.pdf'), /not found/i)
await assert.rejects(() => service.pdfInfo('Docs', '../etc/passwd'), /not found/i)
await fs.writeFile(join(filesDir, 'note.txt'), 'hello')
await assert.rejects(() => service.pdfInfo('Docs', 'note.txt'), /not a PDF/i)
await assert.rejects(() => service.pdfRenderPage('Docs', 'src.pdf', 99), /out of range/i)

shutdownPdfRenderer()

console.log('PDF OPS TESTS PASSED')
