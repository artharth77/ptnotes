import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { AIProviderConfig } from '@shared/types'

const DEFAULT_CONFIG: AIProviderConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  uploadPdfEnabled: true
}

const CONFIG_FILE = 'ai-provider.json'

export class AIConfigStore {
  private readonly filePath: string

  constructor() {
    this.filePath = join(app.getPath('userData'), CONFIG_FILE)
  }

  async load(): Promise<AIProviderConfig> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AIProviderConfig>
      return { ...DEFAULT_CONFIG, ...parsed }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  async save(config: AIProviderConfig): Promise<AIProviderConfig> {
    const next = { ...DEFAULT_CONFIG, ...config, apiKey: config.apiKey?.trim() ?? '' }
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    return next
  }
}
