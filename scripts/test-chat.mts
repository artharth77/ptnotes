import Module from 'node:module'
import http from 'node:http'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'
import type { OpenAI } from 'openai'
import type { AIProviderConfig } from '../src/shared/types'
import type { AIConfigStore } from '../src/main/ai/config'
import type { PTTool } from '../src/main/ai/tools'

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

console.log('CHAT SESSION TEST PASSED')
