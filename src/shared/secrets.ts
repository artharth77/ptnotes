/** Secret reference tokens: `${SECRET:<id>}` and `${K_SECRET:<id>|<key>}` (kanban attributes).
 * The id maps to an in-memory value (main process only); the key is opaque context for the AI. */
export const SECRET_TOKEN_RE = /\$\{SECRET:([A-Za-z0-9-]+)\}/g

export const KANBAN_SECRET_TOKEN_RE = /\$\{K_SECRET:([A-Za-z0-9-]+)\|([^}]*)\}/g

export function secretToken(id: string): string {
  return `\${SECRET:${id}}`
}

export function kanbanSecretToken(id: string, key: string): string {
  return `\${K_SECRET:${id}|${key}}`
}

/** Extract the id from a `${SECRET:<id>}` token (the only part registerSecret returns). */
export function secretIdFromToken(token: string): string | null {
  const m = /^\$\{SECRET:([A-Za-z0-9-]+)\}$/.exec(token)
  return m ? m[1] : null
}

export interface SecretResolution {
  value: unknown
  /** Token ids that were not found in the map (tokens left as-is). */
  unknown: string[]
}

/**
 * Deep-walk `value` replacing every `${SECRET:<id>}` / `${K_SECRET:<id>|<key>}` token in
 * strings with its mapped value. Unknown tokens are left as-is and reported in `unknown`.
 */
export function resolveSecretTokens(
  value: unknown,
  secrets: Map<string, string>
): SecretResolution {
  const unknown: string[] = []
  const resolveId = (id: string, match: string): string => {
    const secret = secrets.get(id)
    if (secret === undefined) {
      if (!unknown.includes(id)) unknown.push(id)
      return match
    }
    return secret
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      return v
        .replace(KANBAN_SECRET_TOKEN_RE, (match, id: string) => resolveId(id, match))
        .replace(SECRET_TOKEN_RE, (match, id: string) => resolveId(id, match))
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
