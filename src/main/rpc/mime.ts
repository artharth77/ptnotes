import { extname } from 'node:path'

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

/** Content type for a local file, `application/octet-stream` when unknown. */
export function mimeType(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Types a browser renders itself in a top-level tab — `files:openExternal` emits
 * `kind: 'open'` only for these, everything else downloads (properly named by the
 * `Content-Disposition` on `/api/file`). `html`/`svg` are excluded: served from the
 * app origin, a tab would run project scripts with the session cookie.
 */
const OPEN_IN_TAB_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.pdf',
  '.txt',
  '.json',
  '.css',
  '.js',
  '.mjs'
])

export function isOpenInTab(absPath: string): boolean {
  return OPEN_IN_TAB_EXTS.has(extname(absPath).toLowerCase())
}
