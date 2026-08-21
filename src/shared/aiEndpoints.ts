export interface AiEndpointPreset {
  name: string
  url: string
}

export const AI_ENDPOINTS: AiEndpointPreset[] = [
  { name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { name: 'Ollama', url: 'http://localhost:11434/v1' },
  { name: 'Ollama Cloud', url: 'https://ollama.com/v1' },
  { name: 'OpenCode Go', url: 'https://opencode.ai/zen/go/v1' },
  { name: '9arm AI Passport', url: 'https://gateway.9arm.co/v1' }
]
