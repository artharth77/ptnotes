import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Modal, TextField } from './Modal'
import type { AIProviderConfig } from '@shared/types'

export function AISettingsDialog(): React.JSX.Element {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const [config, setConfig] = useState<AIProviderConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.ptnotes.ai.getConfig().then(setConfig)
  }, [])

  async function save(): Promise<void> {
    if (!config) return
    setSaving(true)
    setError('')
    try {
      await window.ptnotes.ai.setConfig(config)
      setSettingsOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!config)
    return (
      <Modal title="AI Settings" onClose={() => setSettingsOpen(false)}>
        <p>Loading…</p>
      </Modal>
    )

  return (
    <Modal title="AI Settings" onClose={() => setSettingsOpen(false)}>
      <p className="hint">
        Connect to any OpenAI-compatible API (OpenAI, OpenRouter, Groq, LM Studio, Ollama, …). The
        API key is stored locally on this machine.
      </p>
      <label className="form-label">
        Base URL
        <TextField
          value={config.baseUrl}
          onChange={(v) => setConfig({ ...config, baseUrl: v })}
          placeholder="https://api.openai.com/v1"
        />
      </label>
      <label className="form-label">
        API key
        <TextField
          type="password"
          value={config.apiKey}
          onChange={(v) => setConfig({ ...config, apiKey: v })}
          placeholder="sk-…"
        />
      </label>
      <label className="form-label">
        Model
        <TextField
          value={config.model}
          onChange={(v) => setConfig({ ...config, model: v })}
          placeholder="gpt-4o-mini"
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={() => setSettingsOpen(false)}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
