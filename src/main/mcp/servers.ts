import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { McpServerConfig } from '@shared/types'
import { slugify } from '@shared/slug'

const SERVERS_FILE = 'mcp-servers.json'

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && key.trim()) out[key.trim()] = raw
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function normalizeMcpServer(value: unknown): McpServerConfig | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<McpServerConfig>
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return null
  const transport = raw.transport === 'http' ? 'http' : 'stdio'
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (transport === 'stdio' && !command) return null
  if (transport === 'http' && !url) return null
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : slugify(name),
    name,
    transport,
    ...(transport === 'stdio'
      ? {
          command,
          ...(Array.isArray(raw.args)
            ? { args: raw.args.filter((a): a is string => typeof a === 'string') }
            : {}),
          ...(normalizeStringMap(raw.env) ? { env: normalizeStringMap(raw.env) } : {})
        }
      : {
          url,
          ...(normalizeStringMap(raw.headers) ? { headers: normalizeStringMap(raw.headers) } : {})
        }),
    enabled: raw.enabled !== false
  }
}

function normalizeServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return []
  const out: McpServerConfig[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const server = normalizeMcpServer(entry)
    if (!server || seen.has(server.id)) continue
    seen.add(server.id)
    out.push(server)
  }
  return out
}

/** A slug id unique across the given existing ids. */
export function uniqueServerId(name: string, existing: string[]): string {
  const base = slugify(name)
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export class McpServerStore {
  private readonly filePath: string
  private cache: McpServerConfig[] = []
  private loaded = false

  constructor() {
    this.filePath = join(app.getPath('userData'), SERVERS_FILE)
  }

  /** Read the registry from disk (cached after the first load). */
  async load(force = false): Promise<McpServerConfig[]> {
    if (this.loaded && !force) return this.cache
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      this.cache = normalizeServers(JSON.parse(raw))
    } catch {
      this.cache = []
    }
    this.loaded = true
    return this.cache
  }

  /** Synchronous view of the last loaded registry (empty until `load()`). */
  list(): McpServerConfig[] {
    return this.cache
  }

  async save(servers: McpServerConfig[]): Promise<McpServerConfig[]> {
    const next = normalizeServers(servers)
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    this.cache = next
    this.loaded = true
    return next
  }
}

let store: McpServerStore | undefined

export function getMcpServerStore(): McpServerStore {
  if (!store) store = new McpServerStore()
  return store
}
