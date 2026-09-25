import { rpc, type InvokeCtx } from '../rpc/registry'

import type { McpServerSettings, McpServerStatus } from '@shared/types'
import type { SettingsStore } from '../settings'
import { normalizeMcpServerSettings } from '../settings'
import type { PTNotesService } from '../service/PTNotesService'
import { getMcpServerHost, randomMcpToken } from '../mcp/server'

export function registerMcpServerIpc(service: PTNotesService, settingsStore: SettingsStore): void {
  const host = getMcpServerHost()

  async function status(): Promise<McpServerStatus> {
    const settings = await settingsStore.load()
    return host.getStatus(normalizeMcpServerSettings(settings.mcpServer).enabled)
  }

  rpc.handle('mcpServer:getStatus', async (): Promise<McpServerStatus> => status())

  rpc.handle(
    'mcpServer:update',
    async (_e: InvokeCtx, patch: Partial<McpServerSettings>): Promise<McpServerStatus> => {
      const settings = await settingsStore.load()
      const next = normalizeMcpServerSettings({
        ...normalizeMcpServerSettings(settings.mcpServer),
        ...(patch && typeof patch === 'object' ? patch : {})
      })
      if (!next.token) next.token = randomMcpToken()
      await settingsStore.save({ ...settings, mcpServer: next })
      await host.reconfigure(next, service)
      return host.getStatus(next.enabled)
    }
  )

  rpc.handle('mcpServer:regenerateToken', async (): Promise<McpServerStatus> => {
    const settings = await settingsStore.load()
    const next = {
      ...normalizeMcpServerSettings(settings.mcpServer),
      token: randomMcpToken()
    }
    await settingsStore.save({ ...settings, mcpServer: next })
    await host.reconfigure(next, service)
    return host.getStatus(next.enabled)
  })
}
