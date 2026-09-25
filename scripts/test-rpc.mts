/**
 * Web transport tests: RPC registry, JSON codec, client actions and the HTTP
 * server (auth, invoke, SSE, file allowlist). No Electron dependency.
 * Run: tsx --tsconfig tsconfig.node.json scripts/test-rpc.mts
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeRpc, encodeRpc } from '../src/shared/rpcCodec'
import { RpcRegistry, createInvokeCtx, rpc } from '../src/main/rpc/registry'
import { broadcast } from '../src/main/rpc/bus'
import { emitClientAction, runWithActionSink, webFileUrl, webPlatform } from '../src/main/platform'
import { putBlob } from '../src/main/rpc/blobs'
import { startWebServer } from '../src/main/rpc/httpServer'

// --- codec ---------------------------------------------------------------
const payload = {
  text: 'héllo ✓',
  list: [1, 'two', null, false],
  bytes: new Uint8Array([0, 1, 127, 128, 255]),
  nested: { inner: new Uint8Array([7, 8]), none: undefined, ok: true }
}
const round = decodeRpc(JSON.parse(JSON.stringify(encodeRpc(payload)))) as typeof payload
assert.equal(round.text, payload.text)
assert.deepEqual(round.list, payload.list)
assert.ok(round.bytes instanceof Uint8Array)
assert.deepEqual([...round.bytes], [...payload.bytes])
assert.deepEqual([...round.nested.inner], [7, 8])
assert.equal(round.nested.ok, true)

// --- registry ------------------------------------------------------------
const registry = new RpcRegistry()
const sent: { channel: string; payload: unknown }[] = []
const ctx = createInvokeCtx((channel, p) => sent.push({ channel, payload: p }))

registry.handle('t:add', (_ctx, a: number, b: number) => a + b)
registry.on('t:push', (pushCtx, value: string) => pushCtx.send('t:echo', value))

assert.equal(await registry.invoke(ctx, 't:add', [2, 3]), 5)
registry.emit(ctx, 't:push', ['hi'])
assert.deepEqual(sent, [{ channel: 't:echo', payload: 'hi' }])
await assert.rejects(() => registry.invoke(ctx, 't:missing', []), /Unknown RPC channel/)
assert.throws(() => registry.handle('t:add', () => 0), /Duplicate RPC channel/)
assert.throws(() => registry.on('t:push', () => undefined), /Duplicate push channel/)

// --- client actions ------------------------------------------------------
const actions: { kind: string; url: string }[] = []
runWithActionSink(
  (action) => actions.push(action),
  () => {
    webPlatform.reveal('/tmp/notes/report.pdf')
    void webPlatform.openPath('/tmp/notes/plan.xlsx')
    emitClientAction({ kind: 'download', url: '/api/blob/abc' })
  }
)
assert.deepEqual(
  actions.map((a) => a.kind),
  ['download', 'open', 'download']
)
assert.equal(actions[0].url, webFileUrl('/tmp/notes/report.pdf', true))
assert.ok(actions[0].url.includes(encodeURIComponent('/tmp/notes/report.pdf')))
// Outside a request the sink is absent — no throw, no action.
webPlatform.reveal('/tmp/never')
assert.deepEqual(await webPlatform.showOpenDialog({}), [])
assert.equal(await webPlatform.showSaveDialog({}), null)
assert.equal(actions.length, 3)

// --- HTTP server ---------------------------------------------------------
const root = await mkdtemp(join(tmpdir(), 'ptnotes-rpc-root-'))
const rendererDir = await mkdtemp(join(tmpdir(), 'ptnotes-rpc-ui-'))
await mkdir(join(root, 'nested'), { recursive: true })
await writeFile(join(root, 'ok.txt'), 'inside')
await writeFile(join(rendererDir, 'index.html'), '<!doctype html><title>PTNotes</title>')
const outside = join(tmpdir(), `ptnotes-outside-${Date.now()}.txt`)
await writeFile(outside, 'outside')

const TOKEN = 's3cret-token'
rpc.handle('test:echo', (_ctx, ...args: unknown[]) => args)
rpc.handle('test:action', (actionCtx) => {
  actionCtx.platform.reveal(join(root, 'ok.txt'))
  return { ok: true }
})
rpc.handle('test:fail', () => {
  throw new Error('boom')
})
rpc.handle('test:bytes', (_ctx, data: Uint8Array) => data)
rpc.handle('test:blob', () =>
  putBlob(Buffer.from('spreadsheet-bytes'), 'application/octet-stream', 'My Schedule แผน.xlsx')
)

const server = await startWebServer({
  host: '127.0.0.1',
  port: 0,
  token: TOKEN,
  getRootDir: () => root,
  rendererDir
})
const base = `http://127.0.0.1:${server.port}`
const auth = { authorization: `Bearer ${TOKEN}` }

const post = async (
  channel: string,
  args: unknown[] = []
): Promise<
  Record<string, never> & {
    ok?: boolean
    result?: unknown
    error?: string
    actions?: { kind: string; url: string }[]
  }
> => {
  const res = await fetch(`${base}/api/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ channel, args: encodeRpc(args) })
  })
  return (await res.json()) as never
}

// Auth is required.
assert.equal(
  (
    await fetch(`${base}/api/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
  ).status,
  401
)
assert.equal((await fetch(`${base}/api/events`)).status, 401)

// RPC round trip (args + results survive as JSON).
assert.deepEqual((await post('test:echo', [1, 'two', null, { a: [true] }])).result, [
  1,
  'two',
  null,
  { a: [true] }
])
const echoedBytes = decodeRpc((await post('test:bytes', [new Uint8Array([1, 2, 3, 250])])).result)
assert.ok(echoedBytes instanceof Uint8Array)
assert.deepEqual([...(echoedBytes as Uint8Array)], [1, 2, 3, 250])

// Errors reach the caller, unknown channels included.
const failed = await post('test:fail')
assert.equal(failed.ok, false)
assert.match(failed.error ?? '', /boom/)
assert.match((await post('test:nope')).error ?? '', /Unknown RPC channel/)

// Reveal-style handlers come back as client actions instead of touching the OS.
const actionResult = await post('test:action')
assert.deepEqual(actionResult.actions?.[0], {
  kind: 'download',
  url: webFileUrl(join(root, 'ok.txt'), true)
})

// Session exchange: deep link sets the cookie, the app shell honours it.
const deepLink = await fetch(`${base}/?t=${encodeURIComponent(TOKEN)}`, { redirect: 'manual' })
assert.equal(deepLink.status, 302)
assert.match(deepLink.headers.get('set-cookie') ?? '', /ptnotes_session=/)
const loginPage = await fetch(base + '/')
assert.match(await loginPage.text(), /access code/i)
const appPage = await fetch(base + '/', { headers: { cookie: `ptnotes_session=${TOKEN}` } })
assert.match(await appPage.text(), /<title>PTNotes<\/title>/)
assert.equal(
  (await fetch(`${base}/?t=wrong`, { redirect: 'manual' })).headers.get('set-cookie'),
  null
)

// Static shell + file allowlist (project root only, never outside it).
assert.equal(
  (
    await fetch(`${base}/api/file?path=${encodeURIComponent(join(root, 'ok.txt'))}`, {
      headers: auth
    })
  ).status,
  200
)
assert.equal(
  await (
    await fetch(`${base}/api/file?path=${encodeURIComponent(join(root, 'ok.txt'))}`, {
      headers: auth
    })
  ).text(),
  'inside'
)
assert.equal(
  (await fetch(`${base}/api/file?path=${encodeURIComponent(outside)}`, { headers: auth })).status,
  403
)
// A path containing `%` must survive a single decode (searchParams already decodes).
await writeFile(join(root, 'progress 50% done.txt'), 'pct')
const pctFile = await fetch(
  `${base}/api/file?path=${encodeURIComponent(join(root, 'progress 50% done.txt'))}`,
  { headers: auth }
)
assert.equal(pctFile.status, 200)
assert.equal(await pctFile.text(), 'pct')
const pctDownload = await fetch(
  `${base}/api/file?path=${encodeURIComponent(join(root, 'progress 50% done.txt'))}&download=1`,
  { headers: auth }
)
assert.match(pctDownload.headers.get('content-disposition') ?? '', /progress 50% done\.txt/)
assert.equal(
  (
    await fetch(`${base}/api/file?path=${encodeURIComponent(join(root, 'nested'))}`, {
      headers: auth
    })
  ).status,
  404
)

// Generated downloads (Excel / diagrams) are served once from memory.
const blobUrl = (await post('test:blob')).result as string
assert.match(blobUrl, /^\/api\/blob\//)
const blob = await fetch(`${base}${blobUrl}`, { headers: auth })
assert.equal(blob.status, 200)
const disposition = blob.headers.get('content-disposition') ?? ''
assert.match(disposition, /filename="My Schedule _+\.xlsx"/)
assert.match(disposition, /filename\*=UTF-8''My%20Schedule/)
assert.equal((await fetch(`${base}${blobUrl}`, { headers: auth })).status, 404)

// SSE: connected clients receive broadcasts.
const controller = new AbortController()
const stream = await fetch(`${base}/api/events`, { headers: auth, signal: controller.signal })
assert.equal(stream.status, 200)
const reader = stream.body!.getReader()
const decoder = new TextDecoder()
let received = ''
const reading = (async () => {
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    received += decoder.decode(value, { stream: true })
    if (received.includes('test:event')) break
  }
})()
await new Promise((resolve) => setTimeout(resolve, 50))
broadcast('test:event', { hello: 'world' })
await Promise.race([
  reading,
  new Promise((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 3000))
])
assert.match(received, /"hello":"world"/)
controller.abort()

await server.close()
await rm(root, { recursive: true, force: true })
await rm(rendererDir, { recursive: true, force: true })
await rm(outside, { force: true })

console.log('rpc / web-transport tests passed')
