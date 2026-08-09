import Module from 'node:module'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { OpenAI } from 'openai'
import type { AIProviderConfig } from '../src/shared/types'
import type { AIConfigStore } from '../src/main/ai/config'

const ROOT = '/tmp/ptnotes-modules-test-root'
const PROJECT = 'Research Flow'

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
const { createPptxModule } = await import('../src/main/modules/pptx')
const { buildPptx } = await import('../src/main/modules/pptx/builder')
const { searchLucideIcons, getLucideIconSvg, lucideIconPngDataUri } =
  await import('../src/main/modules/shared/lucideIcons')

const service = new PTNotesService(ROOT)
await service.createProject(PROJECT)

// A config store that always returns a fixed (local) provider.
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

// ---- buildPptx unit test ----
const deckOut = join(ROOT, 'probe-1.pptx')
const directDesign = {
  title: 'Probe deck',
  slides: [
    { layout: 'title', title: 'Hello from PTNotes', subtitle: 'automated test' },
    { layout: 'bullets', title: 'Agenda', body: ['First two', 'Details', 'Wrap-up'] },
    { layout: 'table', title: 'Plan', table: { headers: ['A', 'B'], rows: [['1', '2']] } }
  ]
}
const probeResult = await buildPptx(directDesign, deckOut)
assert.equal(probeResult.ok, true, 'valid design builds')
if (probeResult.ok) assert.equal(probeResult.slideCount, 3)
const stat = await fs.stat(deckOut)
assert.ok(stat.size > 100, 'pptx file has content')

const bad1 = await buildPptx({ slides: [] }, '/tmp/should-not-exist.pptx')
assert.equal(bad1.ok, false, 'empty slides rejected')
const bad2 = await buildPptx('not-an-object', '/tmp/should-not-exist2.pptx')
assert.equal(bad2.ok, false, 'non-object design rejected')

// ---- shared Lucide icon library ----
const hits = searchLucideIcons('chart')
assert.ok(hits.length > 0 && hits[0]!.name.startsWith('chart'), 'search returns chart icons')
const rocketHits = searchLucideIcons('rocket')
assert.ok(
  rocketHits.some((h) => h.name === 'rocket'),
  'search finds the rocket icon'
)
const rocketSvg = getLucideIconSvg('rocket', '#ED7D31')
assert.equal(rocketSvg.ok, true, 'rocket resolves')
if (rocketSvg.ok) {
  assert.ok(rocketSvg.svg.trimStart().startsWith('<svg'), 'returns svg source')
  assert.ok(rocketSvg.svg.includes('stroke="#ED7D31"'), 'stroke color injected')
}
const rocketPng = lucideIconPngDataUri('rocket', { color: '#ED7D31', sizePx: 128 })
assert.equal(rocketPng.ok, true, 'png renders')
if (rocketPng.ok) {
  const buf = Buffer.from(
    rocketPng.dataUri.slice(rocketPng.dataUri.indexOf('base64,') + 7),
    'base64'
  )
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'png magic bytes')
}
assert.equal(getLucideIconSvg('no-such-icon-xyz').ok, false, 'unknown icon rejected')

// ---- buildPptx with icons ----
const iconDesign = {
  title: 'Icon probe',
  slides: [
    { layout: 'title', title: 'Growth plan', icon: { name: 'trending-up', size: 1.0 } },
    { layout: 'section', statement: 'Results', icon: 'trending-up' },
    {
      layout: 'bullets',
      title: 'Details',
      body: ['A', 'B'],
      icon: { name: 'rocket', color: '#333333' }
    }
  ]
}
const iconOut = join(ROOT, 'probe-icons.pptx')
const iconRes = await buildPptx(iconDesign, iconOut)
assert.equal(iconRes.ok, true, 'icon design builds')
if (iconRes.ok) assert.equal(iconRes.slideCount, 3)
const iconStat = await fs.stat(iconOut)
assert.ok(iconStat.size > 100, 'icon pptx file has content')

const badIcon = await buildPptx(
  { slides: [{ layout: 'bullets', title: 'x', icon: 'no-such-icon' }] },
  join(ROOT, 'probe-bad-icon.pptx')
)
assert.equal(badIcon.ok, false, 'unknown icon name fails the build')

// ---- simulate a full module run with a scripted model ----
interface FakeToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function step(id: string, name: string, args: Record<string, unknown>): FakeToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

const script: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [
      step('c1', 'set_plan', {
        steps: ['Design the deck', 'Draft slide content', 'Generate the pptx file']
      })
    ]
  },
  { tool_calls: [step('c2', 'update_step', { index: 1, status: 'running' })] },
  {
    tool_calls: [
      step('c3', 'update_step', { index: 1, status: 'done' }),
      step('c4', 'update_step', { index: 2, status: 'running' })
    ]
  },
  {
    tool_calls: [
      step('c5', 'update_step', { index: 2, status: 'done' }),
      step('c6', 'update_step', { index: 3, status: 'running' })
    ]
  },
  {
    tool_calls: [
      step('c7', 'update_step', { index: 3, status: 'done' }),
      step('c8', 'create_pptx_file', {
        filename: 'quarterly-deck',
        design: JSON.stringify({
          title: 'Quarterly Review',
          slides: [
            { layout: 'title', title: 'Quarterly Review', subtitle: 'Q1 highlights' },
            { layout: 'bullets', title: 'Highlights', body: ['Strong growth', 'New features'] }
          ]
        })
      })
    ]
  },
  { content: 'Done. Generated quarterly-review.pptx.' }
]

const fakeClientFactory = makeScriptedClient(script)

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

const eventTypes: string[] = []
const registry = new ModuleRegistry()
registry.register(createPptxModule())
const manager = new ModuleRunManager(
  service,
  configStore,
  registry,
  (evt) => {
    eventTypes.push(evt.type)
  },
  fakeClientFactory
)

const started = await manager.start(
  PROJECT,
  'pptx',
  'Quarterly Review deck',
  'Build a quarterly review presentation with a title slide and highlights.'
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
assert.ok(
  run!.steps.every((s) => typeof s.updatedAt === 'number' && s.updatedAt > 0),
  'each step has a status-change timestamp'
)
assert.ok(run!.outputFile && run!.outputFile.endsWith('.pptx'), 'output file captured')
const outStat = await fs.stat(run!.outputFile!)
assert.ok(outStat.size > 100, 'output pptx exists on disk')
assert.ok(eventTypes.includes('step'), 'step events were broadcast')
assert.ok(eventTypes.includes('output'), 'output event was broadcast')
assert.ok(eventTypes.includes('done'), 'done event was broadcast')

const stored = await service.listStoredModuleRuns(PROJECT)
const storedRun = stored.find((s) => s.runId === runId)
assert.ok(storedRun, 'run persisted under project modules dir')
assert.ok(
  storedRun!.steps.every((s) => typeof s.updatedAt === 'number'),
  'step timestamps persisted in the JSON run file'
)

const unknown = await manager.start(PROJECT, 'nope', 'x', 'y')
assert.equal(unknown.ok, false, 'unknown module rejected')

const edge = await manager.start(PROJECT, 'pptx', '', 'no title')
assert.equal(edge.ok, false, 'empty title rejected')

const cleared = await manager.clearHistory(PROJECT)
assert.equal(cleared, 1, 'clearHistory removes the just-finished run')
const afterClear = await manager.list(PROJECT)
assert.ok(!afterClear.some((r) => r.runId === runId), 'finished run no longer listed')
assert.equal(
  (await service.listStoredModuleRuns(PROJECT)).some((r) => r.runId === runId),
  false,
  'run file removed from disk'
)

// ---- disabled module enforcement ----
const { SettingsStore } = await import('../src/main/settings')
const settingsStore = new SettingsStore()
await settingsStore.save({ rootDir: ROOT, disabledModules: ['pptx'] })
const gatedManager = new ModuleRunManager(
  service,
  configStore,
  registry,
  () => {},
  undefined,
  settingsStore
)
const disabledStart = await gatedManager.start(
  PROJECT,
  'pptx',
  'Blocked deck',
  'This should be refused.'
)
assert.equal(disabledStart.ok, false, 'disabled module refused')
await settingsStore.save({ rootDir: ROOT, disabledModules: [] })
const reEnabled = await gatedManager.start(PROJECT, 'pptx', 'Now allowed', 'Should start.')
assert.equal(reEnabled.ok, true, 're-enabled module accepted')
const reRunId = reEnabled.ok ? reEnabled.runId : ''
await waitFor(async () => {
  const runs = await gatedManager.list(PROJECT)
  return runs.some((r) => r.runId === reRunId && (r.status === 'done' || r.status === 'failed'))
})

// ---- step status cascade: later step done promotes earlier running/pending steps ----
const cascadeScript: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [step('f1', 'set_plan', { steps: ['Research', 'Draft', 'Generate'] })]
  },
  { tool_calls: [step('f2', 'update_step', { index: 1, status: 'running' })] },
  // jump straight to step 3 done, leaving step 1 running and step 2 pending
  { tool_calls: [step('f3', 'update_step', { index: 3, status: 'done' })] },
  { content: 'Done.' }
]
const cascadeManager = new ModuleRunManager(
  service,
  configStore,
  registry,
  () => {},
  makeScriptedClient(cascadeScript)
)
const cStart = await cascadeManager.start(PROJECT, 'pptx', 'Cascade deck', 'Use short steps.')
assert.equal(cStart.ok, true, 'cascade run accepted')
const cRunId = cStart.ok ? cStart.runId : ''
await waitFor(async () => {
  const runs = await cascadeManager.list(PROJECT)
  return runs.some((r) => r.runId === cRunId && (r.status === 'done' || r.status === 'failed'))
})
const cRun = (await cascadeManager.list(PROJECT)).find((r) => r.runId === cRunId)
assert.ok(cRun, 'cascade run exists')
assert.equal(cRun!.status, 'done', 'cascade run finished')
assert.equal(cRun!.steps[0]!.status, 'done', 'previous running step promoted to done')
assert.equal(cRun!.steps[1]!.status, 'done', 'previous pending step promoted to done')
assert.equal(cRun!.steps[2]!.status, 'done', 'target step stays done')

console.log('MODULES TESTS PASSED')
