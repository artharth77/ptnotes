import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { PTTool } from '../ai/tools'
import { createBrowserMcpServer } from './playwrightServer'
import { APP_VERSION } from '../version'

export interface Toolset {
  id: string
  name: string
  summary: string
  toolCount(): Promise<number>
  buildTools(): Promise<PTTool[]>
}

const BROWSER_TOOLSET: Toolset = {
  id: 'browser',
  name: 'Browser',
  summary: 'Control a Chromium browser for web research and interaction.',
  async toolCount(): Promise<number> {
    const server = createBrowserMcpServer()
    const client = new Client({ name: 'ptnotes-chat', version: APP_VERSION })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const { tools } = await client.listTools()
    const count = tools.length
    await client.close().catch(() => {})
    return count
  },
  async buildTools(): Promise<PTTool[]> {
    const server = createBrowserMcpServer()
    const client = new Client({ name: 'ptnotes-chat', version: APP_VERSION })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const { tools: mcpTools } = await client.listTools()
    return mcpTools.map((mcpTool) => ({
      definition: {
        type: 'function' as const,
        function: {
          name: mcpTool.name,
          description: mcpTool.description ?? '',
          parameters:
            mcpTool.inputSchema && Object.keys(mcpTool.inputSchema).length > 0
              ? (mcpTool.inputSchema as Record<string, unknown>)
              : { type: 'object' as const, properties: {} }
        }
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const result = await client.callTool({ name: mcpTool.name, arguments: args })
        if (result.isError) {
          const text = Array.isArray(result.content)
            ? result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
            : String(result.content ?? '')
          return JSON.stringify({ ok: false, error: text })
        }
        if (Array.isArray(result.content)) {
          return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
        }
        return String(result.content ?? '')
      }
    }))
  }
}

const ALL_TOOLSETS: Toolset[] = [BROWSER_TOOLSET]

export function listToolsets(): Toolset[] {
  return ALL_TOOLSETS
}

const toolCache = new Map<string, PTTool[]>()

export async function buildChatTools(disabledToolsets: string[]): Promise<PTTool[]> {
  const disabled = new Set(disabledToolsets)
  const result: PTTool[] = []
  for (const ts of listToolsets()) {
    if (disabled.has(ts.id)) continue
    let cached = toolCache.get(ts.id)
    if (!cached) {
      cached = await ts.buildTools()
      toolCache.set(ts.id, cached)
    }
    result.push(...cached)
  }
  return result
}

export function buildPromptSection(disabledToolsets: string[]): string | null {
  const disabled = new Set(disabledToolsets)
  if (disabled.has('browser')) return null
  return `
Browser toolset is available. You can navigate, click, type, and read web pages.
- browser_snapshot returns the accessibility tree — use it to see page content.
- browser_evaluate runs arbitrary JavaScript on the page.
- browser_screenshot saves a PNG screenshot.
- headless mode runs the browser invisibly — always call ask_user to warn the user before calling browser_set_mode(headless=true), and proceed only if they confirm.
`
}
