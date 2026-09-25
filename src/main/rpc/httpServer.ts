import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { request as httpRequest } from 'node:http'
import { promises as fs, createReadStream } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { networkInterfaces } from 'node:os'
import { timingSafeEqual } from 'node:crypto'
import { rpc, createInvokeCtx } from './registry'
import { setBroadcastSink } from './bus'
import { decodeRpc, encodeRpc } from '@shared/rpcCodec'
import { runWithActionSink, type ClientAction } from '../platform'
import { takeBlob } from './blobs'

const SESSION_COOKIE = 'ptnotes_session'
const MAX_BODY_BYTES = 128 * 1024 * 1024
const HEARTBEAT_MS = 25_000
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
}

export interface WebServerOptions {
  host: string
  port: number
  /** Access code; `null` disables auth entirely (`--no-auth`). */
  token: string | null
  /** Project root allowlist for `/api/file` (settings can move it at runtime). */
  getRootDir: () => string
  /** Built renderer output directory. */
  rendererDir: string
  /** Vite dev server to proxy to, when running under `electron-vite dev`. */
  devUrl?: string
}

export interface WebServer {
  port: number
  token: string | null
  urls: string[]
  close(): Promise<void>
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    if (!key) continue
    out[key] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await fs.realpath(path)
  } catch {
    return null
  }
}

/** RFC 5987 `Content-Disposition` for a download whose name is not plain ASCII. */
function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^ -~]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function loginPageHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'">
<title>PTNotes</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background:#131418; color:#e8e8ea; }
  .card { width:min(92vw, 360px); background:#1b1d23; border:1px solid #2a2d36; border-radius:12px;
          padding:28px 24px; box-shadow:0 18px 48px rgba(0,0,0,.35); }
  h1 { margin:0 0 6px; font-size:18px; }
  p { margin:0 0 18px; font-size:13px; color:#9aa0ab; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px; font-size:14px;
          border:1px solid #343844; background:#12141a; color:inherit; }
  input:focus { outline:none; border-color:#5b8cff; }
  button { margin-top:14px; width:100%; padding:10px 12px; border:0; border-radius:8px;
           background:#5b8cff; color:#fff; font-size:14px; font-weight:600; cursor:pointer; }
  .error { color:#ff7b72; font-size:13px; margin-top:10px; min-height:18px; }
</style></head>
<body><form class="card" id="f">
  <h1>PTNotes</h1>
  <p>Enter the access code printed by <code>ptnotes web</code>.</p>
  <input id="t" type="password" autocomplete="current-password" placeholder="Access code" autofocus>
  <div class="error" id="e"></div>
  <button type="submit">Continue</button>
</form>
<script>
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault()
    const token = document.getElementById('t').value
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    })
    if (res.ok) { location.href = '/'; return }
    document.getElementById('e').textContent = 'Invalid access code.'
  })
</script>
</body></html>`
}

function proxyTo(req: IncomingMessage, res: ServerResponse, devUrl: string): void {
  const target = new URL(devUrl)
  const upstream = httpRequest(
    {
      host: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: target.host }
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    }
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end('Dev server unreachable')
  })
  req.pipe(upstream)
}

async function serveStatic(
  res: ServerResponse,
  urlPath: string,
  rendererDir: string
): Promise<void> {
  const clean = decodeURIComponent(urlPath.split('?')[0])
  const candidate = resolve(rendererDir, `.${clean}`)
  let target = isInside(candidate, resolve(rendererDir)) ? candidate : null
  if (target) {
    const st = await fs.stat(target).catch(() => null)
    if (!st || !st.isFile()) target = null
  }
  if (!target) {
    const index = resolve(rendererDir, 'index.html')
    const st = await fs.stat(index).catch(() => null)
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found (run `npm run build` first)')
      return
    }
    target = index
  }
  const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' })
  createReadStream(target).pipe(res)
}

function isLoopbackBind(host: string): boolean {
  return LOOPBACK_HOSTS.has(host)
}

function localAddresses(host: string, port: number): string[] {
  if (isLoopbackBind(host)) return ['127.0.0.1', 'localhost'].map((h) => `http://${h}:${port}`)
  if (host !== '0.0.0.0') return [`http://${host}:${port}`]
  const lan = Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}`)
  return [`http://0.0.0.0:${port}`, ...lan]
}

export async function startWebServer(opts: WebServerOptions): Promise<WebServer> {
  const { token } = opts
  const clients = new Set<ServerResponse>()
  const loopbackOnly = isLoopbackBind(opts.host)

  const push = (payload: unknown): void => {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of clients) res.write(data)
  }

  const pushEvent = (channel: string, payload: unknown): void =>
    push({ channel, payload: encodeRpc(payload) })
  setBroadcastSink(pushEvent)

  const authorized = (req: IncomingMessage): boolean => {
    if (!token) return true
    const cookies = parseCookies(req.headers.cookie)
    const session = cookies[SESSION_COOKIE]
    if (session && safeEqual(session, token)) return true
    const auth = req.headers.authorization
    if (auth && auth.startsWith('Bearer ') && safeEqual(auth.slice(7).trim(), token)) return true
    return false
  }

  const hostAllowed = (req: IncomingMessage): boolean => {
    if (!loopbackOnly) return true
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    return LOOPBACK_HOSTS.has(host)
  }

  const originAllowed = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin
    if (!origin) return true
    try {
      return new URL(origin).host === req.headers.host
    } catch {
      return false
    }
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: String(err?.message ?? err) })
      else res.end()
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname

    if (!hostAllowed(req)) {
      res.writeHead(403).end()
      return
    }

    // --- session -------------------------------------------------------
    if (path === '/api/session' && req.method === 'POST') {
      const raw = await readBody(req, 64 * 1024)
      let supplied = ''
      try {
        supplied = String((JSON.parse(raw.toString('utf8')) as { token?: unknown }).token ?? '')
      } catch {
        supplied = ''
      }
      if (!token || (supplied && safeEqual(supplied, token))) {
        if (token) {
          res.setHeader(
            'Set-Cookie',
            `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`
          )
        }
        sendJson(res, 200, { ok: true })
        return
      }
      sendJson(res, 401, { ok: false, error: 'Invalid access code' })
      return
    }

    if (path === '/' && url.searchParams.has('t') && token) {
      const supplied = url.searchParams.get('t') ?? ''
      if (safeEqual(supplied, token)) {
        res.setHeader(
          'Set-Cookie',
          `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`
        )
        res.writeHead(302, { Location: '/' })
        res.end()
        return
      }
    }

    const isApi = path.startsWith('/api/')
    if (isApi && path !== '/api/session' && !authorized(req)) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized' })
      return
    }

    // --- events (SSE) --------------------------------------------------
    if (path === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
      res.write(': connected\n\n')
      clients.add(res)
      const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
      req.on('close', () => {
        clearInterval(heartbeat)
        clients.delete(res)
      })
      return
    }

    // --- RPC -----------------------------------------------------------
    if (path === '/api/invoke' && req.method === 'POST') {
      if (!originAllowed(req)) {
        sendJson(res, 403, { ok: false, error: 'Bad origin' })
        return
      }
      const raw = await readBody(req, MAX_BODY_BYTES)
      let channel = ''
      let args: unknown[] = []
      try {
        const parsed = JSON.parse(raw.toString('utf8')) as { channel?: string; args?: unknown[] }
        channel = String(parsed.channel ?? '')
        args = Array.isArray(parsed.args) ? parsed.args : []
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON' })
        return
      }
      const actions: ClientAction[] = []
      const ctx = createInvokeCtx((channelName, payload) =>
        push({ channel: channelName, payload: encodeRpc(payload) })
      )
      try {
        const result = await runWithActionSink(
          (action) => actions.push(action),
          async () => await rpc.invoke(ctx, channel, decodeRpc(args) as unknown[])
        )
        sendJson(res, 200, { ok: true, result: encodeRpc(result), actions })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        sendJson(res, 200, { ok: false, error: message, actions })
      }
      return
    }

    // --- generated downloads (Excel / diagrams) ------------------------
    if (path.startsWith('/api/blob/') && req.method === 'GET') {
      const blob = takeBlob(path.slice('/api/blob/'.length))
      if (!blob) {
        res.writeHead(404).end('Not found')
        return
      }
      res.writeHead(200, {
        'Content-Type': blob.mime,
        'Content-Length': blob.data.length,
        'Content-Disposition': attachmentDisposition(blob.fileName),
        'Cache-Control': 'no-store'
      })
      res.end(blob.data)
      return
    }

    // --- local files (images, PDF preview, downloads) ------------------
    if (path === '/api/file' && req.method === 'GET') {
      // `URLSearchParams.get` already percent-decodes — never decode twice.
      const rawPath = url.searchParams.get('path') ?? ''
      const abs = rawPath ? resolve(rawPath) : null
      const root = await realpathOrNull(resolve(opts.getRootDir()))
      const real = abs ? await realpathOrNull(abs) : null
      if (!real || !root || !isInside(real, root)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Forbidden')
        return
      }
      const st = await fs.stat(real).catch(() => null)
      if (!st || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }
      const download = url.searchParams.get('download') === '1'
      const headers: Record<string, string> = {
        'Content-Type': MIME[extname(real).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': String(st.size),
        'Cache-Control': 'no-cache'
      }
      if (download) {
        headers['Content-Disposition'] = attachmentDisposition(real.split(/[\\/]/).pop() ?? 'file')
      }
      res.writeHead(200, headers)
      createReadStream(real).pipe(res)
      return
    }

    // --- auth gate for the app shell -----------------------------------
    if (req.method === 'GET' && !isApi) {
      if (!authorized(req)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(loginPageHtml())
        return
      }
      if (opts.devUrl) {
        proxyTo(req, res, opts.devUrl)
        return
      }
      await serveStatic(res, path, opts.rendererDir)
      return
    }

    res.writeHead(404).end()
  }

  // Vite HMR runs over its own WebSocket — proxy the upgrade too.
  server.on('upgrade', (req, socket: Socket, head) => {
    if (!opts.devUrl || !opts.host) return
    const target = new URL(opts.devUrl)
    const upstream = httpRequest({
      host: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: target.host }
    })
    upstream.on('upgrade', (upRes, upSocket, upHead) => {
      const lines = [
        `HTTP/1.1 ${upRes.statusCode ?? 101} ${upRes.statusMessage ?? 'Switching Protocols'}`,
        ...Object.entries(upRes.headers).map(
          ([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`
        ),
        '',
        ''
      ].join('\r\n')
      socket.write(lines)
      if (upHead?.length) socket.write(upHead)
      if (head?.length) upSocket.write(head)
      upSocket.pipe(socket)
      socket.pipe(upSocket)
    })
    upstream.on('error', () => socket.destroy())
    upstream.end()
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(opts.port, opts.host, () => {
      server.removeListener('error', reject)
      resolveListen()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : opts.port
  const urls = localAddresses(opts.host, port)

  return {
    port,
    token,
    urls,
    async close() {
      setBroadcastSink(() => {})
      for (const res of clients) res.end()
      clients.clear()
      await new Promise<void>((done) => server.close(() => done()))
    }
  }
}
