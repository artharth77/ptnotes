import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { SettingsStore } from '../settings'
import type { ToolsetSettings } from '@shared/types'
import { listToolsets } from '../mcp/toolsets'
import { getMcpServerStore } from '../mcp/servers'
import { getMcpClientManager } from '../mcp/external'
import {
  getDefaultHeadless,
  setDefaultHeadless,
  getDefaultMaximize,
  setDefaultMaximize,
  getDefaultIgnoreHttpsErrors,
  setDefaultIgnoreHttpsErrors
} from '../mcp/browser'

async function toSettings(disabled: Set<string>): Promise<ToolsetSettings[]> {
  const servers = getMcpServerStore().list()
  const manager = getMcpClientManager()
  const result: ToolsetSettings[] = []
  for (const ts of listToolsets()) {
    const enabled = !disabled.has(ts.id)
    const server = servers.find((s) => `mcp-${s.id}` === ts.id)
    let toolCount = 0
    let status: ToolsetSettings['status']
    if (server) {
      if (enabled) {
        const live = await manager.status(server)
        toolCount = live.toolCount
        status = live.error ? { connected: false, error: live.error } : { connected: true }
      }
    } else if (enabled) {
      toolCount = await ts.toolCount().catch(() => 0)
    }
    result.push({
      id: ts.id,
      name: ts.name,
      summary: ts.summary,
      enabled,
      toolCount,
      headless: ts.id === 'browser' ? getDefaultHeadless() : undefined,
      maximize: ts.id === 'browser' ? getDefaultMaximize() : undefined,
      ignoreHttpsErrors: ts.id === 'browser' ? getDefaultIgnoreHttpsErrors() : undefined,
      mcp: server,
      status
    })
  }
  return result
}

export function registerToolsetsIpc(settingsStore: SettingsStore): void {
  ipcMain.handle('toolsets:listAvailable', async (): Promise<ToolsetSettings[]> => {
    await getMcpServerStore().load()
    const settings = await settingsStore.load()
    return toSettings(new Set(settings.disabledToolsets ?? []))
  })

  ipcMain.handle(
    'toolsets:setEnabled',
    async (_e: IpcMainInvokeEvent, id: string, enabled: boolean): Promise<ToolsetSettings[]> => {
      const settings = await settingsStore.load()
      const disabled = new Set(settings.disabledToolsets ?? [])
      if (enabled) {
        disabled.delete(id)
      } else {
        disabled.add(id)
      }
      await settingsStore.save({ ...settings, disabledToolsets: [...disabled] })
      return toSettings(disabled)
    }
  )

  ipcMain.handle(
    'toolsets:setConfig',
    async (
      _e: IpcMainInvokeEvent,
      id: string,
      key: string,
      value: unknown
    ): Promise<ToolsetSettings[]> => {
      if (id === 'browser' && key === 'headless' && typeof value === 'boolean') {
        setDefaultHeadless(value)
        const settings = await settingsStore.load()
        await settingsStore.save({ ...settings, browserHeadless: value })
      }
      if (id === 'browser' && key === 'maximize' && typeof value === 'boolean') {
        setDefaultMaximize(value)
        const settings = await settingsStore.load()
        await settingsStore.save({ ...settings, browserMaximize: value })
      }
      if (id === 'browser' && key === 'ignoreHttpsErrors' && typeof value === 'boolean') {
        setDefaultIgnoreHttpsErrors(value)
        const settings = await settingsStore.load()
        await settingsStore.save({ ...settings, browserIgnoreHttpsErrors: value })
      }
      const settings = await settingsStore.load()
      return toSettings(new Set(settings.disabledToolsets ?? []))
    }
  )
}
