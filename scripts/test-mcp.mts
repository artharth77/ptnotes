import Module from 'node:module'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'

const ROOT = '/tmp/ptnotes-mcp-test-root'

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

// ---- MCP server: tool registration ----

const { createBrowserMcpServer } = await import('../src/main/mcp/playwrightServer')

createBrowserMcpServer()

const { buildChatTools, buildPromptSection } = await import('../src/main/mcp/toolsets')

// browser enabled → should return tools
const tools = await buildChatTools([])
assert.ok(Array.isArray(tools), 'buildChatTools returns an array')
assert.ok(tools.length >= 10, `expected at least 10 browser tools, got ${tools.length}`)

const toolNames = tools.map((t) => t.definition.function.name)
assert.ok(toolNames.includes('browser_navigate'), 'has browser_navigate')
assert.ok(toolNames.includes('browser_snapshot'), 'has browser_snapshot')
assert.ok(toolNames.includes('browser_click'), 'has browser_click')
assert.ok(toolNames.includes('browser_type'), 'has browser_type')
assert.ok(toolNames.includes('browser_evaluate'), 'has browser_evaluate')
assert.ok(toolNames.includes('browser_screenshot'), 'has browser_screenshot')
assert.ok(toolNames.includes('browser_close'), 'has browser_close')
assert.ok(toolNames.includes('browser_set_mode'), 'has browser_set_mode')
assert.ok(toolNames.includes('browser_wait_for'), 'has browser_wait_for')
assert.ok(toolNames.includes('browser_press_key'), 'has browser_press_key')
assert.ok(toolNames.includes('browser_navigate_back'), 'has browser_navigate_back')

// verify tool definitions have correct shape
for (const tool of tools) {
  assert.equal(
    tool.definition.type,
    'function',
    `${tool.definition.function.name}: type is function`
  )
  assert.ok(tool.definition.function.name, `${tool.definition.function.name}: has name`)
  assert.ok(
    tool.definition.function.description,
    `${tool.definition.function.name}: has description`
  )
  assert.ok(tool.definition.function.parameters, `${tool.definition.function.name}: has parameters`)
  assert.equal(
    typeof tool.execute,
    'function',
    `${tool.definition.function.name}: execute is function`
  )
}

// browser disabled → should return empty
const emptyTools = await buildChatTools(['browser'])
assert.equal(emptyTools.length, 0, 'disabled browser → no tools')

// prompt section
const section = await buildPromptSection([])
assert.ok(section, 'prompt section present when browser enabled')
assert.ok(section!.includes('browser_set_mode'), 'prompt section mentions headless rule')
assert.ok(section!.includes('ask_user'), 'prompt section mentions ask_user')

const noSection = await buildPromptSection(['browser'])
assert.equal(noSection, null, 'prompt section absent when browser disabled')

// ---- Built-in MCP server (Streamable HTTP) ----

await fs.rm(ROOT, { recursive: true, force: true })

const { PTNotesService } = await import('../src/main/service/PTNotesService')
const { getMcpServerHost, randomMcpToken } = await import('../src/main/mcp/server')
const { mcpToolCount } = await import('../src/main/mcp/ptnotesServer')
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } =
  await import('@modelcontextprotocol/sdk/client/streamableHttp.js')

const ALL_CATEGORIES = { notes: true, kanban: true, planner: true }
const TOTAL_TOOLS = mcpToolCount(ALL_CATEGORIES)

const service = new PTNotesService(ROOT)
await service.ensureRoot()
await service.createProject('McpTest')

const host = getMcpServerHost()
const token = randomMcpToken()
await host.reconfigure({ enabled: true, port: 0, token, categories: ALL_CATEGORIES }, service)
let status = host.getStatus(true)
assert.equal(status.running, true, 'MCP server is running')
assert.ok(status.port > 0, 'MCP server bound a real port')
assert.equal(status.toolCount, TOTAL_TOOLS, 'tool count matches')

function textOf(result: { content: unknown }): string {
  const content = result.content
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === 'object' && (c as { type?: string }).type === 'text'
          ? String((c as { text?: unknown }).text ?? '')
          : ''
      )
      .join('\n')
  }
  return String(content ?? '')
}

const transport = new StreamableHTTPClientTransport(new URL(status.url), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } }
})
const client = new Client({ name: 'ptnotes-mcp-test', version: '0.0.0' })
await client.connect(transport)

const listed = await client.listTools()
assert.equal(listed.tools.length, TOTAL_TOOLS, 'lists every MCP tool')
const names = listed.tools.map((t) => t.name)
assert.ok(names.includes('list_projects'), 'has list_projects')
assert.ok(names.includes('create_note'), 'has create_note')
assert.ok(names.includes('add_task'), 'has add_task')
assert.ok(!names.includes('ask_user'), 'does not expose ask_user')
assert.ok(!names.includes('read_file'), 'does not expose file tools')
for (const t of listed.tools) {
  if (t.name === 'list_projects') continue
  const required = (t.inputSchema as { required?: string[] }).required ?? []
  assert.ok(required.includes('project'), `${t.name} requires project`)
}

const projects = await client.callTool({ name: 'list_projects', arguments: {} })
assert.ok(textOf(projects).includes('McpTest'), 'list_projects returns the project')

const missing = await client.callTool({ name: 'list_notes', arguments: {} })
assert.equal(missing.isError, true, 'a project tool without project is rejected')

const created = await client.callTool({
  name: 'create_note',
  arguments: { project: 'McpTest', title: 'Mcp Note', content: '# Hello' }
})
assert.ok(textOf(created).includes('"ok":true'), 'create_note succeeds')

const notes = await client.callTool({ name: 'list_notes', arguments: { project: 'McpTest' } })
assert.ok(textOf(notes).includes('mcp-note'), 'created note is listed')

await client.close()

// category toggles: disable planner → its tools disappear, notes/kanban stay
await host.reconfigure(
  {
    enabled: true,
    port: 0,
    token,
    categories: { notes: true, kanban: true, planner: false }
  },
  service
)
status = host.getStatus(true)
assert.equal(status.toolCount, TOTAL_TOOLS - 7, 'planner tools removed from the count')
const partialTransport = new StreamableHTTPClientTransport(new URL(status.url), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } }
})
const partialClient = new Client({ name: 'ptnotes-mcp-partial', version: '0.0.0' })
await partialClient.connect(partialTransport)
const partialNames = (await partialClient.listTools()).tools.map((t) => t.name)
assert.ok(!partialNames.includes('add_task'), 'planner tool hidden when disabled')
assert.ok(!partialNames.includes('list_schedules'), 'planner list hidden when disabled')
assert.ok(partialNames.includes('create_note'), 'notes tool still exposed')
assert.ok(partialNames.includes('create_kanban_card'), 'kanban tool still exposed')
assert.ok(partialNames.includes('list_projects'), 'list_projects always exposed')
await partialClient.close()

await host.stop()
assert.equal(host.getStatus(true).running, false, 'MCP server stopped')

// unauthenticated clients are rejected
await host.reconfigure({ enabled: true, port: 0, token, categories: ALL_CATEGORIES }, service)
status = host.getStatus(true)
const noAuth = new StreamableHTTPClientTransport(new URL(status.url))
const noAuthClient = new Client({ name: 'ptnotes-mcp-noauth', version: '0.0.0' })
let rejected = false
try {
  await noAuthClient.connect(noAuth)
} catch {
  rejected = true
}
assert.equal(rejected, true, 'rejects a missing bearer token')
await noAuthClient.close().catch(() => {})
await host.stop()

console.log('MCP TOOLSET TESTS PASSED')
