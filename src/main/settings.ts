import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { StorageSettings } from '@shared/types'

const SETTINGS_FILE = 'ptnotes-settings.json'

function defaultSettings(): StorageSettings {
  return { rootDir: join(app.getPath('documents'), 'PTNotes') }
}

export class SettingsStore {
  private readonly filePath: string

  constructor() {
    this.filePath = join(app.getPath('userData'), SETTINGS_FILE)
  }

  async load(): Promise<StorageSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StorageSettings>
      const rootDir = parsed.rootDir?.trim() || defaultSettings().rootDir
      const disabledModules = Array.isArray(parsed.disabledModules)
        ? parsed.disabledModules.filter((id): id is string => typeof id === 'string')
        : []
      const disabledToolsets = Array.isArray(parsed.disabledToolsets)
        ? parsed.disabledToolsets.filter((id): id is string => typeof id === 'string')
        : []
      const builtinSkillOverrides: Record<string, boolean> = {}
      if (
        parsed.builtinSkillOverrides &&
        typeof parsed.builtinSkillOverrides === 'object' &&
        !Array.isArray(parsed.builtinSkillOverrides)
      ) {
        for (const [key, value] of Object.entries(parsed.builtinSkillOverrides)) {
          if (typeof value === 'boolean') builtinSkillOverrides[key] = value
        }
      }
      return {
        rootDir,
        disabledModules,
        disabledToolsets,
        browserHeadless: !!parsed.browserHeadless,
        browserMaximize: !!parsed.browserMaximize,
        browserIgnoreHttpsErrors: !!parsed.browserIgnoreHttpsErrors,
        builtinSkillOverrides
      }
    } catch {
      return defaultSettings()
    }
  }

  async save(settings: StorageSettings): Promise<StorageSettings> {
    const next: StorageSettings = {
      rootDir: settings.rootDir.trim() || defaultSettings().rootDir,
      disabledModules: Array.isArray(settings.disabledModules)
        ? [
            ...new Set(
              settings.disabledModules.filter((id): id is string => typeof id === 'string')
            )
          ]
        : [],
      disabledToolsets: Array.isArray(settings.disabledToolsets)
        ? [
            ...new Set(
              settings.disabledToolsets.filter((id): id is string => typeof id === 'string')
            )
          ]
        : [],
      browserHeadless: !!settings.browserHeadless,
      browserMaximize: !!settings.browserMaximize,
      browserIgnoreHttpsErrors: !!settings.browserIgnoreHttpsErrors,
      builtinSkillOverrides: {}
    }
    if (settings.builtinSkillOverrides && typeof settings.builtinSkillOverrides === 'object') {
      for (const [key, value] of Object.entries(settings.builtinSkillOverrides)) {
        if (typeof value === 'boolean') {
          next.builtinSkillOverrides = next.builtinSkillOverrides ?? {}
          next.builtinSkillOverrides[key] = value
        }
      }
    }
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    return next
  }
}
