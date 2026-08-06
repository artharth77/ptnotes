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
      return { rootDir }
    } catch {
      return defaultSettings()
    }
  }

  async save(settings: StorageSettings): Promise<StorageSettings> {
    const next: StorageSettings = { rootDir: settings.rootDir.trim() || defaultSettings().rootDir }
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    return next
  }
}
