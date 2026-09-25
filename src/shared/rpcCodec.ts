const B64_KEY = '__b64'

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'))
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * JSON-safe encoding of RPC payloads: `Uint8Array` arguments/results (gallery
 * images, diagram PNGs, uploads) survive the round trip that structured clone
 * used to handle over IPC.
 */
export function encodeRpc(value: unknown): unknown {
  if (value instanceof Uint8Array) return { [B64_KEY]: bytesToBase64(value) }
  if (Array.isArray(value)) return value.map(encodeRpc)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = encodeRpc(item)
    }
    return out
  }
  return value
}

export function decodeRpc(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeRpc)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length === 1 && keys[0] === B64_KEY && typeof record[B64_KEY] === 'string') {
      return base64ToBytes(record[B64_KEY] as string)
    }
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(record)) out[key] = decodeRpc(item)
    return out
  }
  return value
}
