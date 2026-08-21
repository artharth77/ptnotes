import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { AIConfig, AIProfile, AIProviderConfig } from '@shared/types'
import { AI_ENDPOINTS } from '@shared/aiEndpoints'

const DEFAULT_UPLOAD_PDF = true

const DEFAULT_PROFILE: AIProfile = {
  id: 'profile-1',
  name: 'Profile 1',
  baseUrl: AI_ENDPOINTS[0].url,
  apiKey: '',
  model: ''
}

const CONFIG_FILE = 'ai-provider.json'

interface DiskConfig {
  version?: number
  profiles: AIProfile[]
  activeProfileId: string
  uploadPdfEnabled: boolean
}

export class AIConfigStore {
  private readonly filePath: string

  constructor() {
    this.filePath = join(app.getPath('userData'), CONFIG_FILE)
  }

  private async read(): Promise<DiskConfig> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<DiskConfig>
      if (Array.isArray(parsed.profiles)) {
        return {
          version: parsed.version,
          profiles: parsed.profiles,
          activeProfileId: parsed.activeProfileId ?? '',
          uploadPdfEnabled: parsed.uploadPdfEnabled ?? DEFAULT_UPLOAD_PDF
        }
      }
      // Legacy flat AIProviderConfig: wrap into a single profile and rewrite once.
      const legacy = parsed as Partial<AIProviderConfig>
      const disk: DiskConfig = {
        version: 1,
        profiles: [
          {
            id: 'profile-1',
            name: 'Profile 1',
            baseUrl: legacy.baseUrl ?? DEFAULT_PROFILE.baseUrl,
            apiKey: legacy.apiKey?.trim() ?? '',
            model: legacy.model ?? ''
          }
        ],
        activeProfileId: 'profile-1',
        uploadPdfEnabled: legacy.uploadPdfEnabled ?? DEFAULT_UPLOAD_PDF
      }
      await this.write(disk)
      return disk
    } catch {
      return this.defaultConfig()
    }
  }

  private defaultConfig(): DiskConfig {
    return {
      version: 1,
      profiles: [DEFAULT_PROFILE],
      activeProfileId: DEFAULT_PROFILE.id,
      uploadPdfEnabled: DEFAULT_UPLOAD_PDF
    }
  }

  private async write(disk: DiskConfig): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(disk, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
  }

  private activeProfile(disk: DiskConfig): AIProfile | null {
    return disk.profiles.find((p) => p.id === disk.activeProfileId) ?? disk.profiles[0] ?? null
  }

  /** The active profile merged with the global uploadPdfEnabled, as an AIProviderConfig. */
  async load(): Promise<AIProviderConfig> {
    const disk = await this.read()
    const profile = this.activeProfile(disk)
    return {
      baseUrl: profile?.baseUrl ?? DEFAULT_PROFILE.baseUrl,
      apiKey: profile?.apiKey ?? '',
      model: profile?.model ?? '',
      uploadPdfEnabled: disk.uploadPdfEnabled
    }
  }

  /** The full profile set + global toggle for the settings UI. */
  async getAll(): Promise<AIConfig> {
    const disk = await this.read()
    return {
      profiles: disk.profiles,
      activeProfileId: this.activeProfile(disk)?.id ?? '',
      uploadPdfEnabled: disk.uploadPdfEnabled
    }
  }

  async saveAll(config: AIConfig): Promise<AIConfig> {
    const disk: DiskConfig = {
      version: 1,
      profiles: config.profiles.map((p) => ({
        ...p,
        apiKey: p.apiKey?.trim() ?? ''
      })),
      activeProfileId: config.activeProfileId,
      uploadPdfEnabled: config.uploadPdfEnabled
    }
    if (!disk.profiles.some((p) => p.id === disk.activeProfileId)) {
      disk.activeProfileId = disk.profiles[0]?.id ?? ''
    }
    await this.write(disk)
    return this.getAll()
  }
}
