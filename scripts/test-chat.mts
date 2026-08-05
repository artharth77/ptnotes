import Module from 'node:module'
import http from 'node:http'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'

const ROOT = '/tmp/ptnotes-chat-test-root'

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return { app: { getPath: () => ROOT } }
  }
  return origLoad.call(this, request, parent, isMain)
}

await fs.rm(ROOT, { recursive: true, force: true })

const { PTNotesService } = await import('../src/main/service/PTNotesService')
const { ChatSession } = await import('../src/main/ai/chatSession')

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

console.log('CHAT SESSION TEST PASSED')
