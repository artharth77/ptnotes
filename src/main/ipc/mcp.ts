import { rpc, type InvokeCtx } from '../rpc/registry'

import type { McpServerConfig, McpTestResult } from '@shared/types'
import { getMcpServerStore, normalizeMcpServer, uniqueServerId } from '../mcp/servers'
import { getMcpClientManager } from '../mcp/external'
import { invalidateToolsetCache } from '../mcp/toolsets'

const INVALID = 'A name and either a command (stdio) or a URL (HTTP) are required.'

export function registerMcpIpc(): void {
  rpc.handle('mcp:listServers', async (): Promise<McpServerConfig[]> => {
    return getMcpServerStore().load()
  })

  rpc.handle('mcp:save', async (_e: InvokeCtx, raw: unknown): Promise<McpServerConfig[]> => {
    const incoming = normalizeMcpServer(raw)
    if (!incoming) throw new Error(INVALID)
    const store = getMcpServerStore()
    const servers = await store.load()
    const existing = servers.find((s) => s.id === incoming.id)
    const id = existing
      ? incoming.id
      : uniqueServerId(
          incoming.name,
          servers.map((s) => s.id)
        )
    const saved: McpServerConfig = { ...incoming, id }
    const next = existing ? servers.map((s) => (s.id === id ? saved : s)) : [...servers, saved]
    await getMcpClientManager().close(id)
    invalidateToolsetCache(`mcp-${id}`)
    return store.save(next)
  })

  rpc.handle('mcp:delete', async (_e: InvokeCtx, id: string): Promise<McpServerConfig[]> => {
    const store = getMcpServerStore()
    const servers = await store.load()
    await getMcpClientManager().close(id)
    invalidateToolsetCache(`mcp-${id}`)
    return store.save(servers.filter((s) => s.id !== id))
  })

  rpc.handle('mcp:test', async (_e: InvokeCtx, raw: unknown): Promise<McpTestResult> => {
    const config = normalizeMcpServer(raw)
    if (!config) return { ok: false, error: INVALID }
    return getMcpClientManager().test(config)
  })
}
