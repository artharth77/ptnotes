import Module from 'node:module'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { OpenAI } from 'openai'
import type { AIProviderConfig } from '../src/shared/types'
import type { AIConfigStore } from '../src/main/ai/config'

const ROOT = '/tmp/ptnotes-docx-test-root'
const PROJECT = 'Docx Probe'

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return { app: { getPath: () => ROOT }, shell: { showItemInFolder: () => {} } }
  }
  return origLoad.call(this, request, parent, isMain)
}

await fs.rm(ROOT, { recursive: true, force: true })

const { PTNotesService } = await import('../src/main/service/PTNotesService')
const { ModuleRegistry } = await import('../src/main/modules/registry')
const { ModuleRunManager } = await import('../src/main/modules/runs')
const { createDocxModule } = await import('../src/main/modules/docx')
const { buildDocx } = await import('../src/main/modules/docx/builder')

const service = new PTNotesService(ROOT)
await service.createProject(PROJECT)

const configStore = {
  load: async (): Promise<AIProviderConfig> => ({
    baseUrl: 'http://127.0.0.1:9999/v1',
    apiKey: '',
    model: 'fake-model'
  }),
  save: async (c: AIProviderConfig) => c
} as unknown as AIConfigStore

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

function pngMagic(buf: Buffer): void {
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'png magic bytes')
}

async function assertDocx(path: string): Promise<void> {
  const stat = await fs.stat(path)
  assert.ok(stat.size > 100, 'docx file has content')
  const head = await fs.readFile(path)
  assert.deepEqual([...head.subarray(0, 2)], [0x50, 0x4b], 'docx zip magic bytes (PK)')
}

// ---- buildDocx unit tests ----
const docOut = join(ROOT, 'probe-1.docx')
const directDesign = {
  title: 'Probe document',
  theme: { primary: '1F4CA8', accent: 'ED7D31' },
  blocks: [
    { type: 'title-page', title: 'Hello from PTNotes', subtitle: 'automated test', icon: 'rocket' },
    { type: 'heading', level: 1, text: 'Introduction' },
    { type: 'paragraph', text: 'A body paragraph of sample text.' },
    { type: 'bullets', items: ['First point', 'Second point', '\tSub-point detail'] },
    { type: 'numbered', items: ['One', 'Two', '\tNested two'] },
    {
      type: 'table',
      title: 'Plan',
      headers: ['A', 'B'],
      rows: [
        ['1', '2'],
        ['3', '4']
      ]
    },
    { type: 'quote', text: 'A quoted line', author: 'Someone' },
    { type: 'callout', title: 'Note', text: 'Pay attention here.' },
    { type: 'divider' },
    { type: 'paragraph', text: 'Last paragraph.', align: 'justify' },
    { type: 'page-break' },
    { type: 'heading', level: 2, text: 'After break' }
  ]
}
const probeResult = await buildDocx(directDesign, docOut)
assert.equal(probeResult.ok, true, 'valid design builds')
if (probeResult.ok) assert.equal(probeResult.blockCount, 12)
await assertDocx(docOut)

const bad1 = await buildDocx({ blocks: [] }, '/tmp/should-not-exist.docx')
assert.equal(bad1.ok, false, 'empty blocks rejected')
const bad2 = await buildDocx('not-an-object', '/tmp/should-not-exist2.docx')
assert.equal(bad2.ok, false, 'non-object design rejected')

// landscape + narrow margins + footer smoke test
const landscapeOut = join(ROOT, 'probe-landscape.docx')
const landscapeRes = await buildDocx(
  {
    orientation: 'landscape',
    margins: 'narrow',
    footer: 'Confidential',
    blocks: [{ type: 'paragraph', text: 'Landscape body' }]
  },
  landscapeOut
)
assert.equal(landscapeRes.ok, true, 'landscape design builds')
if (landscapeRes.ok) await assertDocx(landscapeOut)

// ---- buildDocx with Lucide title-page icon ----
const iconOut = join(ROOT, 'probe-icon.docx')
const iconRes = await buildDocx(
  {
    blocks: [
      { type: 'title-page', title: 'Icon doc', icon: { name: 'trending-up', color: '#ED7D31' } }
    ]
  },
  iconOut
)
assert.equal(iconRes.ok, true, 'title-page icon builds')
if (iconRes.ok) await assertDocx(iconOut)

const badIcon = await buildDocx(
  { blocks: [{ type: 'title-page', title: 'x', icon: 'no-such-icon' }] },
  join(ROOT, 'probe-bad-icon.docx')
)
assert.equal(badIcon.ok, false, 'unknown icon name fails the build')

// ---- shared chart engine ----
const { validateChart, renderChartPng } = await import('../src/main/modules/shared/chart')

const barDesign = {
  type: 'bar',
  data: {
    labels: ['Q1', 'Q2', 'Q3'],
    datasets: [{ label: 'Sales', data: [4, 7, 3], backgroundColor: '#1F4CA8' }]
  }
}
const cv = validateChart(barDesign)
assert.equal(cv.ok, true, 'valid chart accepted')
let chartPng: Buffer | null = null
if (cv.ok) {
  chartPng = renderChartPng(cv.design, { width: 640, height: 360 })
  pngMagic(chartPng)
}

// ---- shared mermaid diagram engine ----
const { validateMermaid, renderMermaidPng } = await import('../src/main/modules/shared/mermaid')

const flowSrc = `flowchart TD
  A[Start] --> B{Decision}
  B -->|Yes| C[OK]
  B -->|No| D[Cancel]`

const flowValidation = await validateMermaid(flowSrc)
assert.equal(flowValidation.ok, true, 'valid flowchart accepted')
const flowPng = await renderMermaidPng(flowSrc)
pngMagic(flowPng.png)

// ---- shared infographic engine ----
const { validateInfographic, renderInfographicPng } =
  await import('../src/main/modules/shared/infographic')

const infoDsl = `infographic list-column-simple-vertical-arrow
data
  title Product rollout
  lists
    - label Research
      desc Market sizing
    - label Build
      desc Core features
    - label Launch
      desc Public release
`
const infoChecked = await validateInfographic(infoDsl)
assert.equal(infoChecked.ok, true, 'valid infographic DSL accepted')
const infoPng = await renderInfographicPng(infoDsl, 720)
pngMagic(infoPng.png)

// ---- buildDocx with a chart / diagram / infographic image block ----
const tempDir = join(ROOT, PROJECT, '.data', 'modules', 'temp')
await fs.mkdir(tempDir, { recursive: true })
const chartTemp = join(tempDir, 'docx-chart.png')
const diagramTemp = join(tempDir, 'docx-diagram.png')
const infoTemp = join(tempDir, 'docx-infographic.png')
if (chartPng) await fs.writeFile(chartTemp, chartPng)
await fs.writeFile(diagramTemp, flowPng.png)
await fs.writeFile(infoTemp, infoPng.png)

const imageDoc = {
  title: 'Image probe',
  blocks: [
    { type: 'paragraph', text: 'Intro' },
    { type: 'chart', png: chartTemp, caption: 'Quarterly sales', width: 5.0 },
    { type: 'diagram', png: diagramTemp, caption: 'Decision flow' },
    { type: 'infographic', png: infoTemp, caption: 'Rollout timeline' }
  ]
}
const imageOut = join(ROOT, 'probe-image.docx')
const imageRes = await buildDocx(imageDoc, imageOut)
assert.equal(imageRes.ok, true, 'image blocks build')
if (imageRes.ok) await assertDocx(imageOut)

const missingPng = await buildDocx(
  { blocks: [{ type: 'chart', png: '/tmp/does-not-exist.png' }] },
  join(ROOT, 'probe-bad-chart.docx')
)
assert.equal(missingPng.ok, false, 'image block without a valid png fails the build')

// ---- create_docx_file tool ----
const docxTools = Object.fromEntries(
  createDocxModule().tools.map((t) => [t.definition.function.name, t])
)
assert.equal(
  docxTools['create_docx_file'] !== undefined,
  true,
  'docx module exposes create_docx_file'
)

const fileResult = await docxTools['create_docx_file']!.execute(
  { filename: 'cleanup-probe', document: JSON.stringify(imageDoc) },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const fileParsed = JSON.parse(fileResult)
assert.equal(fileParsed.ok, true, 'create_docx_file succeeds')
assert.ok(fileParsed.file?.endsWith('.docx'), 'create_docx_file returns the docx file name')
assert.ok(typeof fileParsed.path === 'string' && fileParsed.path.endsWith('.docx'), 'returns path')
assert.equal(typeof fileParsed.blockCount, 'number', 'reports the block count')
await assertDocx(fileParsed.path)
await assert.rejects(fs.access(chartTemp), 'temp chart png deleted after the docx is built')
await assert.rejects(fs.access(diagramTemp), 'temp diagram png deleted after the docx is built')
await assert.rejects(fs.access(infoTemp), 'temp infographic png deleted after the docx is built')

const afterFile = await service.listFiles(PROJECT)
assert.ok(afterFile.includes(fileParsed.file), 'docx deliverable is in the project files folder')

const badFile = await docxTools['create_docx_file']!.execute(
  { document: JSON.stringify({ blocks: [] }) },
  { service, activeProject: PROJECT, confirm: async () => false }
)
assert.equal(JSON.parse(badFile).ok, false, 'create_docx_file rejects empty blocks')

const notJson = await docxTools['create_docx_file']!.execute(
  { document: '{invalid json' },
  { service, activeProject: PROJECT, confirm: async () => false }
)
assert.equal(JSON.parse(notJson).ok, false, 'create_docx_file rejects malformed JSON')

// ---- simulate a full docx module run with a scripted model ----
interface FakeToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function step(id: string, name: string, args: Record<string, unknown>): FakeToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

function makeScriptedClient(
  scriptArr: { content?: string; tool_calls?: FakeToolCall[] }[]
): (cfg: AIProviderConfig) => OpenAI {
  let i = 0
  return () => {
    return {
      chat: {
        completions: {
          create: async () => {
            const entry = scriptArr[i++] ?? scriptArr[scriptArr.length - 1]!
            const message: Record<string, unknown> = {
              role: 'assistant',
              content: entry.content ?? ''
            }
            if (entry.tool_calls) message.tool_calls = entry.tool_calls
            return { choices: [{ message }] }
          }
        }
      }
    } as unknown as OpenAI
  }
}

const script: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [
      step('d1', 'set_plan', {
        steps: ['Design the document', 'Draft section content', 'Generate the docx file']
      })
    ]
  },
  { tool_calls: [step('d2', 'update_step', { index: 1, status: 'running' })] },
  {
    tool_calls: [
      step('d3', 'update_step', { index: 1, status: 'done' }),
      step('d4', 'update_step', { index: 2, status: 'running' })
    ]
  },
  {
    tool_calls: [
      step('d5', 'update_step', { index: 2, status: 'done' }),
      step('d6', 'create_docx_file', {
        filename: 'status-report',
        document: JSON.stringify({
          title: 'Status Report',
          blocks: [
            { type: 'title-page', title: 'Status Report', subtitle: 'Q1 highlights' },
            { type: 'heading', level: 1, text: 'Highlights' },
            { type: 'bullets', items: ['Strong growth', 'New features'] }
          ]
        })
      })
    ]
  },
  { content: 'Done. Generated status-report.docx.' }
]

const eventTypes: string[] = []
const registry = new ModuleRegistry()
registry.register(createDocxModule())
const manager = new ModuleRunManager(
  service,
  configStore,
  registry,
  (evt) => {
    eventTypes.push(evt.type)
  },
  makeScriptedClient(script)
)

const started = await manager.start(
  PROJECT,
  'docx',
  'Status report document',
  'Build a status report Word document with a title page, a highlights heading and bullets.'
)
assert.equal(started.ok, true, 'start accepts a valid module')
const runId = started.ok ? started.runId : ''

await waitFor(async () => {
  const runs = await manager.list(PROJECT)
  return runs.some((r) => r.runId === runId && (r.status === 'done' || r.status === 'failed'))
})

const run = (await manager.list(PROJECT)).find((r) => r.runId === runId)
assert.ok(run, 'run exists in manager list')
assert.equal(run!.status, 'done', 'run finished as done')
assert.equal(run!.steps.length, 3)
assert.ok(
  run!.steps.every((s) => s.status === 'done'),
  'all steps marked done'
)
assert.ok(run!.outputFile && run!.outputFile.endsWith('.docx'), 'output file captured')
assert.ok(
  Array.isArray(run!.outputFiles) && run!.outputFiles.length === 1,
  'single-output module records exactly one outputFiles entry'
)
await assertDocx(run!.outputFile!)
assert.ok(eventTypes.includes('step'), 'step events were broadcast')
assert.ok(eventTypes.includes('output'), 'output event was broadcast')
assert.ok(eventTypes.includes('done'), 'done event was broadcast')

const stored = await service.listStoredModuleRuns(PROJECT)
assert.ok(
  stored.some((s) => s.runId === runId),
  'run persisted under project modules dir'
)

const unknown = await manager.start(PROJECT, 'nope', 'x', 'y')
assert.equal(unknown.ok, false, 'unknown module rejected')

// ---- disabled module enforcement ----
const { SettingsStore } = await import('../src/main/settings')
const settingsStore = new SettingsStore()
await settingsStore.save({ rootDir: ROOT, disabledModules: ['docx'] })
const gatedManager = new ModuleRunManager(
  service,
  configStore,
  registry,
  () => {},
  undefined,
  settingsStore
)
const disabledStart = await gatedManager.start(PROJECT, 'docx', 'Blocked doc', 'Should be refused.')
assert.equal(disabledStart.ok, false, 'disabled module refused')
await settingsStore.save({ rootDir: ROOT, disabledModules: [] })

// ---- premature finish without the output tool is not silently "done" ----
const prematureScript: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [step('p1', 'set_plan', { steps: ['Research', 'Draft', 'Generate'] })]
  },
  { content: 'I have all the data, here is my summary.' }
]
const prematureManager = new ModuleRunManager(
  service,
  configStore,
  registry,
  () => {},
  makeScriptedClient(prematureScript)
)
const pStart = await prematureManager.start(PROJECT, 'docx', 'No output doc', 'Do the work.')
assert.equal(pStart.ok, true, 'premature run accepted')
const pRunId = pStart.ok ? pStart.runId : ''
await waitFor(async () => {
  const runs = await prematureManager.list(PROJECT)
  return runs.some((r) => r.runId === pRunId && (r.status === 'done' || r.status === 'failed'))
})
const pRun = (await prematureManager.list(PROJECT)).find((r) => r.runId === pRunId)
assert.ok(pRun, 'premature run exists')
assert.equal(pRun!.status, 'failed', 'run without an output file ends failed, not done')
assert.ok(!pRun!.outputFile, 'no output file produced')
assert.match(pRun!.error ?? '', /output file/, 'failure mentions the missing output file')

// ---- deleteRun with deleteOutputFiles removes the deliverable ----
const del = await manager.deleteRun(PROJECT, runId, true)
assert.equal(del, true, 'docx run deletable')
const filesAfterDel = await service.listFiles(PROJECT)
assert.ok(
  !filesAfterDel.includes('status-report.docx'),
  'deleting the run with deleteOutputFiles removes the .docx'
)

console.log('DOCX MODULE TESTS PASSED')
