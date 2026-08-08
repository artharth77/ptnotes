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

let callIndex = 0
const fakeClientFactory = (): OpenAI => {
  return {
    chat: {
      completions: {
        create: async () => {
          const entry = script[callIndex++] ?? script[script.length - 1]!
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

console.log('MODULES TESTS PASSED')
