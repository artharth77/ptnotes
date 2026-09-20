import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { McpServerCategories, McpServerSettings, McpServerStatus } from '@shared/types'
import { DEFAULT_MCP_CATEGORIES, DEFAULT_MCP_PORT, MCP_PATH } from '@shared/mcpServer'
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

/**
 * Hosts the built-in MCP server over Streamable HTTP on loopback. External clients
 * (Claude Desktop, Cursor, …) connect to `http://127.0.0.1:<port>/mcp` with a bearer token.
 */
export class McpServerHost {
  private httpServer?: Server
  private sessions = new Map<string, Session>()
  private service?: PTNotesService
  private port = DEFAULT_MCP_PORT
  private token = ''
  private categories: McpServerCategories = { ...DEFAULT_MCP_CATEGORIES }
  private error?: string

  get running(): boolean {
    return !!this.httpServer
  }

  getStatus(enabled: boolean): McpServerStatus {
    return {
      enabled,
      running: this.running,
      port: this.port,
      url: this.running ? `http://127.0.0.1:${this.port}${MCP_PATH}` : '',
      token: this.token,
      categories: this.categories,
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
      await this.stop()
      return
    }
    if (
      this.running &&
      this.service === service &&
      this.port === settings.port &&
      this.token === settings.token &&
      categoriesEqual(this.categories, settings.categories)
    ) {
      return
    }
    await this.stop()
    await this.start(settings.port, settings.token, settings.categories, service)
  }

  private async start(
    port: number,
    token: string,
    categories: McpServerCategories,
    service: PTNotesService
  ): Promise<void> {
    this.port = port
    this.token = token
    this.categories = categories
    this.service = service
    this.error = undefined
    const httpServer = createHttpServer((req, res) => {
      void this.handleRequest(req, res)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => reject(err)
        httpServer.once('error', onError)
        httpServer.listen(port, '127.0.0.1', () => {
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
    if (address && typeof address === 'object') this.port = address.port
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
    if (!this.token) return true
    const header = req.headers.authorization ?? ''
    if (!header.startsWith('Bearer ')) return false
    const provided = Buffer.from(header.slice('Bearer '.length))
    const expected = Buffer.from(this.token)
    if (provided.length !== expected.length) return false
    return timingSafeEqual(provided, expected)
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '')
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
        sendJson(res, 403, { error: 'Forbidden host' })
        return
      }
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
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
