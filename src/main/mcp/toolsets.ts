import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { PTTool, ToolContext } from '../ai/tools'
import { createBrowserMcpServer } from './playwrightServer'
import { APP_VERSION } from '../version'
import type { SettingsStore } from '../settings'
import type { PTNotesService } from '../service/PTNotesService'
import type { McpServerConfig } from '@shared/types'
import { getMcpServerStore } from './servers'
import { getMcpClientManager } from './external'

export interface Toolset {
  id: string
  name: string
  summary: string
  toolCount(): Promise<number>
  buildTools(): Promise<PTTool[]>
}

let cachedService: PTNotesService | undefined
let cachedSettingsStore: SettingsStore | undefined

function createServer(): McpServer {
  return createBrowserMcpServer(cachedService, cachedSettingsStore)
}

const BROWSER_TOOLSET: Toolset = {
  id: 'browser',
  name: 'Browser',
  summary: 'Control a Chromium browser for web research and interaction.',
  async toolCount(): Promise<number> {
    const server = createServer()
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
    const server = createServer()
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
      async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
        if (mcpTool.name === 'browser_screenshot') {
          const p = args.project
          if ((typeof p !== 'string' || !p.trim()) && ctx.activeProject) {
            args = { ...args, project: ctx.activeProject }
          }
        }
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

function sanitizeToolName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** OpenAI function name for an MCP tool: `mcp__<server>__<tool>`. */
export function mcpToolName(server: McpServerConfig, toolName: string): string {
  return `mcp__${sanitizeToolName(server.id)}__${sanitizeToolName(toolName)}`
}

function mcpToolset(server: McpServerConfig): Toolset {
  const manager = getMcpClientManager()
  return {
    id: `mcp-${server.id}`,
    name: server.name,
    summary:
      server.transport === 'stdio'
        ? `External MCP server (stdio): ${server.command ?? ''}`
        : `External MCP server (HTTP): ${server.url ?? ''}`,
    async toolCount(): Promise<number> {
      return (await manager.listTools(server)).length
    },
    async buildTools(): Promise<PTTool[]> {
      const tools = await manager.listTools(server)
      return tools.map((mcpTool) => ({
        definition: {
          type: 'function' as const,
          function: {
            name: mcpToolName(server, mcpTool.name),
            description: mcpTool.description ?? '',
            parameters:
              mcpTool.inputSchema && Object.keys(mcpTool.inputSchema).length > 0
                ? (mcpTool.inputSchema as Record<string, unknown>)
                : { type: 'object' as const, properties: {} }
          }
        },
        async execute(args: Record<string, unknown>): Promise<string> {
          return manager.callTool(server, mcpTool.name, args)
        }
      }))
    }
  }
}

export function listToolsets(): Toolset[] {
  return [BROWSER_TOOLSET, ...getMcpServerStore().list().map(mcpToolset)]
}

const toolCache = new Map<string, PTTool[]>()

/** Drop cached tools for one toolset (or all) — call after an MCP server config changes. */
export function invalidateToolsetCache(id?: string): void {
  if (id) {
    toolCache.delete(id)
  } else {
    toolCache.clear()
  }
}

export async function buildChatTools(
  disabledToolsets: string[],
  service?: PTNotesService,
  settingsStore?: SettingsStore
): Promise<PTTool[]> {
  cachedService = service
  cachedSettingsStore = settingsStore
  const disabled = new Set(disabledToolsets)
  const result: PTTool[] = []
  for (const ts of listToolsets()) {
    if (disabled.has(ts.id)) continue
    let cached = toolCache.get(ts.id)
    if (!cached) {
      try {
        cached = await ts.buildTools()
      } catch {
        // A broken external server must not disable the whole chat; retry next turn.
        continue
      }
      toolCache.set(ts.id, cached)
    }
    result.push(...cached)
  }
  return result
}

const BROWSER_PROMPT = `Browser toolset is available. You can navigate, click, type, and read web pages.
- browser_snapshot returns a JSON tree with role, name, and ref for each visible element. Use refs to target elements in browser_click, browser_type, browser_select_option.
- browser_evaluate runs arbitrary JavaScript on the page.
- browser_screenshot saves a PNG screenshot to the active project's screenshots folder; pass project to target another project.
- headless mode runs the browser invisibly — always call ask_user to warn the user before calling browser_set_mode(headless=true), and proceed only if they confirm.`

export async function buildPromptSection(disabledToolsets: string[]): Promise<string | null> {
  const disabled = new Set(disabledToolsets)
  const sections: string[] = []
  if (!disabled.has('browser')) sections.push(BROWSER_PROMPT)

  const manager = getMcpClientManager()
  for (const server of getMcpServerStore().list()) {
    if (disabled.has(`mcp-${server.id}`)) continue
    let toolNames: string[] = []
    try {
      toolNames = (await manager.listTools(server)).map((t) => t.name)
    } catch {
      toolNames = []
    }
    const list = toolNames.length > 0 ? ` Available tools: ${toolNames.join(', ')}.` : ''
    sections.push(
      `External MCP server "${server.name}" is available; its tools are named mcp__${sanitizeToolName(server.id)}__<tool>.${list}`
    )
  }

  return sections.length > 0 ? sections.join('\n') : null
}
