import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { SettingsStore } from '../settings'
import type { ToolsetSettings } from '@shared/types'
import { listToolsets } from '../mcp/toolsets'
import { getDefaultHeadless, setDefaultHeadless } from '../mcp/browser'

async function toSettings(disabled: Set<string>): Promise<ToolsetSettings[]> {
  const result: ToolsetSettings[] = []
  for (const ts of listToolsets()) {
    const count = await ts.toolCount().catch(() => 0)
    result.push({
      id: ts.id,
      name: ts.name,
      summary: ts.summary,
      enabled: !disabled.has(ts.id),
      toolCount: count,
      headless: ts.id === 'browser' ? getDefaultHeadless() : undefined
    })
  }
  return result
}

export function registerToolsetsIpc(settingsStore: SettingsStore): void {
  ipcMain.handle('toolsets:listAvailable', async (): Promise<ToolsetSettings[]> => {
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
      const settings = await settingsStore.load()
      return toSettings(new Set(settings.disabledToolsets ?? []))
    }
  )
}
