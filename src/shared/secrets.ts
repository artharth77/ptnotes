/** Secret reference tokens: `${SECRET:<id>}`. The id maps to an in-memory value (main process only). */
export const SECRET_TOKEN_RE = /\$\{SECRET:([A-Za-z0-9-]+)\}/g

export function secretToken(id: string): string {
  return `\${SECRET:${id}}`
}

export interface SecretResolution {
  value: unknown
  /** Token ids that were not found in the map (tokens left as-is). */
  unknown: string[]
}

/**
 * Deep-walk `value` replacing every `${SECRET:<id>}` token in strings with its
 * mapped value. Unknown tokens are left as-is and reported in `unknown`.
 */
export function resolveSecretTokens(
  value: unknown,
  secrets: Map<string, string>
): SecretResolution {
  const unknown: string[] = []
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      return v.replace(SECRET_TOKEN_RE, (match, id: string) => {
        const secret = secrets.get(id)
        if (secret === undefined) {
          if (!unknown.includes(id)) unknown.push(id)
          return match
        }
        return secret
      })
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val)
      return out
    }
    return v
  }
  return { value: walk(value), unknown }
}
