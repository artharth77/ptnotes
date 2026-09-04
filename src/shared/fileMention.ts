/**
 * `#` file-mention token helpers (chat composer).
 *
 * The token is the raw text between `#` and the caret. Segments are joined by
 * `/`; a segment containing spaces must be wrapped in double quotes in the
 * input (`docs/"my folder"/re`) so a bare space can still terminate the
 * mention (regular prose after the picker).
 */

/** Split a token into the directory prefix and the filter being typed (real, unquoted path parts). */
export function parseFileToken(token: string): { dir: string; filter: string } {
  const segs: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of token) {
    if (ch === '"') {
      quoted = !quoted
    } else if (ch === '/' && !quoted) {
      segs.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  return { dir: segs.join('/'), filter: cur }
}

/** True when the token has a space outside quoted segments (i.e. prose after the mention). */
export function fileTokenHasBareSpace(token: string): boolean {
  let quoted = false
  for (const ch of token) {
    if (ch === '"') quoted = !quoted
    else if (ch === ' ' && !quoted) return true
  }
  return false
}

/** Encode a real relative path as a token, quoting segments that contain spaces. */
export function encodeFileToken(path: string): string {
  return path
    .split('/')
    .map((seg) => (seg.includes(' ') ? `"${seg}"` : seg))
    .join('/')
}
