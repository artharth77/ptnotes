import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type {
  McpServerCategories,
  McpServerListenAddress,
  McpServerSettings,
  McpServerStatus
} from '@shared/types'
import {
  DEFAULT_MCP_CATEGORIES,
  DEFAULT_MCP_PORT,
  MCP_ALL_INTERFACES_ADDRESS,
  MCP_LOOPBACK_ADDRESS,
  MCP_PATH
} from '@shared/mcpServer'
import { createPtNotesMcpServer, mcpToolCount } from './ptnotesServer'
import type { PTNotesService } from '../service/PTNotesService'

/** A random bearer token for the built-in MCP server. */
export function randomMcpToken(): string {
  return randomBytes(24).toString('hex')
}

interface Session {
  server: McpServer
  transport: StreamableHTTPServerTransport
}

function readJsonBody(req: IncomingMessage): Promise<unknown | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(text)
}

function categoriesEqual(a: McpServerCategories, b: McpServerCategories): boolean {
  return a.notes === b.notes && a.kanban === b.kanban && a.planner === b.planner
}

interface McpNetworkAddress {
  address: string
  family: string
  internal: boolean
}

function localNetworkAddresses(): McpNetworkAddress[] {
  return Object.values(networkInterfaces()).flatMap((addresses) => addresses ?? [])
}

export function buildMcpNetworkUrls(
  port: number,
  addresses: readonly McpNetworkAddress[] = localNetworkAddresses()
): string[] {
  const urls = new Set<string>()
  for (const item of addresses) {
    if (item.family === 'IPv4' && !item.internal) {
      urls.add(`http://${item.address}:${port}${MCP_PATH}`)
    }
  }
  return [...urls].sort()
}

/**
 * Hosts the built-in MCP server over Streamable HTTP. It binds to loopback by default and can be
 * explicitly configured for all IPv4 interfaces. External clients authenticate with a bearer token.
 */
export class McpServerHost {
  private httpServer?: Server
  private sessions = new Map<string, Session>()
  private service?: PTNotesService
  private port = DEFAULT_MCP_PORT
  private token = ''
  private categories: McpServerCategories = { ...DEFAULT_MCP_CATEGORIES }
  private listenOnAllInterfaces = false
  private listenAddress: McpServerListenAddress = MCP_LOOPBACK_ADDRESS
  private error?: string

  get running(): boolean {
    return !!this.httpServer
  }

  getStatus(enabled: boolean): McpServerStatus {
    return {
      enabled,
      running: this.running,
      port: this.port,
      url: this.running ? `http://${MCP_LOOPBACK_ADDRESS}:${this.port}${MCP_PATH}` : '',
      token: this.token,
      categories: this.categories,
      listenOnAllInterfaces: this.listenOnAllInterfaces,
      listenAddress: this.listenAddress,
      networkUrls: this.running && this.listenOnAllInterfaces ? buildMcpNetworkUrls(this.port) : [],
      sessionCount: this.sessions.size,
      toolCount: mcpToolCount(this.categories),
      ...(this.error ? { error: this.error } : {})
    }
  }

  /** Apply persisted settings: (re)start on enable/config change, otherwise stop. */
  async reconfigure(settings: McpServerSettings, service: PTNotesService): Promise<void> {
    if (!settings.enabled) {
      this.port = settings.port
      this.token = settings.token
      this.categories = settings.categories
      this.listenOnAllInterfaces = settings.listenOnAllInterfaces
      this.listenAddress = settings.listenOnAllInterfaces
        ? MCP_ALL_INTERFACES_ADDRESS
        : MCP_LOOPBACK_ADDRESS
      await this.stop()
      return
    }
    if (
      this.running &&
      this.service === service &&
      this.port === settings.port &&
      this.token === settings.token &&
      this.listenOnAllInterfaces === settings.listenOnAllInterfaces &&
      categoriesEqual(this.categories, settings.categories)
    ) {
      return
    }
    await this.stop()
    await this.start(
      settings.port,
      settings.token,
      settings.categories,
      settings.listenOnAllInterfaces,
      service
    )
  }

  private async start(
    port: number,
    token: string,
    categories: McpServerCategories,
    listenOnAllInterfaces: boolean,
    service: PTNotesService
  ): Promise<void> {
    this.port = port
    this.token = token
    this.categories = categories
    this.listenOnAllInterfaces = listenOnAllInterfaces
    this.listenAddress = listenOnAllInterfaces ? MCP_ALL_INTERFACES_ADDRESS : MCP_LOOPBACK_ADDRESS
    this.service = service
    this.error = undefined
    if (!token) {
      this.error = 'A bearer token is required before the MCP server can run.'
      return
    }
    const httpServer = createHttpServer((req, res) => {
      void this.handleRequest(req, res)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => reject(err)
        httpServer.once('error', onError)
        httpServer.listen(port, this.listenAddress, () => {
          httpServer.removeListener('error', onError)
          resolve()
        })
      })
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      httpServer.close()
      return
    }
    const address = httpServer.address()
    if (address && typeof address === 'object') {
      this.port = address.port
      if (
        address.address === MCP_LOOPBACK_ADDRESS ||
        address.address === MCP_ALL_INTERFACES_ADDRESS
      ) {
        this.listenAddress = address.address
      }
    }
    httpServer.on('error', (err) => {
      this.error = err instanceof Error ? err.message : String(err)
    })
    this.httpServer = httpServer
  }

  async stop(): Promise<void> {
    const httpServer = this.httpServer
    this.httpServer = undefined
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(sessions.map((s) => s.transport.close().catch(() => {})))
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  }

  private isAuthorized(req: IncomingMessage): boolean {
    if (!this.token) return false
    const header = req.headers.authorization ?? ''
    if (!header.startsWith('Bearer ')) return false
    const provided = Buffer.from(header.slice('Bearer '.length))
    const expected = Buffer.from(this.token)
    if (provided.length !== expected.length) return false
    return timingSafeEqual(provided, expected)
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.listenOnAllInterfaces) {
        const host = (req.headers.host ?? '').replace(/:\d+$/, '')
        if (host !== MCP_LOOPBACK_ADDRESS && host !== 'localhost' && host !== '[::1]') {
          sendJson(res, 403, { error: 'Forbidden host' })
          return
        }
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== MCP_PATH) {
        sendJson(res, 404, { error: 'Not found' })
        return
      }
      if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
        sendJson(res, 405, { error: 'Method not allowed' })
        return
      }
      if (!this.isAuthorized(req)) {
        res.setHeader('WWW-Authenticate', 'Bearer')
        sendJson(res, 401, { error: 'Unauthorized' })
        return
      }

      const sessionIdHeader = req.headers['mcp-session-id']
      const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader
      if (sessionId) {
        const session = this.sessions.get(sessionId)
        if (!session) {
          sendJson(res, 404, { error: 'Session not found' })
          return
        }
        await session.transport.handleRequest(req, res)
        return
      }

      if (req.method !== 'POST') {
        sendJson(res, 400, { error: 'Bad Request: session id required' })
        return
      }
      const body = await readJsonBody(req)
      if (body === null || !isInitializeRequest(body)) {
        sendJson(res, 400, { error: 'Bad Request: expected an initialize request' })
        return
      }

      const service = this.service
      if (!service) {
        sendJson(res, 503, { error: 'Server not ready' })
        return
      }

      const server = createPtNotesMcpServer(service, this.categories)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID()
      })
      transport.onclose = () => {
        const id = transport.sessionId
        if (id) this.sessions.delete(id)
      }
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
      const newSessionId = transport.sessionId
      if (newSessionId) this.sessions.set(newSessionId, { server, transport })
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
      } else {
        res.end()
      }
    }
  }
}

let host: McpServerHost | undefined

export function getMcpServerHost(): McpServerHost {
  if (!host) host = new McpServerHost()
  return host
}
