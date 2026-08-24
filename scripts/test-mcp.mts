import Module from 'node:module'
import assert from 'node:assert/strict'

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
const section = buildPromptSection([])
assert.ok(section, 'prompt section present when browser enabled')
assert.ok(section!.includes('browser_set_mode'), 'prompt section mentions headless rule')
assert.ok(section!.includes('ask_user'), 'prompt section mentions ask_user')

const noSection = buildPromptSection(['browser'])
assert.equal(noSection, null, 'prompt section absent when browser disabled')

console.log('MCP TOOLSET TESTS PASSED')
