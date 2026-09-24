import Module from 'node:module'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
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
const { normalizeMcpServerSettings } = await import('../src/main/settings')
const { buildMcpNetworkUrls, getMcpServerHost, randomMcpToken } =
  await import('../src/main/mcp/server')
const { mcpToolCount } = await import('../src/main/mcp/ptnotesServer')
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } =
  await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { LATEST_PROTOCOL_VERSION } = await import('@modelcontextprotocol/sdk/types.js')

const ALL_CATEGORIES = { notes: true, kanban: true, planner: true }
const TOTAL_TOOLS = mcpToolCount(ALL_CATEGORIES)

assert.equal(
  normalizeMcpServerSettings(undefined).listenOnAllInterfaces,
  false,
  'legacy settings default to loopback-only access'
)
assert.equal(
  normalizeMcpServerSettings({ listenOnAllInterfaces: true }).listenOnAllInterfaces,
  true,
  'all-interface access is preserved'
)
assert.deepEqual(
  buildMcpNetworkUrls(3737, [
    { address: '127.0.0.1', family: 'IPv4', internal: true },
    { address: '192.168.1.20', family: 'IPv4', internal: false },
    { address: '::1', family: 'IPv6', internal: true },
    { address: '10.0.0.2', family: 'IPv4', internal: false },
    { address: '192.168.1.20', family: 'IPv4', internal: false }
  ]),
  ['http://10.0.0.2:3737/mcp', 'http://192.168.1.20:3737/mcp'],
  'network URLs include unique non-internal IPv4 addresses only'
)

function initializeWithHost(urlValue: string, host: string, token?: string): Promise<number> {
  const target = new URL(urlValue)
  const headers: Record<string, string> = {
    Host: host,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json'
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'ptnotes-host-test', version: '0.0.0' }
    }
  })
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
      },
      (response) => {
        const status = response.statusCode ?? 0
        response.resume()
        response.once('end', () => resolve(status))
      }
    )
    request.once('error', reject)
    request.end(body)
  })
}

const service = new PTNotesService(ROOT)
await service.ensureRoot()
await service.createProject('McpTest')

const host = getMcpServerHost()
const token = randomMcpToken()
await host.reconfigure(
  {
    enabled: true,
    port: 0,
    token,
    categories: ALL_CATEGORIES,
    listenOnAllInterfaces: false
  },
  service
)
let status = host.getStatus(true)
assert.equal(status.running, true, 'MCP server is running')
assert.ok(status.port > 0, 'MCP server bound a real port')
assert.equal(status.listenAddress, '127.0.0.1', 'MCP server defaults to loopback')
assert.equal(status.listenOnAllInterfaces, false, 'network access defaults to off')
assert.deepEqual(status.networkUrls, [], 'loopback mode does not advertise network URLs')
assert.equal(status.toolCount, TOTAL_TOOLS, 'tool count matches')
assert.equal(
  await initializeWithHost(status.url, 'remote.example', token),
  403,
  'loopback mode rejects non-loopback Host headers'
)

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

// network access: bind all IPv4 interfaces, accept arbitrary Host headers, still require auth
await host.reconfigure(
  {
    enabled: true,
    port: 0,
    token,
    categories: ALL_CATEGORIES,
    listenOnAllInterfaces: true
  },
  service
)
status = host.getStatus(true)
assert.equal(status.running, true, 'network MCP server is running')
assert.equal(status.listenAddress, '0.0.0.0', 'network MCP server binds all IPv4 interfaces')
assert.equal(status.listenOnAllInterfaces, true, 'network access is enabled')
assert.deepEqual(
  status.networkUrls,
  [...new Set(status.networkUrls)].sort(),
  'detected network URLs are unique and stable'
)
for (const networkUrl of status.networkUrls) {
  assert.ok(networkUrl.endsWith(`:${status.port}/mcp`), 'network URL uses the active MCP port')
  assert.ok(!networkUrl.includes('0.0.0.0'), 'network URL is not the bind address')
  assert.ok(!networkUrl.includes('127.0.0.1'), 'network URL is not loopback')
}
assert.equal(
  await initializeWithHost(status.url, 'remote.example', token),
  200,
  'network mode accepts non-loopback Host headers with a valid token'
)
assert.equal(
  await initializeWithHost(status.url, 'remote.example'),
  401,
  'network mode still rejects a missing bearer token'
)

// category toggles: disable planner → its tools disappear, notes/kanban stay
await host.reconfigure(
  {
    enabled: true,
    port: 0,
    token,
    categories: { notes: true, kanban: true, planner: false },
    listenOnAllInterfaces: false
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
assert.deepEqual(host.getStatus(true).networkUrls, [], 'stopped MCP server advertises no URLs')

// unauthenticated clients are rejected
await host.reconfigure(
  {
    enabled: true,
    port: 0,
    token,
    categories: ALL_CATEGORIES,
    listenOnAllInterfaces: false
  },
  service
)
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

// enabled servers fail closed instead of exposing an unauthenticated endpoint
await host.reconfigure(
  {
    enabled: true,
    port: 0,
    token: '',
    categories: ALL_CATEGORIES,
    listenOnAllInterfaces: true
  },
  service
)
status = host.getStatus(true)
assert.equal(status.running, false, 'MCP server does not run without a bearer token')
assert.deepEqual(status.networkUrls, [], 'unstarted MCP server advertises no network URLs')
assert.match(status.error ?? '', /bearer token/i, 'missing-token error is reported')

console.log('MCP TOOLSET TESTS PASSED')
