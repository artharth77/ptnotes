import Module from 'node:module'
import http from 'node:http'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import type { OpenAI } from 'openai'
import type { AIProviderConfig } from '../src/shared/types'
import type { AIConfigStore } from '../src/main/ai/config'
import type { PTTool } from '../src/main/ai/tools'
import { AiTraceRecorder } from '../src/main/ai/trace'

const ROOT = '/tmp/ptnotes-chat-test-root'

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return { app: { getPath: () => ROOT, getAppPath: () => ROOT } }
  }
  return origLoad.call(this, request, parent, isMain)
}

await fs.rm(ROOT, { recursive: true, force: true })

const { PTNotesService } = await import('../src/main/service/PTNotesService')
const { ChatSession } = await import('../src/main/ai/chatSession')
const { ModuleRegistry } = await import('../src/main/modules/registry')
const { ModuleRunManager } = await import('../src/main/modules/runs')
const { createPptxModule } = await import('../src/main/modules/pptx')
const { buildStartModuleTool, buildWaitModulesTool } = await import('../src/main/modules/tool')

// ---- Mock OpenAI-compatible streaming server ----
let turn = 0
const toolCallChunks = [
  {
    id: 'call_1',
    type: 'function',
    function: {
      name: 'create_note',
      arguments: '{"title":"From Chat","content":"# Hi\\n\\nvia chat"}'
    }
  }
]

const sse = (chunk: unknown): string => `data: ${JSON.stringify(chunk)}\n\n`

const server = http.createServer(async (req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const parsed = JSON.parse(body)
    const userMsg = [...parsed.messages].reverse().find((m: { role: string }) => m.role === 'user')
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    if (turn === 0) {
      // Turn 1: stream tool_calls then finish
      res.write(
        sse({
          id: '1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
        })
      )
      for (const tc of toolCallChunks) {
        res.write(
          sse({
            id: '1',
            object: 'chat.completion.chunk',
            created: 1,
            model: 't',
            choices: [{ index: 0, delta: { tool_calls: [tc] }, finish_reason: null }]
          })
        )
      }
      res.write(
        sse({
          id: '1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
        })
      )
      res.write(
        sse({
          id: '1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        })
      )
      turn = 1
    } else {
      // Turn 2: stream reasoning_content (think) then final text
      const content = `Done: created note for "${userMsg.content}".`
      res.write(
        sse({
          id: '2',
          object: 'chat.completion.chunk',
          created: 2,
          model: 't',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', reasoning_content: 'User wants a note.' },
              finish_reason: null
            }
          ]
        })
      )
      res.write(
        sse({
          id: '2',
          object: 'chat.completion.chunk',
          created: 2,
          model: 't',
          choices: [{ index: 0, delta: { content }, finish_reason: null }]
        })
      )
      res.write(
        sse({
          id: '2',
          object: 'chat.completion.chunk',
          created: 2,
          model: 't',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        })
      )
      res.write(
        sse({
          id: '2',
          object: 'chat.completion.chunk',
          created: 2,
          model: 't',
          choices: [],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 15,
            prompt_tokens_details: { cached_tokens: 8 }
          }
        })
      )
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})

await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as { port: number }).port

// ---- Run session ----
const service = new PTNotesService(ROOT)
await service.createProject('Test')

const events: unknown[] = []
const session = new ChatSession(
  async () => ({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: '', model: 'test-model' }),
  { service, activeProject: 'Test' },
  (evt) => events.push(evt)
)

await session.send('create a note saying hi')

server.close()

// ---- Assertions ----
const contentEvents = events.filter(
  (e: { type?: string }) => (e as { type: string }).type === 'content'
)
assert.ok(contentEvents.length > 0, 'received streamed content')
const finalContent = contentEvents.map((e) => (e as { content: string }).content).join('')
assert.match(finalContent, /Done: created note/)

const toolEvents = events.filter((e: { type?: string }) => (e as { type: string }).type === 'tool')
assert.equal(toolEvents.length, 1, 'one tool call')
const tc = toolEvents[0] as { toolCall: { name: string; ok: boolean } }
assert.equal(tc.toolCall.name, 'create_note')
assert.equal(tc.toolCall.ok, true)

const noteExists = await fs
  .readFile(`${ROOT}/Test/notes/from-chat.md`, 'utf8')
  .then((c) => c.includes('via chat'))
  .catch(() => false)
assert.ok(noteExists, 'note file written by tool')

const endEvents = events.filter(
  (e: { type?: string }) => (e as { type: string }).type === 'message-end'
)
assert.equal(endEvents.length, 2, 'two turns completed')
const endWithUsage = endEvents.filter((e) => (e as { usage?: unknown }).usage)
assert.equal(endWithUsage.length, 2, 'message-end carries usage on both turns')

const thinkEvents = events.filter(
  (e: { type?: string; content?: string }) =>
    (e as { type: string }).type === 'content' &&
    ((e as { content: string }).content ?? '').includes('<think')
)
assert.equal(thinkEvents.length, 1, 'reasoning_content wrapped in <think>')
assert.match(finalContent, /<think>User wants a note\.<\/think>/, 'think block opened and closed')

// ---- send(history): past conversation is included as model context ----
let histReqMessages: unknown[] | null = null
const histServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    histReqMessages = JSON.parse(body).messages
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write(
      sse({
        id: 'h',
        object: 'chat.completion.chunk',
        created: 1,
        model: 't',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }]
      })
    )
    res.write(
      sse({
        id: 'h',
        object: 'chat.completion.chunk',
        created: 1,
        model: 't',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      })
    )
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise<void>((r) => histServer.listen(0, '127.0.0.1', r))
const histPort = (histServer.address() as { port: number }).port

const history = [
  { id: 'h1', role: 'user', content: 'Remember this context.', toolCalls: [] },
  { id: 'h2', role: 'assistant', content: 'I remember.', toolCalls: [] }
]
const ctxEvents: unknown[] = []
const ctxSession = new ChatSession(
  async () => ({ baseUrl: `http://127.0.0.1:${histPort}/v1`, apiKey: '', model: 'test-model' }),
  { service, activeProject: 'Test' },
  (evt) => ctxEvents.push(evt)
)
await ctxSession.send('and my new question', history)
histServer.close()

assert.ok(histReqMessages, 'captured outgoing messages')
const sentRoles = (histReqMessages as { role: string; content?: string }[]).map((m) => ({
  role: m.role,
  content: m.content ?? ''
}))
const sentUsers = sentRoles.filter((m) => m.role === 'user').map((m) => m.content)
assert.ok(
  sentUsers.some((c) => c.includes('Remember this context.')),
  'history user message is included in model context'
)
assert.equal(
  sentUsers[sentUsers.length - 1],
  'and my new question',
  'new message appended after history'
)

// ---- End-to-end: main chat starts 2 modules → wait_modules → continues with results ----
interface FakeToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function step(id: string, name: string, args: Record<string, unknown>): FakeToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

const moduleScript: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [
      step('m1', 'set_plan', { steps: ['Build deck', 'Generate file', 'Submit result'] })
    ]
  },
  {
    tool_calls: [
      step('m2', 'create_pptx_file', {
        filename: 'e2e-deck',
        design: JSON.stringify({
          title: 'E2E deck',
          slides: [{ layout: 'title', title: 'E2E deck' }]
        })
      })
    ]
  },
  { tool_calls: [step('m3', 'submit_result', { result: '{"deck":"e2e-deck","slides":1}' })] },
  { content: 'Done.' }
]

// Each ModuleRunner gets its own client instance with an isolated script counter.
function makeIsolatedScriptedClient(
  scriptArr: { content?: string; tool_calls?: FakeToolCall[] }[]
): (cfg: AIProviderConfig) => OpenAI {
  return () => {
    let i = 0
    const chunks = (entry: { content?: string; tool_calls?: FakeToolCall[] }): unknown[] => {
      const out: unknown[] = []
      if (entry.tool_calls) {
        for (const tc of entry.tool_calls) {
          out.push({
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: out.length,
                      id: tc.id,
                      type: 'function',
                      function: { name: tc.function.name, arguments: tc.function.arguments }
                    }
                  ]
                },
                finish_reason: null
              }
            ]
          })
        }
        out.push({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else {
        out.push({
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: entry.content ?? '' },
              finish_reason: null
            }
          ]
        })
        out.push({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      }
      return out
    }
    return {
      chat: {
        completions: {
          create: async () => {
            const entry = scriptArr[i++] ?? scriptArr[scriptArr.length - 1]!
            const list = chunks(entry)
            return (async function* () {
              for (const c of list) yield c
            })()
          }
        }
      }
    } as unknown as OpenAI
  }
}

const registry = new ModuleRegistry()
registry.register(createPptxModule())
const manager = new ModuleRunManager(
  service,
  {
    load: async (): Promise<AIProviderConfig> => ({
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: '',
      model: 'fake-model'
    }),
    save: async (c: AIProviderConfig) => c
  } as unknown as AIConfigStore,
  registry,
  () => {},
  makeIsolatedScriptedClient(moduleScript)
)
const toolsProvider = async (): Promise<PTTool[]> => [
  buildStartModuleTool(manager, registry),
  buildWaitModulesTool(manager)
]

let e2eTurn = 0
const e2eServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const parsed = JSON.parse(body)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    if (e2eTurn === 0) {
      // Turn 1: start two modules in parallel
      res.write(
        sse({
          id: '1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
        })
      )
      const startArgs = (title: string): string =>
        JSON.stringify({
          id: 'pptx',
          title,
          prompt: `Build a deck for ${title}.`,
          expect: 'Return a JSON object with key {deck}'
        })
      res.write(
        sse({
          id: '1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'a1',
                    type: 'function',
                    function: { name: 'start_module', arguments: startArgs('Deck A') }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        })
      )
      res.write(
        sse({
          id: '1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: 'a2',
                    type: 'function',
                    function: { name: 'start_module', arguments: startArgs('Deck B') }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        })
      )
      res.write(
        sse({
          id: '1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
        })
      )
      e2eTurn = 1
    } else if (e2eTurn === 1) {
      // Turn 2: wait_modules with the runIds returned by start_module
      const msgs = parsed.messages as { role: string; content?: string }[]
      const runIds = msgs
        .filter((m) => m.role === 'tool')
        .map((m) => {
          try {
            const r = JSON.parse(m.content ?? '{}') as { runId?: string }
            return r.runId
          } catch {
            return undefined
          }
        })
        .filter((id): id is string => !!id)
      res.write(
        sse({
          id: '2',
          object: 'chat.completion.chunk',
          created: 2,
          model: 't',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
        })
      )
      res.write(
        sse({
          id: '2',
          object: 'chat.completion.chunk',
          created: 2,
          model: 't',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'a3',
                    type: 'function',
                    function: {
                      name: 'wait_modules',
                      arguments: JSON.stringify({ runIds })
                    }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        })
      )
      res.write(
        sse({
          id: '2',
          object: 'chat.completion.chunk',
          created: 2,
          model: 't',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
        })
      )
      e2eTurn = 2
    } else {
      // Turn 3: final answer incorporating the returned module results
      const msgs = parsed.messages as { role: string; content?: string }[]
      const lastTool = [...msgs].reverse().find((m) => m.role === 'tool')
      let summary = 'no wait results found'
      try {
        const r = JSON.parse(lastTool?.content ?? '{}') as {
          ok?: boolean
          results?: { status: string; result?: string }[]
        }
        if (r.ok && Array.isArray(r.results)) {
          summary = `Done: ${r.results.length} results — ${r.results
            .map((x) => `${x.status}:${x.result ?? ''}`)
            .join(' | ')}`
        }
      } catch {
        // keep the default summary
      }
      res.write(
        sse({
          id: '3',
          object: 'chat.completion.chunk',
          created: 3,
          model: 't',
          choices: [
            { index: 0, delta: { role: 'assistant', content: summary }, finish_reason: null }
          ]
        })
      )
      res.write(
        sse({
          id: '3',
          object: 'chat.completion.chunk',
          created: 3,
          model: 't',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        })
      )
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise<void>((r) => e2eServer.listen(0, '127.0.0.1', r))
const e2ePort = (e2eServer.address() as { port: number }).port

const e2eEvents: unknown[] = []
const e2eSession = new ChatSession(
  async () => ({ baseUrl: `http://127.0.0.1:${e2ePort}/v1`, apiKey: '', model: 'test-model' }),
  { service, activeProject: 'Test' },
  (evt) => e2eEvents.push(evt),
  toolsProvider
)
await e2eSession.send('Generate two decks in parallel and report their results.')
e2eServer.close()

const e2eContent = e2eEvents
  .filter((e) => (e as { type: string }).type === 'content')
  .map((e) => (e as { content: string }).content)
  .join('')
assert.match(e2eContent, /Done: 2 results/, 'final answer incorporates both wait_modules results')
assert.match(
  e2eContent,
  /done:\{"deck":"e2e-deck","slides":1\}/,
  'final answer carries the submitted result payloads'
)

const e2eTools = e2eEvents.filter((e) => (e as { type: string }).type === 'tool') as {
  toolCall: { name: string; ok: boolean }
}[]
const startedNames = e2eTools.filter((t) => t.toolCall.name === 'start_module')
const waited = e2eTools.filter((t) => t.toolCall.name === 'wait_modules')
assert.equal(startedNames.length, 2, 'two start_module calls executed')
assert.equal(waited.length, 1, 'one wait_modules call executed')
assert.equal(waited[0]!.toolCall.ok, true, 'wait_modules succeeded')

const waitingEvents = e2eEvents.filter((e) => (e as { type: string }).type === 'waiting') as {
  runIds?: string[]
}[]
assert.ok(waitingEvents.length >= 1, "'waiting' stream event emitted for wait_modules")
assert.ok(
  (waitingEvents[0]?.runIds?.length ?? 0) >= 1,
  "'waiting' event carries the awaited runIds"
)

// ---- Raw AI trace: session.send records each exchange to <project>/.data/chat/ ----
const traceKey = 'trace-session-1'
let traceTurn = 0
const traceServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    if (traceTurn === 0) {
      // Turn 1: stream a create_note tool call, then finish with tool_calls.
      res.write(
        sse({
          id: 't',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
        })
      )
      res.write(
        sse({
          id: 't',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_trace_note',
                    type: 'function',
                    function: { name: 'create_note', arguments: '{"title":"Trace Note"}' }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        })
      )
      res.write(
        sse({
          id: 't',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
        })
      )
      traceTurn = 1
    } else {
      // Turn 2: final text.
      res.write(
        sse({
          id: 't',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [
            { index: 0, delta: { role: 'assistant', content: 'Trace reply' }, finish_reason: null }
          ]
        })
      )
      res.write(
        sse({
          id: 't',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        })
      )
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise<void>((r) => traceServer.listen(0, '127.0.0.1', r))
const tracePort = (traceServer.address() as { port: number }).port

const trace = new AiTraceRecorder({
  project: 'Test',
  key: traceKey,
  kind: 'chat',
  append: (header, lines) => service.appendChatTrace('Test', traceKey, header, lines)
})
const traceEvents: unknown[] = []
const traceSession = new ChatSession(
  async () => ({
    baseUrl: `http://127.0.0.1:${tracePort}/v1`,
    apiKey: 'secret-key',
    model: 'test-model'
  }),
  { service, activeProject: 'Test' },
  (evt) => traceEvents.push(evt)
)
await traceSession.send('hello from trace', [], null, null, trace)

const traceFile = await service.readChatTrace('Test', traceKey)
assert.ok(traceFile, 'trace file written for the chat session')
assert.equal(traceFile!.key, traceKey)
assert.equal(traceFile!.kind, 'chat')
assert.equal(traceFile!.project, 'Test')
const roles = traceFile!.entries.map((e) => e.role)
assert.deepEqual(
  roles,
  ['system', 'user', 'assistant', 'tool', 'assistant'],
  'trace is a readable log: system → user → assistant → tool → assistant'
)

const sysEntry = traceFile!.entries[0]!
assert.equal(sysEntry.role, 'system')
assert.ok(sysEntry.content?.startsWith('You are PTNotes assistant'), 'system prompt recorded')
assert.equal(typeof sysEntry.ts, 'number')

const userEntry = traceFile!.entries[1]!
assert.equal(userEntry.role, 'user')
assert.match(userEntry.content ?? '', /hello from trace/, 'user prompt recorded')

const assistantToolEntry = traceFile!.entries[2]!
assert.equal(assistantToolEntry.role, 'assistant')
assert.equal(assistantToolEntry.endpoint, 'chat.completions')
assert.equal(assistantToolEntry.model, 'test-model')
assert.equal(assistantToolEntry.baseUrl, `http://127.0.0.1:${tracePort}/v1`)
assert.equal(assistantToolEntry.finishReason, 'tool_calls')
assert.ok(
  typeof assistantToolEntry.durationMs === 'number' && assistantToolEntry.durationMs >= 0,
  'assistant entry records duration'
)
assert.equal(assistantToolEntry.toolCalls?.length, 1, 'assistant entry records the tool call')
const traceToolCall = assistantToolEntry.toolCalls![0]!
assert.equal(traceToolCall.name, 'create_note')
assert.equal(traceToolCall.args.title, 'Trace Note', 'tool call payload (args) captured')

const toolEntry = traceFile!.entries[3]!
assert.equal(toolEntry.role, 'tool')
assert.equal(toolEntry.name, 'create_note')
assert.equal(toolEntry.toolCallId, 'call_trace_note')
assert.match(toolEntry.content ?? '', /"ok":true/, 'tool response recorded')
assert.match(toolEntry.content ?? '', /trace-note/, 'tool response carries the created note')
assert.ok(
  typeof toolEntry.durationMs === 'number' && toolEntry.durationMs >= 0,
  'tool entry records duration'
)

const assistantFinalEntry = traceFile!.entries[4]!
assert.equal(assistantFinalEntry.role, 'assistant')
assert.match(assistantFinalEntry.content ?? '', /Trace reply/, 'final assistant reply recorded')
assert.equal(assistantFinalEntry.finishReason, 'stop')

assert.ok(!JSON.stringify(traceFile).includes('secret-key'), 'trace never contains the API key')
assert.ok(
  typeof traceFile!.path === 'string' && traceFile!.path.length > 0,
  'read trace exposes its path'
)
assert.ok(traceFile!.path!.endsWith('.trace.jsonl'), 'trace file uses the .trace.jsonl extension')

const traceRaw = await fs.readFile(traceFile!.path!, 'utf8')
const traceLines = traceRaw.split('\n').filter((l) => l.trim() !== '')
assert.equal(
  traceLines.length,
  traceFile!.entries.length + 1,
  'trace file is JSONL: header record + one line per entry'
)
const traceHeader = JSON.parse(traceLines[0]!) as Record<string, unknown>
assert.equal(traceHeader.type, 'header', 'first record is the chat header')
assert.equal(traceHeader.key, traceKey)
assert.equal(traceHeader.kind, 'chat')
assert.equal(traceHeader.project, 'Test')
assert.equal(typeof traceHeader.startedAt, 'number')
traceLines.slice(1).forEach((line, i) => {
  const rec = JSON.parse(line) as { seq?: number }
  assert.equal(rec.seq, i, 'entry records keep a monotonic seq')
})

// ---- system prompt is traced only once per trace file ----
const traceMeta2 = await service.chatTraceMeta('Test', traceKey)
assert.equal(traceMeta2.count, 5, 'chatTraceMeta counts the existing entries')
assert.equal(traceMeta2.hasSystem, true, 'chatTraceMeta reports the existing system entry')
const trace2 = new AiTraceRecorder({
  project: 'Test',
  key: traceKey,
  kind: 'chat',
  initialSeq: traceMeta2.count,
  hasSystem: traceMeta2.hasSystem,
  append: (header, lines) => service.appendChatTrace('Test', traceKey, header, lines)
})
await traceSession.send('second trace message', [], null, null, trace2)
traceServer.close()

const traceFile2 = await service.readChatTrace('Test', traceKey)
assert.ok(traceFile2, 'trace file readable after the second send')
assert.deepEqual(
  traceFile2!.entries.map((e) => e.role),
  ['system', 'user', 'assistant', 'tool', 'assistant', 'user', 'assistant'],
  'second send appends user → assistant without a new system entry'
)
assert.equal(
  traceFile2!.entries.filter((e) => e.role === 'system').length,
  1,
  'system prompt traced only on the first send'
)
traceFile2!.entries.forEach((e, i) => assert.equal(e.seq, i, 'seq stays monotonic across sends'))

// ---- legacy single-JSON trace migration ----
const legacyEntries = [
  { seq: 0, role: 'system' as const, ts: 1000, content: 'legacy system' },
  { seq: 1, role: 'user' as const, ts: 2000, content: 'legacy user' }
]

// read path: a legacy .trace.json is migrated to JSONL on first read
const legacyReadKey = 'legacy-read'
await fs.mkdir(join(ROOT, 'Test', '.data', 'chat'), { recursive: true })
await fs.writeFile(
  service.legacyChatTracePath('Test', legacyReadKey),
  JSON.stringify({
    project: 'Test',
    key: legacyReadKey,
    kind: 'chat',
    startedAt: 1000,
    updatedAt: 2000,
    entries: legacyEntries
  }),
  'utf8'
)
const migratedRead = await service.readChatTrace('Test', legacyReadKey)
assert.ok(migratedRead, 'legacy .trace.json is readable')
assert.equal(migratedRead!.entries.length, 2, 'legacy entries preserved')
assert.equal(migratedRead!.entries[0]!.content, 'legacy system')
assert.ok(
  migratedRead!.path!.endsWith('.trace.jsonl'),
  'legacy trace migrated to the .trace.jsonl path'
)
assert.equal(
  await fs
    .access(service.legacyChatTracePath('Test', legacyReadKey))
    .then(() => true)
    .catch(() => false),
  false,
  'legacy .trace.json removed after migration'
)
const migratedReadRaw = await fs.readFile(migratedRead!.path!, 'utf8')
assert.equal(
  migratedReadRaw.split('\n').filter((l) => l.trim() !== '').length,
  3,
  'migrated file is JSONL: header + 2 legacy entries'
)

// append path: appending to a session with only a legacy trace migrates it and keeps seq monotonic
const legacyAppendKey = 'legacy-append'
await fs.writeFile(
  service.legacyChatTracePath('Test', legacyAppendKey),
  JSON.stringify({
    project: 'Test',
    key: legacyAppendKey,
    kind: 'chat',
    startedAt: 1000,
    updatedAt: 2000,
    entries: legacyEntries
  }),
  'utf8'
)
const legacyMeta = await service.chatTraceMeta('Test', legacyAppendKey)
assert.equal(legacyMeta.count, 2, 'chatTraceMeta falls back to the legacy entry count')
assert.equal(legacyMeta.hasSystem, true, 'chatTraceMeta reports the legacy system entry')
const legacyRecorder = new AiTraceRecorder({
  project: 'Test',
  key: legacyAppendKey,
  kind: 'chat',
  initialSeq: legacyMeta.count,
  hasSystem: legacyMeta.hasSystem,
  append: (header, lines) => service.appendChatTrace('Test', legacyAppendKey, header, lines)
})
legacyRecorder.append({ role: 'assistant', ts: 3000, content: 'new after legacy' })
await legacyRecorder.flush()
const migratedAppend = await service.readChatTrace('Test', legacyAppendKey)
assert.ok(migratedAppend, 'appended trace readable')
assert.equal(migratedAppend!.entries.length, 3, 'legacy entries + appended entry')
assert.deepEqual(
  migratedAppend!.entries.map((e) => e.seq),
  [0, 1, 2],
  'seq stays monotonic across the legacy migration'
)
assert.equal(migratedAppend!.entries[2]!.content, 'new after legacy')
assert.equal(
  await fs
    .access(service.legacyChatTracePath('Test', legacyAppendKey))
    .then(() => true)
    .catch(() => false),
  false,
  'legacy .trace.json removed after append migration'
)

// ---- e2e: ask_user secret → ${SECRET:<id>} token → browser_type substitution ----

const SECRET_VALUE = 's3cr3t-e2e-value'
const TOKEN_RE = /\$\{SECRET:[0-9a-f]+\}/

const capturedBrowserArgs: Record<string, unknown>[] = []
const fakeBrowserType: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'fake browser_type',
      parameters: { type: 'object', properties: {} }
    }
  },
  execute: async (args) => {
    capturedBrowserArgs.push(args)
    return 'Typed.'
  }
}

let secretTurn = 0
const secretServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const parsed = JSON.parse(body)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    const toolCall = (id: string, name: string, argumentsJson: string): string =>
      sse({
        id,
        object: 'chat.completion.chunk',
        created: 1,
        model: 't',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id, type: 'function', function: { name, arguments: argumentsJson } }
              ]
            },
            finish_reason: null
          }
        ]
      })
    const finish = (reason: string): string =>
      sse({
        id: 's',
        object: 'chat.completion.chunk',
        created: 1,
        model: 't',
        choices: [{ index: 0, delta: {}, finish_reason: reason }]
      })

    if (secretTurn === 0) {
      res.write(
        toolCall(
          'call_ask',
          'ask_user',
          JSON.stringify({ questions: [{ id: 'pw', question: 'Password?', secret: true }] })
        )
      )
      res.write(finish('tool_calls'))
    } else if (secretTurn === 1) {
      const toolMsgs = (parsed.messages as { role: string; content?: string }[]).filter(
        (m) => m.role === 'tool'
      )
      const token = toolMsgs
        .map((m) => m.content ?? '')
        .join('\n')
        .match(TOKEN_RE)?.[0]
      assert.ok(token, 'ask_user result carries a ${SECRET:<id>} token')
      res.write(toolCall('call_type', 'browser_type', JSON.stringify({ ref: 'e1', text: token })))
      res.write(finish('tool_calls'))
    } else {
      res.write(
        sse({
          id: 's',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [
            { index: 0, delta: { role: 'assistant', content: 'Done.' }, finish_reason: null }
          ]
        })
      )
      res.write(finish('stop'))
    }
    secretTurn += 1
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise<void>((r) => secretServer.listen(0, '127.0.0.1', r))
const secretPort = (secretServer.address() as { port: number }).port

const secretTraceKey = 'secret-e2e'
const secretTrace = new AiTraceRecorder({
  project: 'Test',
  key: secretTraceKey,
  kind: 'chat',
  append: (header, lines) => service.appendChatTrace('Test', secretTraceKey, header, lines)
})
const secretEvents: unknown[] = []
const secretSession = new ChatSession(
  async () => ({
    baseUrl: `http://127.0.0.1:${secretPort}/v1`,
    apiKey: '',
    model: 'test-model'
  }),
  {
    service,
    activeProject: 'Test',
    ask: async () => ({ answers: [{ id: 'pw', answer: SECRET_VALUE }] })
  },
  (evt) => secretEvents.push(evt),
  async () => [fakeBrowserType]
)
await secretSession.send('log in for me', [], null, null, secretTrace)
secretServer.close()

assert.equal(capturedBrowserArgs.length, 1, 'browser_type executed once')
assert.equal(
  capturedBrowserArgs[0]?.text,
  SECRET_VALUE,
  'token substituted with the real secret before execution'
)

const secretToolEvents = (secretEvents as { type?: string; toolCall?: unknown }[]).filter(
  (e) => e.type === 'tool'
)
const askEvt = secretToolEvents.find((e) => (e.toolCall as { name?: string })?.name === 'ask_user')
  ?.toolCall as { name: string; args: Record<string, unknown>; ok: boolean; result: string }
const typeEvt = secretToolEvents.find(
  (e) => (e.toolCall as { name?: string })?.name === 'browser_type'
)?.toolCall as { name: string; args: Record<string, unknown>; ok: boolean; result: string }
assert.ok(askEvt && typeEvt, 'ask_user and browser_type tool events emitted')
assert.match(askEvt!.result, TOKEN_RE, 'ask_user result carries the token')
assert.ok(!askEvt!.result.includes(SECRET_VALUE), 'ask_user result has no raw secret')
assert.equal(
  typeEvt!.args.text,
  askEvt!.result.match(TOKEN_RE)?.[0],
  'streamed browser_type args keep the token'
)
assert.ok(!JSON.stringify(secretEvents).includes(SECRET_VALUE), 'no stream event leaks the secret')

const secretTraceFile = await service.readChatTrace('Test', secretTraceKey)
assert.ok(secretTraceFile, 'secret e2e trace written')
assert.ok(
  !JSON.stringify(secretTraceFile).includes(SECRET_VALUE),
  'trace never contains the secret value'
)
const tracedTypeCall = secretTraceFile!.entries
  .flatMap((e) => e.toolCalls ?? [])
  .find((tc) => tc.name === 'browser_type')
assert.ok(tracedTypeCall, 'browser_type traced')
assert.match(String(tracedTypeCall!.args.text), TOKEN_RE, 'traced browser_type args keep the token')
const secretTraceRaw = await fs.readFile(secretTraceFile!.path!, 'utf8')
assert.ok(!secretTraceRaw.includes(SECRET_VALUE), 'raw trace file never contains the secret')

// ---- unknown secret token → error, tool not executed ----

let unknownCalls = 0
const unknownBrowserType: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'fake browser_type',
      parameters: { type: 'object', properties: {} }
    }
  },
  execute: async () => {
    unknownCalls += 1
    return 'Typed.'
  }
}

let unknownTurn = 0
const unknownServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    if (unknownTurn === 0) {
      res.write(
        sse({
          id: 'u',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_u',
                    type: 'function',
                    function: {
                      name: 'browser_type',
                      arguments: JSON.stringify({ text: '${SECRET:deadbeef}' })
                    }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        })
      )
      res.write(
        sse({
          id: 'u',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
        })
      )
    } else {
      res.write(
        sse({
          id: 'u',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }]
        })
      )
      res.write(
        sse({
          id: 'u',
          object: 'chat.completion.chunk',
          created: 1,
          model: 't',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        })
      )
    }
    unknownTurn += 1
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise<void>((r) => unknownServer.listen(0, '127.0.0.1', r))
const unknownPort = (unknownServer.address() as { port: number }).port
const unknownEvents: unknown[] = []
const unknownSession = new ChatSession(
  async () => ({
    baseUrl: `http://127.0.0.1:${unknownPort}/v1`,
    apiKey: '',
    model: 'test-model'
  }),
  { service, activeProject: 'Test' },
  (evt) => unknownEvents.push(evt),
  async () => [unknownBrowserType]
)
await unknownSession.send('type it', [], null, null)
unknownServer.close()

assert.equal(unknownCalls, 0, 'unknown token → tool not executed')
const unknownEvt = (unknownEvents as { type?: string; toolCall?: unknown }[]).find(
  (e) => e.type === 'tool'
)?.toolCall as { name: string; ok: boolean; result: string }
assert.match(unknownEvt.result, /Unknown secret reference/, 'error names the unknown token')
assert.equal(unknownEvt.ok, false, 'unknown token tool call reported as failed')

console.log('CHAT SESSION TEST PASSED')
