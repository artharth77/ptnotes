import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { McpServerSettings, StorageSettings } from '@shared/types'
import { DEFAULT_MCP_CATEGORIES, DEFAULT_MCP_PORT } from '@shared/mcpServer'

const SETTINGS_FILE = 'ptnotes-settings.json'

export function normalizeMcpServerSettings(value: unknown): McpServerSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<McpServerSettings>) : {}
  const port =
    typeof raw.port === 'number' &&
    Number.isInteger(raw.port) &&
    raw.port >= 1024 &&
    raw.port <= 65535
      ? raw.port
      : DEFAULT_MCP_PORT
  const categories = raw.categories ?? DEFAULT_MCP_CATEGORIES
  return {
    enabled: raw.enabled === true,
    port,
    token: typeof raw.token === 'string' ? raw.token : '',
    categories: {
      notes: categories.notes !== false,
      kanban: categories.kanban !== false,
      planner: categories.planner !== false
    }
  }
}

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
      const theme: StorageSettings['theme'] =
        parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system'
          ? parsed.theme
          : 'system'
      const fontSize: StorageSettings['fontSize'] =
        parsed.fontSize === 'small' ||
        parsed.fontSize === 'default' ||
        parsed.fontSize === 'large' ||
        parsed.fontSize === 'xlarge'
          ? parsed.fontSize
          : 'default'
      const uiDensity: StorageSettings['uiDensity'] =
        parsed.uiDensity === 'compact' || parsed.uiDensity === 'cozy' ? parsed.uiDensity : 'cozy'
      const vtabStyle: StorageSettings['vtabStyle'] =
        parsed.vtabStyle === 'icons' ? 'icons' : 'labels'
      const vtabIconColor: StorageSettings['vtabIconColor'] =
        parsed.vtabIconColor === 'mono' ? 'mono' : 'color'
      const editorFontFamily: StorageSettings['editorFontFamily'] =
        parsed.editorFontFamily === 'sans' ||
        parsed.editorFontFamily === 'serif' ||
        parsed.editorFontFamily === 'mono'
          ? parsed.editorFontFamily
          : 'sans'
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
      const surfaceTranslucent: StorageSettings['surfaceTranslucent'] =
        parsed.surfaceTranslucent !== false
      return {
        rootDir,
        disabledModules,
        disabledToolsets,
        browserHeadless: !!parsed.browserHeadless,
        browserMaximize: !!parsed.browserMaximize,
        browserIgnoreHttpsErrors: !!parsed.browserIgnoreHttpsErrors,
        theme,
        fontSize,
        uiDensity,
        vtabStyle,
        vtabIconColor,
        editorFontFamily,
        surfaceTranslucent,
        sidebarVisible: parsed.sidebarVisible !== false,
        builtinSkillOverrides,
        mcpServer: normalizeMcpServerSettings(parsed.mcpServer)
      }
    } catch {
      return {
        ...defaultSettings(),
        theme: 'system',
        fontSize: 'default',
        uiDensity: 'cozy',
        editorFontFamily: 'sans',
        surfaceTranslucent: true,
        mcpServer: normalizeMcpServerSettings(undefined)
      }
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
      theme: settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system',
      fontSize:
        settings.fontSize === 'small' ||
        settings.fontSize === 'large' ||
        settings.fontSize === 'xlarge'
          ? settings.fontSize
          : 'default',
      uiDensity: settings.uiDensity === 'compact' ? 'compact' : 'cozy',
      vtabStyle: settings.vtabStyle === 'icons' ? 'icons' : 'labels',
      vtabIconColor: settings.vtabIconColor === 'mono' ? 'mono' : 'color',
      editorFontFamily:
        settings.editorFontFamily === 'serif' || settings.editorFontFamily === 'mono'
          ? settings.editorFontFamily
          : 'sans',
      surfaceTranslucent: settings.surfaceTranslucent !== false,
      sidebarVisible: settings.sidebarVisible !== false,
      builtinSkillOverrides: {},
      mcpServer: normalizeMcpServerSettings(settings.mcpServer)
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
