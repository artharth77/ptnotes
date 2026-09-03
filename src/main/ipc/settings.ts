import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'
import type { SettingsStore } from '../settings'
import type { AboutInfo, AppearanceSettings, StorageSettings } from '@shared/types'

function loadDependencies(): string[] {
  try {
    const appPath = app.getAppPath()
    const pkg = JSON.parse(readFileSync(join(appPath, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>
    }
    const deps = pkg.dependencies ?? {}
    return Object.keys(deps)
      .sort()
      .map((name) => {
        try {
          const dep = JSON.parse(
            readFileSync(join(appPath, 'node_modules', name, 'package.json'), 'utf-8')
          ) as { version?: string }
          return `${name}@${dep.version ?? deps[name]}`
        } catch {
          return `${name}@${deps[name]}`
        }
      })
  } catch {
    return []
  }
}

function toAppearance(settings: StorageSettings): AppearanceSettings {
  return {
    theme: settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system',
    fontSize:
      settings.fontSize === 'small' ||
      settings.fontSize === 'large' ||
      settings.fontSize === 'xlarge'
        ? settings.fontSize
        : 'default',
    uiDensity: settings.uiDensity === 'compact' ? 'compact' : 'cozy',
    editorFontFamily:
      settings.editorFontFamily === 'serif' || settings.editorFontFamily === 'mono'
        ? settings.editorFontFamily
        : 'sans'
  }
}

export function registerSettingsIpc(
  service: PTNotesService,
  store: SettingsStore,
  onRootChanged?: (newRoot: string) => void
): void {
  ipcMain.handle('settings:get', async (): Promise<StorageSettings> => store.load())

  ipcMain.handle(
    'settings:getTheme',
    async (): Promise<'light' | 'dark' | 'system'> => (await store.load()).theme ?? 'system'
  )

  ipcMain.handle(
    'settings:setTheme',
    async (
      _e: IpcMainInvokeEvent,
      theme: 'light' | 'dark' | 'system'
    ): Promise<'light' | 'dark' | 'system'> => {
      const current = await store.load()
      const valid: 'light' | 'dark' | 'system' =
        theme === 'light' || theme === 'dark' ? theme : 'system'
      const next = await store.save({ ...current, theme: valid })
      return next.theme ?? 'system'
    }
  )

  ipcMain.handle('settings:getAppearance', async (): Promise<AppearanceSettings> =>
    toAppearance(await store.load())
  )

  ipcMain.handle(
    'settings:setAppearance',
    async (
      _e: IpcMainInvokeEvent,
      input: Partial<AppearanceSettings>
    ): Promise<AppearanceSettings> => {
      const current = await store.load()
      const patch: Partial<StorageSettings> = {}
      if (input.theme === 'light' || input.theme === 'dark' || input.theme === 'system') {
        patch.theme = input.theme
      }
      if (
        input.fontSize === 'small' ||
        input.fontSize === 'default' ||
        input.fontSize === 'large' ||
        input.fontSize === 'xlarge'
      ) {
        patch.fontSize = input.fontSize
      }
      if (input.uiDensity === 'compact' || input.uiDensity === 'cozy') {
        patch.uiDensity = input.uiDensity
      }
      if (
        input.editorFontFamily === 'sans' ||
        input.editorFontFamily === 'serif' ||
        input.editorFontFamily === 'mono'
      ) {
        patch.editorFontFamily = input.editorFontFamily
      }
      return toAppearance(await store.save({ ...current, ...patch }))
    }
  )

  ipcMain.handle('settings:getAbout', async (): Promise<AboutInfo> => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    dependencies: loadDependencies()
  }))

  ipcMain.handle(
    'settings:chooseRoot',
    async (event: IpcMainInvokeEvent): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        title: 'Choose project root folder',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory']
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
    }
  )

  ipcMain.handle(
    'settings:changeRoot',
    async (_e: IpcMainInvokeEvent, newRoot: string): Promise<StorageSettings> => {
      await service.changeRootDir(newRoot)
      onRootChanged?.(service.root)
      return store.save({ rootDir: service.root })
    }
  )
}
