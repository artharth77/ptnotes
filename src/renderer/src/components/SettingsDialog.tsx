import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Modal, TextField } from './Modal'
import type { AIProviderConfig, StorageSettings } from '@shared/types'

type SettingsCategory = 'storage' | 'ai'

function AiSettingsPane({
  config,
  setConfig
}: {
  config: AIProviderConfig
  setConfig: (c: AIProviderConfig) => void
}): React.JSX.Element {
  return (
    <>
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
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={config.uploadPdfEnabled ?? true}
          onChange={(e) => setConfig({ ...config, uploadPdfEnabled: e.target.checked })}
        />
        <span>Enable PDF upload (Upload mode)</span>
      </label>
      <p className="hint">
        sends the PDF as a raw file attachment to the AI provider. Only enable if your provider
        accepts file attachments (e.g. OpenAI&apos;s Responses API). If uploads fail, use Extract
        text mode instead.
      </p>
    </>
  )
}

export function SettingsDialog(): React.JSX.Element {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const changeRoot = useAppStore((s) => s.changeRoot)
  const [category, setCategory] = useState<SettingsCategory>('storage')
  const [storage, setStorage] = useState<StorageSettings | null>(null)
  const [aiConfig, setAiConfig] = useState<AIProviderConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingRoot, setPendingRoot] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    void window.ptnotes.settings.get().then(setStorage)
    void window.ptnotes.ai.getConfig().then(setAiConfig)
  }, [])

  async function chooseNewRoot(): Promise<void> {
    const path = await window.ptnotes.settings.chooseRoot()
    if (path && path !== storage?.rootDir) {
      setPendingRoot(path)
      setError('')
    }
  }

  async function confirmMove(): Promise<void> {
    if (!pendingRoot) return
    setMoving(true)
    setError('')
    try {
      await changeRoot(pendingRoot)
      setStorage({ rootDir: pendingRoot })
      setPendingRoot(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMoving(false)
    }
  }

  async function saveAi(): Promise<void> {
    if (!aiConfig) return
    setSaving(true)
    setError('')
    try {
      await window.ptnotes.ai.setConfig(aiConfig)
      setSettingsOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!storage || !aiConfig) {
    return (
      <Modal title="Settings" className="settings-modal" onClose={() => setSettingsOpen(false)}>
        <p>Loading…</p>
      </Modal>
    )
  }

  return (
    <Modal title="Settings" className="settings-modal" onClose={() => setSettingsOpen(false)}>
      <div className="settings-layout">
        <nav className="settings-nav">
          <button
            className={category === 'storage' ? 'active' : ''}
            onClick={() => setCategory('storage')}
          >
            Storage
          </button>
          <button className={category === 'ai' ? 'active' : ''} onClick={() => setCategory('ai')}>
            AI Settings
          </button>
        </nav>
        <div className="settings-pane">
          {category === 'storage' ? (
            <>
              <p className="hint">
                Projects live in a root folder on this machine. You can change where all project
                data (notes, todos, chats) is stored. Changing it moves every existing project to
                the new location.
              </p>
              <label className="form-label">
                Project root folder
                <TextField value={storage.rootDir} readOnly onChange={() => {}} />
              </label>
              <div className="modal-actions">
                <button className="btn" onClick={() => setSettingsOpen(false)}>
                  Close
                </button>
                <button className="btn primary" onClick={() => void chooseNewRoot()}>
                  Change…
                </button>
              </div>
            </>
          ) : (
            <>
              <AiSettingsPane config={aiConfig} setConfig={setAiConfig} />
              <div className="modal-actions">
                <button className="btn" onClick={() => setSettingsOpen(false)}>
                  Cancel
                </button>
                <button className="btn primary" onClick={() => void saveAi()} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {pendingRoot && (
        <Modal title="Move project data" onClose={() => setPendingRoot(null)}>
          <p className="confirm-message">
            Move all project data from <code>{storage.rootDir}</code> to <code>{pendingRoot}</code>?
          </p>
          <p className="hint">
            Every project folder, the TODO.md files, notes, chats and the project registry will be
            moved. The current location will no longer be used.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setPendingRoot(null)} disabled={moving}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => void confirmMove()} disabled={moving}>
              {moving ? 'Moving…' : 'Move'}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}
