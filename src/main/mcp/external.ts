import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  getDefaultEnvironment
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { McpServerConfig, McpTestResult } from '@shared/types'
import { APP_VERSION } from '../version'

const CONNECT_TIMEOUT_MS = 20_000
/** After a failed connect, fail fast for this long instead of retrying on every turn. */
const FAILURE_BACKOFF_MS = 60_000

interface Connection {
  client: Client
  tools: Tool[]
  fingerprint: string
}

function fingerprint(server: McpServerConfig): string {
  return JSON.stringify({
    transport: server.transport,
    command: server.command ?? '',
    args: server.args ?? [],
    env: server.env ?? {},
    url: server.url ?? '',
    headers: server.headers ?? {}
  })
}

function createTransport(
  server: McpServerConfig
): StdioClientTransport | StreamableHTTPClientTransport {
  if (server.transport === 'http') {
    return new StreamableHTTPClientTransport(new URL(server.url ?? ''), {
      ...(server.headers && Object.keys(server.headers).length > 0
        ? { requestInit: { headers: server.headers } }
        : {})
    })
  }
  return new StdioClientTransport({
    command: server.command ?? '',
    args: server.args ?? [],
    env: { ...getDefaultEnvironment(), ...(server.env ?? {}) }
  })
}

function contentToText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === 'object' && (c as { type?: string }).type === 'text'
          ? String((c as { text?: unknown }).text ?? '')
          : ''
      )
      .filter(Boolean)
      .join('\n')
  }
  return content == null ? '' : String(content)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

export class McpClientManager {
  private readonly conns = new Map<string, Connection>()
  private readonly pending = new Map<string, Promise<Connection>>()
  private readonly failures = new Map<string, { fingerprint: string; at: number; error: string }>()

  private async open(server: McpServerConfig): Promise<Connection> {
    await this.close(server.id)
    const client = new Client({ name: 'ptnotes-chat', version: APP_VERSION })
    const transport = createTransport(server)
    const conn: Connection = { client, tools: [], fingerprint: fingerprint(server) }
    transport.onclose = () => {
      if (this.conns.get(server.id) === conn) this.conns.delete(server.id)
    }
    try {
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS)
      const { tools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS)
      conn.tools = tools
    } catch (err) {
      await client.close().catch(() => {})
      throw err
    }
    return conn
  }

  /** Return a live connection, reusing it when the server config is unchanged. */
  async ensure(server: McpServerConfig): Promise<Connection> {
    const fp = fingerprint(server)
    const existing = this.conns.get(server.id)
    if (existing && existing.fingerprint === fp) return existing
    const failure = this.failures.get(server.id)
    if (failure && failure.fingerprint === fp && Date.now() - failure.at < FAILURE_BACKOFF_MS) {
      throw new Error(failure.error)
    }
    const inflight = this.pending.get(server.id)
    if (inflight) {
      const conn = await inflight
      if (conn.fingerprint === fp) return conn
    }
    const promise = this.open(server)
    this.pending.set(server.id, promise)
    try {
      const conn = await promise
      this.conns.set(server.id, conn)
      this.failures.delete(server.id)
      return conn
    } catch (err) {
      this.failures.set(server.id, {
        fingerprint: fp,
        at: Date.now(),
        error: err instanceof Error ? err.message : String(err)
      })
      throw err
    } finally {
      if (this.pending.get(server.id) === promise) this.pending.delete(server.id)
    }
  }

  async listTools(server: McpServerConfig): Promise<Tool[]> {
    return (await this.ensure(server)).tools
  }

  async callTool(
    server: McpServerConfig,
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const { client } = await this.ensure(server)
    const result = await client.callTool({ name, arguments: args })
    if (result.isError) {
      return JSON.stringify({ ok: false, error: contentToText(result.content) })
    }
    return contentToText(result.content)
  }

  async status(
    server: McpServerConfig
  ): Promise<{ connected: boolean; toolCount: number; error?: string }> {
    try {
      const tools = await this.listTools(server)
      return { connected: true, toolCount: tools.length }
    } catch (err) {
      return {
        connected: false,
        toolCount: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  /** Connect to an unsaved config without touching the live connection for its id. */
  async test(config: McpServerConfig): Promise<McpTestResult> {
    const probe: McpServerConfig = { ...config, id: `__test__-${Date.now()}`, enabled: true }
    try {
      const conn = await this.open(probe)
      const count = conn.tools.length
      await conn.client.close().catch(() => {})
      return { ok: true, toolCount: count }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async close(serverId: string): Promise<void> {
    this.failures.delete(serverId)
    const conn = this.conns.get(serverId)
    if (!conn) return
    this.conns.delete(serverId)
    await conn.client.close().catch(() => {})
  }

  async closeAll(): Promise<void> {
    const conns = [...this.conns.values()]
    this.conns.clear()
    await Promise.all(conns.map((c) => c.client.close().catch(() => {})))
  }
}

let manager: McpClientManager | undefined

export function getMcpClientManager(): McpClientManager {
  if (!manager) manager = new McpClientManager()
  return manager
}
