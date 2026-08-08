import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Modal, TextField } from './Modal'
import type { AIProviderConfig, ModuleSettings, StorageSettings } from '@shared/types'

function AiSettingsPane({
  config,
  setConfig
}: {
  config: AIProviderConfig
  setConfig: (c: AIProviderConfig) => void
}): React.JSX.Element {
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const modelDropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!modelOpen) return
    const handler = (e: PointerEvent): void => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelOpen(false)
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [modelOpen])

  const visibleModels = config.model.trim()
    ? models.filter((m) => m.toLowerCase().includes(config.model.trim().toLowerCase()))
    : models

  async function loadModels(silent = false): Promise<void> {
    if (!config.baseUrl.trim()) {
      if (!silent) setModelsError('Enter a Base URL first.')
      return
    }
    if (!silent) setLoadingModels(true)
    if (!silent) setModelsError('')
    try {
      const res = await window.ptnotes.ai.listModels(config.baseUrl.trim(), config.apiKey)
      if (Array.isArray(res)) {
        setModels(res)
        if (!silent) setModelsError('')
      } else {
        setModels([])
        if (!silent) setModelsError(res.error)
      }
    } catch (err) {
      if (!silent) setModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!silent) setLoadingModels(false)
    }
  }

  useEffect(() => {
    if (config.baseUrl.trim()) {
      const id = setTimeout(() => void loadModels(true), 0)
      return () => clearTimeout(id)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        <div className="model-combo">
          <div className="model-dropdown" ref={modelDropdownRef}>
            <div className="model-input-wrap">
              <input
                className="text-field"
                value={config.model}
                placeholder="gpt-4o-mini"
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
                onFocus={() => setModelOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setModelOpen(false)
                }}
              />
              {config.model && (
                <button
                  className="model-clear"
                  aria-label="Clear model"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setConfig({ ...config, model: '' })
                    setModelOpen(true)
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            {modelOpen && (
              <div className="model-popup">
                {visibleModels.length === 0 ? (
                  <div className="model-popup-empty">
                    {models.length === 0
                      ? 'No models loaded — click "Load models".'
                      : 'No matching models.'}
                  </div>
                ) : (
                  visibleModels.map((m) => (
                    <button
                      key={m}
                      className={`model-option ${config.model === m ? 'active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setConfig({ ...config, model: m })
                        setModelOpen(false)
                      }}
                    >
                      {m}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            className="btn"
            onClick={() => void loadModels()}
            disabled={!config.baseUrl.trim() || loadingModels}
          >
            {loadingModels ? 'Loading…' : 'Load models'}
          </button>
        </div>
        {modelsError && <p className="form-error">{modelsError}</p>}
        {!modelsError && models.length > 0 && (
          <p className="hint">
            {models.length} model{models.length === 1 ? '' : 's'} available — pick one or type any
            custom id.
          </p>
        )}
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

function ModulesPane({
  modules,
  setModules
}: {
  modules: ModuleSettings[] | null
  setModules: (m: ModuleSettings[]) => void
}): React.JSX.Element {
  const [toggling, setToggling] = useState<string | null>(null)

  async function toggle(m: ModuleSettings): Promise<void> {
    setToggling(m.id)
    try {
      const next = await window.ptnotes.modules.setEnabled(m.id, !m.enabled)
      setModules(next)
    } finally {
      setToggling(null)
    }
  }

  return (
    <>
      <p className="hint">
        Modules are background subagents the AI can start (e.g. to generate a PowerPoint). Disable a
        module to hide it from the assistant and prevent it from being started.
      </p>
      {!modules ? (
        <p className="hint">Loading…</p>
      ) : modules.length === 0 ? (
        <p className="hint">No modules registered.</p>
      ) : (
        <div className="module-settings-list">
          {modules.map((m) => (
            <label key={m.id} className={`module-settings-row${m.enabled ? '' : ' disabled'}`}>
              <input
                type="checkbox"
                checked={m.enabled}
                disabled={toggling === m.id}
                onChange={() => void toggle(m)}
              />
              <span className="module-settings-info">
                <span className="module-settings-name">{m.name}</span>
                <span className="module-settings-desc">{m.summary}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </>
  )
}

export function SettingsDialog(): React.JSX.Element {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const changeRoot = useAppStore((s) => s.changeRoot)
  const category = useAppStore((s) => s.settingsCategory)
  const setSettingsCategory = useAppStore((s) => s.setSettingsCategory)
  const [storage, setStorage] = useState<StorageSettings | null>(null)
  const [aiConfig, setAiConfig] = useState<AIProviderConfig | null>(null)
  const [modules, setModules] = useState<ModuleSettings[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingRoot, setPendingRoot] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    void window.ptnotes.settings.get().then(setStorage)
    void window.ptnotes.ai.getConfig().then(setAiConfig)
    void window.ptnotes.modules.listAvailable().then(setModules)
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
            onClick={() => setSettingsCategory('storage')}
          >
            Storage
          </button>
          <button
            className={category === 'ai' ? 'active' : ''}
            onClick={() => setSettingsCategory('ai')}
          >
            AI Settings
          </button>
          <button
            className={category === 'modules' ? 'active' : ''}
            onClick={() => setSettingsCategory('modules')}
          >
            Modules
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
                <button className="btn primary" onClick={() => void chooseNewRoot()}>
                  Change…
                </button>
              </div>
            </>
          ) : category === 'modules' ? (
            <>
              <ModulesPane modules={modules} setModules={setModules} />
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
