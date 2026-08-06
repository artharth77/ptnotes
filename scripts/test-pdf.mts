import Module from 'node:module'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'

const ROOT = '/tmp/ptnotes-pdf-test-root'

let FAKE_TEXT = 'Hello PDF content'
let FAKE_PAGES = 3

class FakePDFParse {
  async getText(): Promise<{ text: string; total: number; pages: unknown[] }> {
    return { text: FAKE_TEXT, total: FAKE_PAGES, pages: [] }
  }
  async destroy(): Promise<void> {
    return
  }
}

class FakeOpenAI {
  get chat(): unknown {
    return { completions: { create: async () => ({ choices: [{ message: { content: '' } }] }) } }
  }
  get files(): unknown {
    return {
      create: async () => {
        if (FAIL_FILES_CREATE) throw new Error('Files API unsupported')
        return { id: 'file-test-1' }
      }
    }
  }
  get responses(): unknown {
    return { create: async () => fakeResponsesStream() }
  }
}

let FAIL_FILES_CREATE = false

async function* fakeResponsesStream(): AsyncIterable<Record<string, unknown>> {
  yield { type: 'response.output_text.delta', delta: 'Summary from PDF.' }
  yield { type: 'response.completed' }
}

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return { app: { getPath: () => ROOT }, shell: { showItemInFolder: () => {} } }
  }
  if (request === 'pdf-parse') {
    return { PDFParse: FakePDFParse }
  }
  if (request === 'openai') {
    return FakeOpenAI
  }
  return origLoad.call(this, request, parent, isMain)
}

await fs.rm(ROOT, { recursive: true, force: true })

const { PTNotesService } = await import('../src/main/service/PTNotesService')
const { extractPdf, MAX_PDF_CHARS } = await import('../src/main/ai/pdf')
const { ChatSession } = await import('../src/main/ai/chatSession')

const service = new PTNotesService(ROOT)
await service.createProject('Test')

// ---- extractPdf: happy path ----
const pdfPath = `${ROOT}/sample.pdf`
await fs.writeFile(pdfPath, '%PDF-1.4 fake body')
FAKE_TEXT = 'Hello PDF content'
FAKE_PAGES = 3
let res = await extractPdf(pdfPath)
assert.equal(res.text, 'Hello PDF content')
assert.equal(res.pageCount, 3)
assert.equal(res.charCount, 17)
assert.equal(res.truncated, false)

// ---- extractPdf: truncation ----
FAKE_TEXT = 'x'.repeat(MAX_PDF_CHARS + 500)
res = await extractPdf(pdfPath)
assert.equal(res.truncated, true)
assert.equal(res.text.length, MAX_PDF_CHARS)
assert.equal(res.charCount, MAX_PDF_CHARS + 500)

// ---- extractPdf: invalid magic bytes ----
const badPath = `${ROOT}/not-a-pdf.txt`
await fs.writeFile(badPath, 'this is not a pdf')
await assert.rejects(() => extractPdf(badPath), /not a valid PDF/)

// ---- copyPdfToProject ----
const src = `${ROOT}/My Report.pdf`
await fs.writeFile(src, '%PDF-1.4 source')
const saved1 = await service.copyPdfToProject('Test', src, 'My Report.pdf')
assert.equal(saved1, `${ROOT}/Test/files/my-report.pdf`)
assert.equal(await fs.readFile(saved1, 'utf8'), '%PDF-1.4 source')
const saved2 = await service.copyPdfToProject('Test', src, 'My Report.pdf')
assert.equal(saved2, saved1, 'identical upload (same name+size+hash) reuses existing file')
await fs.writeFile(src, '%PDF-1.4 changed')
const saved3 = await service.copyPdfToProject('Test', src, 'My Report.pdf')
assert.equal(saved3, `${ROOT}/Test/files/my-report-2.pdf`, 'changed content gets a new file')

// ---- uploadPdf: uploads via provider Files API (file_id) + streams ----
const events: unknown[] = []
const session = new ChatSession(
  async () => ({ baseUrl: 'http://127.0.0.1:9999/v1', apiKey: '', model: 'm' }),
  { service, activeProject: 'Test' },
  (evt) => events.push(evt)
)
await session.uploadPdf('Summarize this', 'sample.pdf', 'AAAA')

let contentEvents = events.filter((e) => (e as { type?: string }).type === 'content') as {
  content: string
}[]
assert.ok(contentEvents.length > 0, 'received streamed content')
assert.match(contentEvents.map((e) => e.content).join(''), /Summary from PDF\./)
let types = events.map((e) => (e as { type: string }).type)
assert.ok(types.includes('message-start'), 'message-start emitted')
assert.ok(types.includes('message-end'), 'message-end emitted')

// ---- uploadPdf: falls back to inline base64 when Files API is unavailable ----
FAIL_FILES_CREATE = true
const fbEvents: unknown[] = []
const fbSession = new ChatSession(
  async () => ({ baseUrl: 'http://127.0.0.1:9999/v1', apiKey: '', model: 'm' }),
  { service, activeProject: 'Test' },
  (evt) => fbEvents.push(evt)
)
await fbSession.uploadPdf('Summarize this', 'sample.pdf', 'AAAA')
contentEvents = fbEvents.filter((e) => (e as { type?: string }).type === 'content') as {
  content: string
}[]
assert.ok(contentEvents.length > 0, 'fallback still streamed content')
types = fbEvents.map((e) => (e as { type: string }).type)
assert.ok(types.includes('message-end'), 'fallback message-end emitted')

console.log('PDF TEST PASSED')
