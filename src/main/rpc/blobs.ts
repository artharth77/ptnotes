import { randomBytes } from 'node:crypto'

export interface TempBlob {
  data: Buffer
  mime: string
  fileName: string
  createdAt: number
}

const TTL_MS = 10 * 60_000
const blobs = new Map<string, TempBlob>()

/**
 * Hold a generated binary in memory and hand the browser a short-lived URL for
 * it (the web UI's "save dialog": files come back as a download instead of
 * being written through a native dialog).
 */
export function putBlob(data: Buffer, mime: string, fileName: string): string {
  const now = Date.now()
  for (const [id, blob] of blobs) {
    if (now - blob.createdAt > TTL_MS) blobs.delete(id)
  }
  const id = randomBytes(16).toString('hex')
  blobs.set(id, { data, mime, fileName, createdAt: now })
  return `/api/blob/${id}`
}

export function takeBlob(id: string): TempBlob | undefined {
  const blob = blobs.get(id)
  if (!blob) return undefined
  if (Date.now() - blob.createdAt > TTL_MS) {
    blobs.delete(id)
    return undefined
  }
  blobs.delete(id)
  return blob
}

export function clearBlobs(): void {
  blobs.clear()
}
