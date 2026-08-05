import OpenAI from 'openai'
import type { AIProviderConfig } from '@shared/types'

export function createClient(config: AIProviderConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey || 'not-needed',
    baseURL: config.baseUrl
  })
}
