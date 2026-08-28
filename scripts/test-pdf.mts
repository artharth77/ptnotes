import Module from 'node:module'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'
import type { ToolContext } from '../src/main/ai/tools'
import ExcelJS from 'exceljs'

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
  yield {
    type: 'response.completed',
    response: { usage: { input_tokens: 10, output_tokens: 5 } }
  }
}

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return {
      app: { getPath: () => ROOT, getAppPath: () => ROOT },
      shell: { showItemInFolder: () => {} }
    }
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
const { extractPdf, readFileAsText, detectFileKind, MAX_PDF_CHARS } =
  await import('../src/main/ai/reader')
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

const mdPath = `${ROOT}/notes.md`
await fs.writeFile(mdPath, '# Notes\n\nSome markdown content')
const binPath = `${ROOT}/image.png`
await fs.writeFile(binPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))

// ---- detectFileKind: content-based, not extension-based ----
assert.equal(await detectFileKind(pdfPath), 'pdf', 'PDF magic bytes detected')
assert.equal(await detectFileKind(mdPath), 'text', 'markdown is text')

const xlsxPath = `${ROOT}/sample.xlsx`
const wb = new ExcelJS.Workbook()
const ws = wb.addWorksheet('Sheet1')
ws.getCell('A1').value = 'Name'
ws.getCell('B1').value = 'Value'
ws.getCell('A2').value = 'Test'
ws.getCell('B2').value = 123
await wb.xlsx.writeFile(xlsxPath)
assert.equal(await detectFileKind(xlsxPath), 'excel', 'Excel magic bytes + ext detected')

const multiXlsx = `${ROOT}/multi.xlsx`
const mwb = new ExcelJS.Workbook()
const mws1 = mwb.addWorksheet('Q1 Data')
mws1.getCell('A1').value = 'Month'
mws1.getCell('B1').value = 'Sales'
mws1.getCell('A2').value = 'Jan'
mws1.getCell('B2').value = 100
const mws2 = mwb.addWorksheet('Summary')
mws2.getCell('A1').value = 'Metric'
mws2.getCell('A2').value = 'Total'
await mwb.xlsx.writeFile(multiXlsx)

const fakeXlsx = `${ROOT}/fake.xlsx`
await fs.writeFile(fakeXlsx, 'not a zip')
assert.notEqual(await detectFileKind(fakeXlsx), 'excel', 'not a zip is not excel')

assert.equal(
  await detectFileKind(binPath),
  'unsupported',
  'binary without PDF magic is unsupported'
)

// ---- readFileAsText: rejects non-PDF binary ----
await assert.rejects(() => readFileAsText(binPath), /binary file/)

// ---- readFileAsText: markdown / plain text ----
let res2 = await readFileAsText(mdPath)
assert.equal(res2.text, '# Notes\n\nSome markdown content')
assert.equal(res2.pageCount, 0)
assert.equal(res2.charCount, 30)
assert.equal(res2.truncated, false)

const resXlsx = await readFileAsText(xlsxPath, 'json')
assert.ok(resXlsx.text.includes('"Name"'), 'JSON contains headers')
assert.ok(resXlsx.text.includes('"Test"'), 'JSON contains data')
assert.ok(resXlsx.text.includes('123'), 'JSON contains numbers')

const resXlsxCsv = await readFileAsText(xlsxPath, 'csv')
assert.ok(resXlsxCsv.text.includes('## Sheet: Sheet1'), 'CSV contains sheet header')
assert.ok(resXlsxCsv.text.includes('Name,Value'), 'CSV contains headers')
assert.ok(resXlsxCsv.text.includes('Test,123'), 'CSV contains data')

// ---- readFileAsText: workbook query (worksheet filter) ----
const { parseWorkbookQuery } = await import('../src/main/ai/reader')

const qByName = await readFileAsText(multiXlsx, 'json', { workspace: 'Q1 Data' })
assert.ok(qByName.text.includes('"Month"'), 'query by sheet name returns Q1 Data rows')
assert.ok(!qByName.text.includes('Total'), 'other sheets excluded when queried')

const qByNameCase = await readFileAsText(
  multiXlsx,
  'json',
  parseWorkbookQuery('workspace=q1%20data')
)
assert.ok(qByNameCase.text.includes('"Month"'), 'query value is URL-decoded and case-insensitive')

const qByNumber = await readFileAsText(multiXlsx, 'json', parseWorkbookQuery('workspace=2'))
assert.ok(qByNumber.text.includes('"Metric"'), 'query by 1-based worksheet number')

const qCsvByQuery = await readFileAsText(multiXlsx, 'csv', parseWorkbookQuery('workspace=Summary'))
assert.ok(
  qCsvByQuery.text.includes('## Sheet: Summary') && !qCsvByQuery.text.includes('Q1 Data'),
  'csv query returns only the selected sheet'
)

await assert.rejects(
  () => readFileAsText(multiXlsx, 'json', parseWorkbookQuery('workspace=Nope')),
  /not found.*Available worksheets/,
  'unknown worksheet lists available sheets'
)
assert.throws(() => parseWorkbookQuery('foo=bar'), /Unsupported query variable/)
assert.throws(() => parseWorkbookQuery(''), /Empty query/)
assert.throws(
  () => parseWorkbookQuery('list=sheet'),
  /Unsupported value "sheet" for variable "list"/
)
assert.throws(() => parseWorkbookQuery('list=workspace&workspace=1'), /not both/)

// ---- readFileAsText: list=workspace returns worksheet index/name list ----
const qList = await readFileAsText(multiXlsx, 'json', parseWorkbookQuery('list=workspace'))
const parsedList = JSON.parse(qList.text)
assert.deepEqual(
  parsedList,
  [
    { index: 1, name: 'Q1 Data' },
    { index: 2, name: 'Summary' }
  ],
  'list=workspace returns indexed sheet names'
)
await assert.rejects(
  () => readFileAsText(mdPath, 'json', parseWorkbookQuery('list=workspace')),
  /only supported for Excel/,
  'list query rejected for non-Excel files'
)

await assert.rejects(
  () => readFileAsText(mdPath, 'json', parseWorkbookQuery('workspace=1')),
  /only supported for Excel/,
  'query rejected for non-Excel files'
)

const longTxt = 'x'.repeat(MAX_PDF_CHARS + 100)
const txtPath = `${ROOT}/long.txt`
await fs.writeFile(txtPath, longTxt)
res2 = await readFileAsText(txtPath)
assert.equal(res2.truncated, true)
assert.equal(res2.text.length, MAX_PDF_CHARS)
assert.equal(res2.charCount, MAX_PDF_CHARS + 100)

// ---- copyFileToProject: .md / .txt ----
const mdSrc = `${ROOT}/My Notes.md`
await fs.writeFile(mdSrc, '# Hello')
const mdSaved = await service.copyFileToProject('Test', mdSrc, 'My Notes.md')
assert.equal(mdSaved, `${ROOT}/Test/files/my-notes.md`)
assert.equal(await fs.readFile(mdSaved, 'utf8'), '# Hello')
const mdSaved2 = await service.copyFileToProject('Test', mdSrc, 'My Notes.md')
assert.equal(mdSaved2, mdSaved, 'identical md reuses existing copy')
const txtSrc = `${ROOT}/readme.txt`
await fs.writeFile(txtSrc, 'plain text')
const txtSaved = await service.copyFileToProject('Test', txtSrc, 'readme.txt')
assert.equal(txtSaved, `${ROOT}/Test/files/readme.txt`)

const xlsxSrc = `${ROOT}/sample.xlsx`
const xlsxSaved = await service.copyFileToProject('Test', xlsxSrc, 'sample.xlsx')
assert.equal(xlsxSaved, `${ROOT}/Test/files/sample.xlsx`)
await assert.rejects(() => service.copyFileToProject('Test', binPath, 'image.png'), /binary file/)
assert.ok((await service.listFiles('Test')).includes('my-notes.md'), 'listFiles surfaces .md')
assert.ok((await service.listFiles('Test')).includes('readme.txt'), 'listFiles surfaces .txt')

// ---- copyFileToProject: JSON / YAML / log text formats ----
const jsonSrc = `${ROOT}/data.json`
await fs.writeFile(jsonSrc, '{"a": 1}')
const jsonSaved = await service.copyFileToProject('Test', jsonSrc, 'data.json')
assert.equal(jsonSaved, `${ROOT}/Test/files/data.json`, '.json preserved')
const yamlSrc = `${ROOT}/config.yaml`
await fs.writeFile(yamlSrc, 'a: 1\nb: two')
const yamlSaved = await service.copyFileToProject('Test', yamlSrc, 'config.yaml')
assert.equal(yamlSaved, `${ROOT}/Test/files/config.yaml`, '.yaml preserved')
const ymlSrc = `${ROOT}/k8s.yml`
await fs.writeFile(ymlSrc, 'apiVersion: v1')
const ymlSaved = await service.copyFileToProject('Test', ymlSrc, 'k8s.yml')
assert.equal(ymlSaved, `${ROOT}/Test/files/k8s.yml`, '.yml preserved')
const logSrc = `${ROOT}/server.log`
await fs.writeFile(logSrc, 'INFO started\nWARN retry')
const logSaved = await service.copyFileToProject('Test', logSrc, 'server.log')
assert.equal(logSaved, `${ROOT}/Test/files/server.log`, '.log preserved')

// a text file with an unknown extension is still accepted (no extension whitelist)
const datSrc = `${ROOT}/data.csv`
await fs.writeFile(datSrc, 'a,b,c\n1,2,3')
const datSaved = await service.copyFileToProject('Test', datSrc, 'data.csv')
assert.equal(datSaved, `${ROOT}/Test/files/data.csv`, 'unknown text extension accepted')

// a PDF renamed with a .txt extension is still detected as a PDF by content
const pdfAsTxt = `${ROOT}/renamed.txt`
await fs.writeFile(pdfAsTxt, '%PDF-1.4 fake body')
const pdfAsTxtSaved = await service.copyFileToProject('Test', pdfAsTxt, 'renamed.txt')
assert.equal(pdfAsTxtSaved, `${ROOT}/Test/files/renamed.pdf`, 'PDF content wins over .txt name')

// listFiles surfaces the new text formats
const fileList = await service.listFiles('Test')
assert.ok(fileList.includes('data.json'), 'listFiles surfaces .json')
assert.ok(fileList.includes('config.yaml'), 'listFiles surfaces .yaml')
assert.ok(fileList.includes('k8s.yml'), 'listFiles surfaces .yml')
assert.ok(fileList.includes('server.log'), 'listFiles surfaces .log')

// ---- copyPdfToProject ----
const src = `${ROOT}/My Report.pdf`
await fs.writeFile(src, '%PDF-1.4 source')
const saved1 = await service.copyFileToProject('Test', src, 'My Report.pdf')
assert.equal(saved1, `${ROOT}/Test/files/my-report.pdf`)
assert.equal(await fs.readFile(saved1, 'utf8'), '%PDF-1.4 source')
const saved2 = await service.copyFileToProject('Test', src, 'My Report.pdf')
assert.equal(saved2, saved1, 'identical upload (same name+size+hash) reuses existing file')
await fs.writeFile(src, '%PDF-1.4 changed')
const saved3 = await service.copyFileToProject('Test', src, 'My Report.pdf')
assert.equal(saved3, `${ROOT}/Test/files/my-report-2.pdf`, 'changed content gets a new file')

// ---- listFiles / projectFilePath / read_file tool ----
const { tools } = await import('../src/main/ai/tools')
const ctx: ToolContext = { service, activeProject: 'Test' }
const fileList2 = await service.listFiles('Test')
assert.ok(fileList2.includes('my-report.pdf'), 'lists copied files')
assert.ok(fileList2.includes('my-report-2.pdf'))
assert.equal(
  await service.projectFilePath('Test', 'my-report.pdf'),
  `${ROOT}/Test/files/my-report.pdf`
)
assert.equal(await service.projectFilePath('Test', '../board.json'), null, 'rejects path traversal')

FAKE_TEXT = 'Hello PDF content'
FAKE_PAGES = 2
const readFileTool = tools.find((t) => t.definition.function.name === 'read_file')!
const rr = JSON.parse(await readFileTool.execute({ name: 'my-report.pdf' }, ctx))
assert.equal(rr.ok, true)
assert.equal(rr.file, 'my-report.pdf')
assert.equal(rr.pageCount, 2)
assert.match(rr.text, /Hello PDF content/)
const rrMissing = JSON.parse(await readFileTool.execute({ name: 'nope.pdf' }, ctx))
assert.equal(rrMissing.ok, false)
assert.match(rrMissing.error, /not found/)

const mdRead = JSON.parse(await readFileTool.execute({ name: 'my-notes.md' }, ctx))
assert.equal(mdRead.ok, true)
assert.equal(mdRead.pageCount, 0)
assert.match(mdRead.text, /# Hello/)
const txtRead = JSON.parse(await readFileTool.execute({ name: 'readme.txt' }, ctx))
assert.equal(txtRead.ok, true)
assert.equal(txtRead.pageCount, 0)
assert.match(txtRead.text, /plain text/)

const xlsxRead = JSON.parse(await readFileTool.execute({ name: 'sample.xlsx' }, ctx))
assert.equal(xlsxRead.ok, true)
assert.ok(xlsxRead.text.includes('"Name"'), 'Tool reads Excel JSON')
const xlsxReadCsv = JSON.parse(
  await readFileTool.execute({ name: 'sample.xlsx', format: 'csv' }, ctx)
)
assert.equal(xlsxReadCsv.ok, true)
assert.ok(xlsxReadCsv.text.includes('Name,Value'), 'Tool reads Excel CSV')

const multiSaved = await service.copyFileToProject('Test', multiXlsx, 'multi.xlsx')
assert.equal(multiSaved, `${ROOT}/Test/files/multi.xlsx`)
const qToolName = JSON.parse(
  await readFileTool.execute({ name: 'multi.xlsx', query: 'workspace=Q1%20Data' }, ctx)
)
assert.equal(qToolName.ok, true)
assert.ok(qToolName.text.includes('"Month"'), 'Tool query by URL-encoded sheet name')
const qToolNum = JSON.parse(
  await readFileTool.execute({ name: 'multi.xlsx', query: 'workspace=2' }, ctx)
)
assert.equal(qToolNum.ok, true)
assert.ok(qToolNum.text.includes('"Metric"'), 'Tool query by worksheet number')
const qToolBad = JSON.parse(
  await readFileTool.execute({ name: 'multi.xlsx', query: 'workspace=Nope' }, ctx)
)
assert.equal(qToolBad.ok, false)
assert.match(qToolBad.error, /not found/)
const qToolVar = JSON.parse(
  await readFileTool.execute({ name: 'multi.xlsx', query: 'foo=bar' }, ctx)
)
assert.equal(qToolVar.ok, false)
assert.match(qToolVar.error, /Unsupported query variable/)
const qToolMd = JSON.parse(
  await readFileTool.execute({ name: 'my-notes.md', query: 'workspace=1' }, ctx)
)
assert.equal(qToolMd.ok, false)
assert.match(qToolMd.error, /only supported for Excel/)
const qToolList = JSON.parse(
  await readFileTool.execute({ name: 'multi.xlsx', query: 'list=workspace' }, ctx)
)
assert.equal(qToolList.ok, true)
const qToolListParsed = JSON.parse(qToolList.text)
assert.equal(qToolListParsed.length, 2)
assert.deepEqual(qToolListParsed[0], { index: 1, name: 'Q1 Data' })
assert.deepEqual(qToolListParsed[1], { index: 2, name: 'Summary' })

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
const endEvt = events.find((e) => (e as { type?: string }).type === 'message-end') as
  { usage?: unknown } | undefined
assert.ok(endEvt?.usage, 'message-end carries usage')

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
