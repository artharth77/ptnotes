import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  mdiCheck,
  mdiDotsVertical,
  mdiPencil,
  mdiPlus,
  mdiSwapHorizontal,
  mdiToggleSwitch,
  mdiToggleSwitchOffOutline,
  mdiTrashCanOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { Modal, ConfirmModal, TextField } from './Modal'
import { MdiIcon } from './MdiIcon'
import { BotsSettingsPane } from './BotsSettingsPane'
import type {
  AboutInfo,
  AIConfig,
  AIProfile,
  McpServerCategories,
  McpServerConfig,
  McpServerSettings,
  McpServerStatus,
  McpTestResult,
  ModuleSettings,
  SkillContent,
  SkillList,
  SkillMeta,
  SkillScope,
  StorageSettings,
  ToolsetSettings
} from '@shared/types'
import { AI_ENDPOINTS } from '@shared/aiEndpoints'
import appIcon from '../../../../resources/icon.png'

function ProfileEditorModal({
  initial,
  onClose,
  onSave
}: {
  initial: AIProfile
  onClose: () => void
  onSave: (profile: AIProfile) => void
}): React.JSX.Element {
  const [profile, setProfile] = useState<AIProfile>(initial)
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [endpointOpen, setEndpointOpen] = useState(false)
  const modelDropdownRef = useRef<HTMLDivElement | null>(null)
  const endpointDropdownRef = useRef<HTMLDivElement | null>(null)

  function update(patch: Partial<AIProfile>): void {
    setProfile((p) => ({ ...p, ...patch }))
  }

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

  useEffect(() => {
    if (!endpointOpen) return
    const handler = (e: PointerEvent): void => {
      if (endpointDropdownRef.current && !endpointDropdownRef.current.contains(e.target as Node)) {
        setEndpointOpen(false)
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [endpointOpen])

  const visibleModels = profile.model.trim()
    ? models.filter((m) => m.toLowerCase().includes(profile.model.trim().toLowerCase()))
    : models

  async function loadModels(silent = false): Promise<void> {
    if (!profile.baseUrl.trim()) {
      if (!silent) setModelsError('Enter a Base URL first.')
      return
    }
    if (!silent) setLoadingModels(true)
    if (!silent) setModelsError('')
    try {
      const res = await window.ptnotes.ai.listModels(profile.baseUrl.trim(), profile.apiKey ?? '')
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
    if (profile.baseUrl.trim()) {
      const id = setTimeout(() => void loadModels(true), 0)
      return () => clearTimeout(id)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canSave = profile.name.trim().length > 0

  return (
    <Modal title={initial.id ? 'Edit profile' : 'New profile'} onClose={onClose}>
      <label className="form-label">
        Profile name
        <TextField
          value={profile.name}
          onChange={(v) => update({ name: v })}
          placeholder="e.g. Work, Ollama local"
          autoFocus
        />
      </label>
      <label className="form-label">
        Base URL
        <div className="endpoint-combo">
          <div className="endpoint-dropdown" ref={endpointDropdownRef}>
            <button
              className="endpoint-preset-btn"
              onClick={() => setEndpointOpen((o) => !o)}
              title="Pick a predefined endpoint"
            >
              ▾
            </button>
            {endpointOpen && (
              <div className="endpoint-popup">
                {AI_ENDPOINTS.map((e) => (
                  <button
                    key={e.url}
                    className={`endpoint-option ${profile.baseUrl === e.url ? 'active' : ''}`}
                    onMouseDown={(ev) => {
                      ev.preventDefault()
                      update({ baseUrl: e.url })
                      setEndpointOpen(false)
                    }}
                  >
                    <span className="endpoint-name">{e.name}</span>
                    <span className="endpoint-url">{e.url}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <TextField
            value={profile.baseUrl}
            onChange={(v) => update({ baseUrl: v })}
            placeholder="https://api.openai.com/v1"
          />
        </div>
      </label>
      <label className="form-label">
        API key
        <TextField
          type="password"
          value={profile.apiKey ?? ''}
          onChange={(v) => update({ apiKey: v })}
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
                value={profile.model ?? ''}
                placeholder="gpt-4o-mini"
                onChange={(e) => update({ model: e.target.value })}
                onFocus={() => setModelOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setModelOpen(false)
                }}
              />
              {profile.model && (
                <button
                  className="model-clear"
                  aria-label="Clear model"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    update({ model: '' })
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
                      className={`model-option ${profile.model === m ? 'active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        update({ model: m })
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
            disabled={!profile.baseUrl.trim() || loadingModels}
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
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => onSave(profile)} disabled={!canSave}>
          Save
        </button>
      </div>
    </Modal>
  )
}

function AiSettingsPane({
  config,
  onChange,
  onCommit
}: {
  config: AIConfig
  onChange: (c: AIConfig) => void
  onCommit: (c: AIConfig) => Promise<void>
}): React.JSX.Element {
  const [editing, setEditing] = useState<AIProfile | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const profile = config.profiles.find((p) => p.id === config.activeProfileId) ?? config.profiles[0]
  const selected = config.profiles.find((p) => p.id === selectedId) ?? profile

  function addProfile(): void {
    let n = config.profiles.length + 1
    let id = `profile-${n}`
    while (config.profiles.some((p) => p.id === id)) {
      n += 1
      id = `profile-${n}`
    }
    setEditing({ id: '', name: `Profile ${n}`, baseUrl: '', apiKey: '', model: '' })
  }

  function editProfile(): void {
    if (selected) setEditing({ ...selected })
  }

  function requestDeleteProfile(): void {
    if (!selected || config.profiles.length <= 1) return
    setDeleting(true)
  }

  async function deleteProfile(): Promise<void> {
    if (config.profiles.length <= 1) return
    const targetId = selected?.id ?? ''
    const rest = config.profiles.filter((p) => p.id !== targetId)
    const next: AIConfig = {
      ...config,
      profiles: rest,
      activeProfileId: config.activeProfileId === targetId ? rest[0].id : config.activeProfileId
    }
    setSelectedId(null)
    setDeleting(false)
    await onCommit(next)
  }

  function setActive(): void {
    if (!selectedId || selectedId === config.activeProfileId) return
    const next = { ...config, activeProfileId: selectedId }
    onChange(next)
    void onCommit(next)
  }

  async function saveProfile(saved: AIProfile): Promise<void> {
    const exists = config.profiles.some((p) => p.id === saved.id)
    const resolved = exists
      ? saved
      : (() => {
          let n = config.profiles.length + 1
          let id = `profile-${n}`
          while (config.profiles.some((p) => p.id === id)) {
            n += 1
            id = `profile-${n}`
          }
          return { ...saved, id }
        })()
    const next: AIConfig = exists
      ? {
          ...config,
          profiles: config.profiles.map((p) => (p.id === resolved.id ? resolved : p))
        }
      : { ...config, profiles: [...config.profiles, resolved] }
    setEditing(null)
    await onCommit(next)
  }

  return (
    <>
      <p className="hint">
        Connect to any OpenAI-compatible API (OpenAI, OpenRouter, Groq, LM Studio, Ollama, …). API
        keys are stored locally on this machine. Profiles let you switch between different
        providers; the active profile is used by the chat.
      </p>
      <div className="profile-block">
        <div className="profile-section-title">Profiles</div>
        <div className="profile-grid" role="listbox" aria-label="Profiles">
          <div className="profile-grid-header">
            <span className="profile-grid-cell" />
            <span className="profile-grid-cell">Name</span>
            <span className="profile-grid-cell">Model</span>
          </div>
          {config.profiles.map((p) => {
            const isActive = p.id === config.activeProfileId
            const isSelected = p.id === selectedId
            return (
              <div
                key={p.id}
                className={`profile-grid-row${isActive ? ' active' : ''}${
                  isSelected ? ' selected' : ''
                }`}
                role="option"
                aria-selected={isSelected}
                onClick={() => setSelectedId(p.id)}
              >
                <span className="profile-grid-cell profile-grid-check">
                  {isActive && <MdiIcon path={mdiCheck} size={16} />}
                </span>
                <span className="profile-grid-cell" title={p.name || p.id}>
                  {p.name || p.id}
                </span>
                <span className="profile-grid-cell" title={p.model}>
                  {p.model || '—'}
                </span>
              </div>
            )
          })}
        </div>
        <div className="profile-actions">
          <button className="btn" onClick={addProfile}>
            <MdiIcon path={mdiPlus} size={16} /> New
          </button>
          <button className="btn" onClick={editProfile} disabled={!selected}>
            Edit
          </button>
          <button
            className="btn"
            onClick={requestDeleteProfile}
            disabled={!selected || config.profiles.length <= 1}
          >
            Delete
          </button>
          <button
            className="btn primary"
            onClick={setActive}
            disabled={!selectedId || selectedId === config.activeProfileId}
          >
            Set active
          </button>
        </div>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={config.uploadPdfEnabled}
          onChange={(e) => {
            const next = { ...config, uploadPdfEnabled: e.target.checked }
            onChange(next)
            void onCommit(next)
          }}
        />
        <span>Enable PDF upload (Upload mode)</span>
      </label>
      <p className="hint">
        sends the PDF as a raw file attachment to the AI provider. Only enable if your provider
        accepts file attachments (e.g. OpenAI&apos;s Responses API). If uploads fail, use Extract
        text mode instead. This setting applies to all profiles.
      </p>
      {editing &&
        createPortal(
          <ProfileEditorModal
            initial={editing}
            onClose={() => setEditing(null)}
            onSave={(saved) => void saveProfile(saved)}
          />,
          document.body
        )}
      {deleting &&
        selected &&
        createPortal(
          <ConfirmModal
            title="Delete profile"
            onClose={() => setDeleting(false)}
            onConfirm={() => void deleteProfile()}
            message={
              <p className="confirm-message">
                Delete profile &quot;{selected.name}&quot;? This cannot be undone.
              </p>
            }
          />,
          document.body
        )}
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
            <div
              key={m.id}
              className={`module-settings-row${m.enabled ? '' : ' disabled'}`}
              aria-pressed={m.enabled}
              onClick={() => void toggle(m)}
            >
              <span className="module-settings-info">
                <span className="module-settings-name">{m.name}</span>
                <span className="module-settings-desc">{m.summary}</span>
                {m.link && (
                  <a
                    className="module-settings-link"
                    href={m.link.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {m.link.label}
                  </a>
                )}
              </span>
              <button
                className={`module-settings-toggle${m.enabled ? ' on' : ''}`}
                title={m.enabled ? 'Disable this module' : 'Enable this module'}
                disabled={toggling === m.id}
              >
                <MdiIcon path={m.enabled ? mdiToggleSwitch : mdiToggleSwitchOffOutline} size={32} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function parseMcpLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseMcpPairs(value: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of parseMcpLines(value)) {
    const idx = line.indexOf('=')
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

function formatMcpPairs(map?: Record<string, string>): string {
  return map
    ? Object.entries(map)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    : ''
}

function emptyMcpDraft(): McpServerConfig {
  return {
    id: '',
    name: '',
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    enabled: true
  }
}

function ToolsetsPane({
  toolsets,
  setToolsets
}: {
  toolsets: ToolsetSettings[] | null
  setToolsets: (m: ToolsetSettings[]) => void
}): React.JSX.Element {
  const [toggling, setToggling] = useState<string | null>(null)
  const [draft, setDraft] = useState<McpServerConfig | null>(null)
  const [argsText, setArgsText] = useState('')
  const [envText, setEnvText] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<McpTestResult | null>(null)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<McpServerConfig | null>(null)

  async function toggle(t: ToolsetSettings): Promise<void> {
    setToggling(t.id)
    try {
      const next = await window.ptnotes.toolsets.setEnabled(t.id, !t.enabled)
      setToolsets(next)
    } finally {
      setToggling(null)
    }
  }

  async function toggleConfig(id: string, key: string, value: boolean): Promise<void> {
    const next = await window.ptnotes.toolsets.setConfig(id, key, value)
    setToolsets(next)
  }

  async function reload(): Promise<void> {
    setToolsets(await window.ptnotes.toolsets.listAvailable())
  }

  function startAdd(): void {
    setDraft(emptyMcpDraft())
    setArgsText('')
    setEnvText('')
    setHeadersText('')
    setTestResult(null)
    setError('')
  }

  function startEdit(server: McpServerConfig): void {
    setDraft({ ...server })
    setArgsText((server.args ?? []).join('\n'))
    setEnvText(formatMcpPairs(server.env))
    setHeadersText(formatMcpPairs(server.headers))
    setTestResult(null)
    setError('')
  }

  async function saveDraft(): Promise<void> {
    if (!draft) return
    const config: McpServerConfig = {
      ...draft,
      args: draft.transport === 'stdio' ? parseMcpLines(argsText) : undefined,
      env: draft.transport === 'stdio' ? parseMcpPairs(envText) : undefined,
      headers: draft.transport === 'http' ? parseMcpPairs(headersText) : undefined
    }
    setSaving(true)
    setError('')
    try {
      await window.ptnotes.mcp.save(config)
      setDraft(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function testDraft(): Promise<void> {
    if (!draft) return
    setTesting(true)
    setTestResult(null)
    setError('')
    try {
      const config: McpServerConfig = {
        ...draft,
        args: draft.transport === 'stdio' ? parseMcpLines(argsText) : undefined,
        env: draft.transport === 'stdio' ? parseMcpPairs(envText) : undefined,
        headers: draft.transport === 'http' ? parseMcpPairs(headersText) : undefined
      }
      setTestResult(await window.ptnotes.mcp.test(config))
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  async function deleteServer(): Promise<void> {
    if (!deleting) return
    try {
      await window.ptnotes.mcp.delete(deleting.id)
      setDeleting(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeleting(null)
    }
  }

  return (
    <>
      <p className="hint">
        Toolsets add extra tools the AI can use during chat. Each enabled toolset adds tools to
        every chat turn — this uses more tokens and increases the chance the AI selects the wrong
        tool. Enabled toolsets are also available to module subagents.
      </p>
      <p className="hint">
        If you add many toolsets, the AI may fail to select the correct tool &mdash; this is an LLM
        limitation. Disable any toolsets you don&apos;t actively need.
      </p>
      {!toolsets ? (
        <p className="hint">Loading…</p>
      ) : toolsets.length === 0 ? (
        <p className="hint">No toolsets available.</p>
      ) : (
        <div className="module-settings-list">
          {toolsets.map((t) => (
            <div
              key={t.id}
              className={`module-settings-row${t.enabled ? '' : ' disabled'}`}
              aria-pressed={t.enabled}
              onClick={() => void toggle(t)}
            >
              <span className="module-settings-info">
                <span className="module-settings-name">
                  {t.name}
                  {t.toolCount > 0 && (
                    <span className="module-settings-count">
                      {' '}
                      ({t.toolCount} tool{t.toolCount !== 1 ? 's' : ''})
                    </span>
                  )}
                  {t.mcp && (
                    <span
                      className={`mcp-status-dot ${t.status?.connected ? 'connected' : 'error'}`}
                      title={
                        t.status?.connected ? 'Connected' : (t.status?.error ?? 'Not connected')
                      }
                    />
                  )}
                </span>
                <span className="module-settings-desc">{t.summary}</span>
                {t.status && !t.status.connected && t.status.error && (
                  <span className="mcp-status-error">{t.status.error}</span>
                )}
                {t.id === 'browser' && t.headless !== undefined && (
                  <label className="toolset-sub-config" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={t.headless}
                      onChange={(e) => void toggleConfig(t.id, 'headless', e.target.checked)}
                    />
                    Run in headless mode (browser is invisible)
                  </label>
                )}
                {t.id === 'browser' && t.maximize !== undefined && (
                  <label className="toolset-sub-config" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={t.maximize}
                      onChange={(e) => void toggleConfig(t.id, 'maximize', e.target.checked)}
                    />
                    Maximize browser window
                  </label>
                )}
                {t.id === 'browser' && t.ignoreHttpsErrors !== undefined && (
                  <label className="toolset-sub-config" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={t.ignoreHttpsErrors}
                      onChange={(e) =>
                        void toggleConfig(t.id, 'ignoreHttpsErrors', e.target.checked)
                      }
                    />
                    Ignore HTTPS certificate errors
                  </label>
                )}
                {t.id === 'browser' && t.ignoreHttpsErrors && (
                  <p
                    className="hint"
                    style={{
                      marginLeft: 22,
                      marginTop: 2,
                      fontStyle: 'italic',
                      color: 'var(--danger)'
                    }}
                  >
                    Disables certificate verification. Only use with trusted sites.
                  </p>
                )}
                {t.mcp && (
                  <span className="mcp-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn small"
                      type="button"
                      onClick={() => startEdit(t.mcp as McpServerConfig)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn small danger"
                      type="button"
                      onClick={() => setDeleting(t.mcp as McpServerConfig)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </span>
              <button
                className={`module-settings-toggle${t.enabled ? ' on' : ''}`}
                title={t.enabled ? 'Disable this toolset' : 'Enable this toolset'}
                disabled={toggling === t.id}
              >
                <MdiIcon path={t.enabled ? mdiToggleSwitch : mdiToggleSwitchOffOutline} size={32} />
              </button>
            </div>
          ))}
        </div>
      )}

      {draft ? (
        <div className="mcp-form">
          <div className="mcp-form-title">
            {draft.id ? `Edit "${draft.name}"` : 'Add external MCP server'}
          </div>
          <label className="form-label">
            Name
            <TextField
              value={draft.name}
              autoFocus
              placeholder="My MCP server"
              onChange={(v) => setDraft({ ...draft, name: v })}
            />
          </label>
          <div className="mcp-transport-toggle">
            <button
              type="button"
              className={`btn small${draft.transport === 'stdio' ? ' primary' : ''}`}
              onClick={() => setDraft({ ...draft, transport: 'stdio' })}
            >
              stdio
            </button>
            <button
              type="button"
              className={`btn small${draft.transport === 'http' ? ' primary' : ''}`}
              onClick={() => setDraft({ ...draft, transport: 'http' })}
            >
              HTTP
            </button>
          </div>
          {draft.transport === 'stdio' ? (
            <>
              <label className="form-label">
                Command
                <TextField
                  value={draft.command ?? ''}
                  placeholder="npx"
                  onChange={(v) => setDraft({ ...draft, command: v })}
                />
              </label>
              <label className="form-label">
                Arguments (one per line)
                <textarea
                  className="text-field mcp-field-textarea"
                  value={argsText}
                  placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path'}
                  onChange={(e) => setArgsText(e.target.value)}
                />
              </label>
              <label className="form-label">
                Environment variables (KEY=VALUE per line)
                <textarea
                  className="text-field mcp-field-textarea"
                  value={envText}
                  placeholder="API_KEY=..."
                  onChange={(e) => setEnvText(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label className="form-label">
                URL
                <TextField
                  value={draft.url ?? ''}
                  placeholder="https://example.com/mcp"
                  onChange={(v) => setDraft({ ...draft, url: v })}
                />
              </label>
              <label className="form-label">
                Headers (KEY=VALUE per line)
                <textarea
                  className="text-field mcp-field-textarea"
                  value={headersText}
                  placeholder="Authorization=Bearer ..."
                  onChange={(e) => setHeadersText(e.target.value)}
                />
              </label>
            </>
          )}
          {testResult && (
            <p className={`mcp-test-result${testResult.ok ? ' ok' : ' error'}`}>
              {testResult.ok
                ? `Connected — ${testResult.toolCount ?? 0} tool${
                    testResult.toolCount === 1 ? '' : 's'
                  } found.`
                : `Connection failed: ${testResult.error ?? 'unknown error'}`}
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button className="btn" type="button" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => void testDraft()}
              disabled={testing}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={() => void saveDraft()}
              disabled={saving || !draft.name.trim()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="modal-actions">
          <button className="btn" type="button" onClick={startAdd}>
            Add external MCP server
          </button>
        </div>
      )}

      {deleting &&
        createPortal(
          <ConfirmModal
            title="Delete MCP server"
            onClose={() => setDeleting(null)}
            onConfirm={() => void deleteServer()}
            message={<>Delete the MCP server &quot;{deleting.name}&quot;? This cannot be undone.</>}
          />,
          document.body
        )}
    </>
  )
}

function AppearanceSettings(): React.JSX.Element {
  const theme = useAppStore((s) => s.theme)
  const fontSize = useAppStore((s) => s.fontSize)
  const uiDensity = useAppStore((s) => s.uiDensity)
  const vtabStyle = useAppStore((s) => s.vtabStyle)
  const vtabIconColor = useAppStore((s) => s.vtabIconColor)
  const editorFontFamily = useAppStore((s) => s.editorFontFamily)
  const surfaceTranslucent = useAppStore((s) => s.surfaceTranslucent)
  const setTheme = useAppStore((s) => s.setTheme)
  const setFontSize = useAppStore((s) => s.setFontSize)
  const setUiDensity = useAppStore((s) => s.setUiDensity)
  const setVtabStyle = useAppStore((s) => s.setVtabStyle)
  const setVtabIconColor = useAppStore((s) => s.setVtabIconColor)
  const setEditorFontFamily = useAppStore((s) => s.setEditorFontFamily)
  const setSurfaceTranslucent = useAppStore((s) => s.setSurfaceTranslucent)
  const themeOptions: Array<{
    value: 'light' | 'dark' | 'system'
    label: string
    desc: string
  }> = [
    { value: 'light', label: 'Light', desc: 'Always use light mode' },
    { value: 'dark', label: 'Dark', desc: 'Always use dark mode' },
    { value: 'system', label: 'System', desc: 'Follow the OS setting' }
  ]
  const fontSizeOptions: Array<{
    value: 'small' | 'default' | 'large' | 'xlarge'
    label: string
    desc: string
  }> = [
    { value: 'small', label: 'S', desc: '13px' },
    { value: 'default', label: 'M', desc: '14px' },
    { value: 'large', label: 'L', desc: '15px' },
    { value: 'xlarge', label: 'XL', desc: '16px' }
  ]
  const densityOptions: Array<{
    value: 'compact' | 'cozy'
    label: string
    desc: string
  }> = [
    { value: 'compact', label: 'Compact', desc: 'Tighter spacing' },
    { value: 'cozy', label: 'Cozy', desc: 'Default spacing' }
  ]
  const vtabStyleOptions: Array<{
    value: 'icons' | 'labels'
    label: string
    desc: string
  }> = [
    { value: 'icons', label: 'Icons', desc: 'Icon-only tab strip' },
    { value: 'labels', label: 'Icon + label', desc: 'Icons with labels underneath' }
  ]
  const vtabIconColorOptions: Array<{
    value: 'mono' | 'color'
    label: string
    desc: string
  }> = [
    { value: 'mono', label: 'Mono', desc: 'All icons use the standard gray/accent' },
    { value: 'color', label: 'Color', desc: "Each main tab's icon gets its own color" }
  ]
  const editorFontOptions: Array<{
    value: 'sans' | 'serif' | 'mono'
    label: string
    desc: string
  }> = [
    { value: 'sans', label: 'Sans Serif', desc: 'System UI font' },
    { value: 'serif', label: 'Serif', desc: 'Georgia / Times style' },
    { value: 'mono', label: 'Monospace', desc: 'Code / fixed width' }
  ]
  return (
    <>
      <div className="section-title">Theme</div>
      <p className="hint">Choose PTNotes&apos; color scheme.</p>
      <div className="seg block" role="radiogroup" aria-label="Theme">
        {themeOptions.map((opt) => (
          <button
            key={opt.value}
            role="radio"
            aria-checked={theme === opt.value}
            className={`seg-btn${theme === opt.value ? ' active' : ''}`}
            onClick={() => setTheme(opt.value)}
            title={opt.desc}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="section-title">Font size</div>
      <p className="hint">Base text size for the whole interface.</p>
      <div className="seg block" role="radiogroup" aria-label="Font size">
        {fontSizeOptions.map((opt) => (
          <button
            key={opt.value}
            role="radio"
            aria-checked={fontSize === opt.value}
            className={`seg-btn${fontSize === opt.value ? ' active' : ''}`}
            onClick={() => setFontSize(opt.value)}
            title={opt.desc}
          >
            {opt.label}
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                color: fontSize === opt.value ? 'var(--accent)' : 'var(--text-dim)',
                fontWeight: 400
              }}
            >
              {opt.desc}
            </span>
          </button>
        ))}
      </div>

      <div className="section-title">UI density</div>
      <p className="hint">Compact = less vertical padding (more information on screen).</p>
      <div className="seg block" role="radiogroup" aria-label="UI density">
        {densityOptions.map((opt) => (
          <button
            key={opt.value}
            role="radio"
            aria-checked={uiDensity === opt.value}
            className={`seg-btn${uiDensity === opt.value ? ' active' : ''}`}
            onClick={() => setUiDensity(opt.value)}
            title={opt.desc}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="section-title">Tab bar</div>
      <p className="hint">Icons only, or icons with a label underneath (wider strip).</p>
      <div className="seg block" role="radiogroup" aria-label="Tab bar">
        {vtabStyleOptions.map((opt) => (
          <button
            key={opt.value}
            role="radio"
            aria-checked={vtabStyle === opt.value}
            className={`seg-btn${vtabStyle === opt.value ? ' active' : ''}`}
            onClick={() => setVtabStyle(opt.value)}
            title={opt.desc}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="hint">
        Mono keeps the standard gray/accent; color tints each main tab&apos;s icon.
      </p>
      <div className="seg block" role="radiogroup" aria-label="Icon color">
        {vtabIconColorOptions.map((opt) => (
          <button
            key={opt.value}
            role="radio"
            aria-checked={vtabIconColor === opt.value}
            className={`seg-btn${vtabIconColor === opt.value ? ' active' : ''}`}
            onClick={() => setVtabIconColor(opt.value)}
            title={opt.desc}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="section-title">Editor font</div>
      <p className="hint">Font family for note body content. Does not change the UI chrome font.</p>
      <div className="seg block" role="radiogroup" aria-label="Editor font">
        {editorFontOptions.map((opt) => (
          <button
            key={opt.value}
            role="radio"
            aria-checked={editorFontFamily === opt.value}
            className={`seg-btn${editorFontFamily === opt.value ? ' active' : ''}`}
            onClick={() => setEditorFontFamily(opt.value)}
            title={opt.desc}
            style={{
              fontFamily:
                opt.value === 'sans'
                  ? "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                  : opt.value === 'serif'
                    ? "Georgia, 'Times New Roman', 'Noto Serif', serif"
                    : "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace"
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="section-title">Translucency</div>
      <p className="hint">Frosted translucent popups, menus and panels; Solid = opaque surfaces.</p>
      <div className="seg block" role="radiogroup" aria-label="Translucency">
        <button
          role="radio"
          aria-checked={surfaceTranslucent}
          className={`seg-btn${surfaceTranslucent ? ' active' : ''}`}
          onClick={() => setSurfaceTranslucent(true)}
          title="Blur + translucent backlight behind floating surfaces"
        >
          Translucent
        </button>
        <button
          role="radio"
          aria-checked={!surfaceTranslucent}
          className={`seg-btn${surfaceTranslucent ? '' : ' active'}`}
          onClick={() => setSurfaceTranslucent(false)}
          title="Fully opaque floating surfaces, no blur"
        >
          Solid
        </button>
      </div>
    </>
  )
}

const MCP_NETWORK_WARNING = (
  <>
    <strong>Network access warning:</strong> Enabling this binds the MCP server to 0.0.0.0 and
    accepts requests addressed to any hostname. Traffic and bearer tokens are not encrypted. Use
    only on a trusted local network. Anyone who can reach the port and obtain the token can access
    enabled PTNotes tools; do not expose this port to the internet.
  </>
)

function McpServerPane(): React.JSX.Element {
  const [status, setStatus] = useState<McpServerStatus | null>(null)
  const [portText, setPortText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmNetworkAccess, setConfirmNetworkAccess] = useState(false)
  const [selectedNetworkUrl, setSelectedNetworkUrl] = useState('')

  const applyStatus = useCallback((next: McpServerStatus): void => {
    setStatus(next)
    setPortText(String(next.port))
    setSelectedNetworkUrl((current) =>
      next.networkUrls.includes(current) ? current : (next.networkUrls[0] ?? '')
    )
  }, [])

  async function reload(): Promise<void> {
    try {
      applyStatus(await window.ptnotes.mcpServer.getStatus())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void window.ptnotes.mcpServer
      .getStatus()
      .then(applyStatus)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [applyStatus])

  async function update(patch: Partial<McpServerSettings>): Promise<void> {
    setSaving(true)
    setError('')
    try {
      applyStatus(await window.ptnotes.mcpServer.update(patch))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function regenerate(): Promise<void> {
    setSaving(true)
    setError('')
    try {
      applyStatus(await window.ptnotes.mcpServer.regenerateToken())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function savePort(): void {
    const port = Number(portText.trim())
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setError('Port must be an integer between 1024 and 65535.')
      return
    }
    void update({ port })
  }

  function toggleCategory(key: keyof McpServerCategories, value: boolean): void {
    if (!status) return
    void update({ categories: { ...status.categories, [key]: value } })
  }

  function toggleNetworkAccess(): void {
    if (!status) return
    if (status.listenOnAllInterfaces) {
      void update({ listenOnAllInterfaces: false })
    } else {
      setConfirmNetworkAccess(true)
    }
  }

  async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — ignore
    }
  }

  if (!status) return <p className="hint">Loading…</p>

  const localUrl = status.url || `http://127.0.0.1:${status.port}${'/mcp'}`
  const detectedNetwork = selectedNetworkUrl || 'No active network address detected'
  const clientUrl = status.listenOnAllInterfaces ? selectedNetworkUrl || localUrl : localUrl
  const snippet = `{\n  "mcpServers": {\n    "ptnotes": {\n      "url": "${clientUrl}",\n      "headers": {\n        "Authorization": "Bearer ${status.token}"\n      }\n    }\n  }\n}`
  const categoryRows: { key: keyof McpServerCategories; label: string; desc: string }[] = [
    { key: 'notes', label: 'Notes', desc: 'list, read, create, update and delete notes' },
    { key: 'kanban', label: 'Kanban', desc: 'cards, comments, moves' },
    { key: 'planner', label: 'Planner', desc: 'schedules, tasks and the working-day calendar' }
  ]

  return (
    <>
      <p className="hint">
        Expose PTNotes projects, notes, kanban cards and planner schedules to external MCP clients
        (Claude Desktop, Cursor, …). The server listens on localhost only by default and always
        requires the bearer token below. Every tool requires an explicit project name; clients
        discover them with list_projects.
      </p>
      <div className="module-settings-list">
        <div
          className={`module-settings-row${status.enabled ? '' : ' disabled'}`}
          aria-pressed={status.enabled}
        >
          <span className="module-settings-info">
            <span className="module-settings-name">
              MCP server
              <span
                className={`mcp-status-dot ${status.running ? 'connected' : 'error'}`}
                title={status.running ? 'Running' : 'Stopped'}
              />
            </span>
            <span className="module-settings-desc">
              {status.running
                ? status.listenOnAllInterfaces
                  ? `Listening on ${status.listenAddress}:${status.port} — ${detectedNetwork} — ${status.toolCount} tools, ${status.sessionCount} active session${
                      status.sessionCount === 1 ? '' : 's'
                    }`
                  : `Running at ${localUrl} — ${status.toolCount} tools, ${status.sessionCount} active session${
                      status.sessionCount === 1 ? '' : 's'
                    }`
                : status.enabled
                  ? `Enabled but not running${status.error ? `: ${status.error}` : ''}`
                  : 'Disabled'}
            </span>
          </span>
          <button
            className={`module-settings-toggle${status.enabled ? ' on' : ''}`}
            title={status.enabled ? 'Disable the MCP server' : 'Enable the MCP server'}
            disabled={saving}
            onClick={() => void update({ enabled: !status.enabled })}
          >
            <MdiIcon
              path={status.enabled ? mdiToggleSwitch : mdiToggleSwitchOffOutline}
              size={32}
            />
          </button>
        </div>
      </div>

      {status.enabled && (
        <>
          <div className="module-settings-list">
            <div
              className={`module-settings-row${status.listenOnAllInterfaces ? '' : ' disabled'}`}
              aria-pressed={status.listenOnAllInterfaces}
            >
              <span className="module-settings-info">
                <span className="module-settings-name">Allow network access</span>
                <span className="module-settings-desc">
                  Accept requests from other devices on all IPv4 interfaces (0.0.0.0)
                </span>
              </span>
              <button
                className={`module-settings-toggle${status.listenOnAllInterfaces ? ' on' : ''}`}
                title={
                  status.listenOnAllInterfaces
                    ? 'Disable MCP network access'
                    : 'Allow MCP network access'
                }
                disabled={saving}
                onClick={toggleNetworkAccess}
              >
                <MdiIcon
                  path={status.listenOnAllInterfaces ? mdiToggleSwitch : mdiToggleSwitchOffOutline}
                  size={32}
                />
              </button>
            </div>
          </div>
          <p className="mcp-network-warning">{MCP_NETWORK_WARNING}</p>
        </>
      )}

      <div className="module-settings-list">
        {categoryRows.map(({ key, label, desc }) => (
          <div
            key={key}
            className={`module-settings-row${status.categories[key] ? '' : ' disabled'}`}
            aria-pressed={status.categories[key]}
          >
            <span className="module-settings-info">
              <span className="module-settings-name">{label} tools</span>
              <span className="module-settings-desc">{desc}</span>
            </span>
            <button
              className={`module-settings-toggle${status.categories[key] ? ' on' : ''}`}
              title={status.categories[key] ? `Disable ${label} tools` : `Enable ${label} tools`}
              disabled={saving}
              onClick={() => toggleCategory(key, !status.categories[key])}
            >
              <MdiIcon
                path={status.categories[key] ? mdiToggleSwitch : mdiToggleSwitchOffOutline}
                size={32}
              />
            </button>
          </div>
        ))}
      </div>

      <label className="form-label">
        Port
        <div className="mcp-inline">
          <TextField value={portText} onChange={setPortText} />
          <button
            className="btn primary"
            type="button"
            disabled={saving || portText === String(status.port)}
            onClick={savePort}
          >
            Save
          </button>
        </div>
      </label>

      {status.listenOnAllInterfaces && (
        <label className="form-label">
          Network endpoint
          {status.networkUrls.length > 0 ? (
            <select
              className="text-field mcp-network-select"
              value={selectedNetworkUrl}
              onChange={(event) => setSelectedNetworkUrl(event.target.value)}
            >
              {status.networkUrls.map((networkUrl) => (
                <option key={networkUrl} value={networkUrl}>
                  {networkUrl}
                </option>
              ))}
            </select>
          ) : (
            <TextField value="No active network address detected" readOnly onChange={() => {}} />
          )}
          <span className="hint">
            The client configuration below uses the selected network endpoint. Refresh after
            changing networks.
          </span>
        </label>
      )}

      <label className="form-label">
        Bearer token
        <div className="mcp-inline">
          <TextField value={status.token} readOnly onChange={() => {}} />
          <button className="btn small" type="button" onClick={() => void copy(status.token)}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            className="btn small danger"
            type="button"
            disabled={saving}
            onClick={() => void regenerate()}
          >
            Regenerate
          </button>
        </div>
      </label>

      {status.listenOnAllInterfaces && (
        <p className="hint">
          0.0.0.0 is only the bind address, not a destination address. Use the selected endpoint
          from another device, or replace it with this computer&apos;s hostname.
        </p>
      )}

      <label className="form-label">
        Client configuration
        <textarea
          className="text-field mcp-field-textarea"
          value={snippet}
          readOnly
          rows={8}
          spellCheck={false}
        />
      </label>

      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" type="button" onClick={() => void reload()}>
          Refresh
        </button>
        <button className="btn" type="button" onClick={() => void copy(snippet)}>
          Copy config
        </button>
      </div>
      {confirmNetworkAccess &&
        createPortal(
          <ConfirmModal
            title="Enable MCP network access"
            confirmLabel="Enable network access"
            onClose={() => setConfirmNetworkAccess(false)}
            onConfirm={() => {
              setConfirmNetworkAccess(false)
              void update({ listenOnAllInterfaces: true })
            }}
            message={MCP_NETWORK_WARNING}
          />,
          document.body
        )}
    </>
  )
}

function AboutPane(): React.JSX.Element {
  const [about, setAbout] = useState<AboutInfo | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.ptnotes.settings
      .getAbout()
      .then(setAbout)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (error) {
    return <p className="form-error">{error}</p>
  }

  if (!about) {
    return <p className="hint">Loading…</p>
  }

  return (
    <div className="about">
      <div className="about-header">
        <img className="about-icon" src={appIcon} alt="PTNotes icon" />
        <div className="about-title">
          <span className="about-name">{about.name}</span>
          <span className="about-version">Version {about.version}</span>
        </div>
      </div>
      <p className="about-description">
        Write notes, track tasks, plan schedules, and chat with an AI assistant — all organized by
        project.
      </p>
      <p className="about-stack">
        PTNotes keeps everything for a project in one place: write notes, track tasks on kanban
        boards, plan schedules, and chat with an AI assistant. Everything is stored on your own
        computer — your notes and data stay private, even offline.
      </p>
      <div className="about-runtimes">
        <div className="about-row">
          <span>Electron</span>
          <code>{about.electron}</code>
        </div>
        <div className="about-row">
          <span>Chromium</span>
          <code>{about.chrome}</code>
        </div>
        <div className="about-row">
          <span>Node.js</span>
          <code>{about.node}</code>
        </div>
      </div>
      <div className="about-deps">
        <span className="about-deps-label">Dependencies</span>
        <textarea
          className="about-deps-text"
          readOnly
          spellCheck={false}
          value={about.dependencies.join('\n')}
        />
      </div>
    </div>
  )
}

function SkillEditorModal({
  project,
  initial,
  onClose,
  onSaved
}: {
  project: string
  initial: SkillContent | null
  onClose: () => void
  onSaved: (meta: SkillMeta) => void
}): React.JSX.Element {
  const [scope, setScope] = useState<SkillScope>(initial?.scope ?? 'project')
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const canSave =
    name.trim().length > 0 && description.trim().length > 0 && content.trim().length > 0

  async function save(): Promise<void> {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      const meta = await window.ptnotes.skills.save(project, scope, name, {
        description,
        content,
        enabled: initial?.enabled ?? true
      })
      onSaved(meta)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={initial ? 'Edit Skill' : 'New Skill'} onClose={onClose}>
      <label className="form-label">
        Scope
        <select
          className="text-field"
          value={scope}
          disabled={!!initial}
          onChange={(e) => setScope(e.target.value as SkillScope)}
        >
          <option value="project">Project — this project only</option>
          <option value="global">Global — all projects</option>
        </select>
      </label>
      <label className="form-label">
        Name
        <TextField
          value={name}
          onChange={setName}
          placeholder="e.g. code-review"
          autoFocus
          onEnter={() => void save()}
        />
      </label>
      <label className="form-label">
        Description
        <TextField
          value={description}
          onChange={setDescription}
          placeholder="One-line description shown to the AI"
        />
      </label>
      <label className="form-label">
        Content
        <textarea
          className="text-field skills-content-input"
          rows={8}
          value={content}
          placeholder="Full skill instructions (markdown)…"
          onChange={(e) => setContent(e.target.value)}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={!canSave || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}

function SkillsPane(): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const skillEditRequest = useAppStore((s) => s.skillEditRequest)
  const clearSkillEditRequest = useAppStore((s) => s.clearSkillEditRequest)
  const [skills, setSkills] = useState<SkillList | null>(null)
  const [editing, setEditing] = useState<SkillContent | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<SkillMeta | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const reload = useCallback(async (): Promise<void> => {
    if (!activeProject) return
    const list = await window.ptnotes.skills.list(activeProject)
    setSkills(list)
  }, [activeProject])

  useEffect(() => {
    if (!activeProject) return
    let cancelled = false
    window.ptnotes.skills
      .list(activeProject)
      .then((list) => {
        if (!cancelled) setSkills(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [activeProject])

  useEffect(() => {
    if (!skillEditRequest || !activeProject) return
    const name = skillEditRequest
    void window.ptnotes.skills
      .list(activeProject)
      .then((list) => {
        const found =
          list.project.find((s) => s.name === name) ?? list.global.find((s) => s.name === name)
        if (!found) return
        return window.ptnotes.skills.read(activeProject, found.scope, found.name)
      })
      .then((skill) => {
        if (skill) setEditing(skill)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        clearSkillEditRequest()
      })
  }, [skillEditRequest, activeProject, clearSkillEditRequest])

  useEffect(() => {
    if (!menuFor) return
    function onPointerDown(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null)
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenuFor(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuFor])

  function openMenu(e: React.MouseEvent, key: string): void {
    e.stopPropagation()
    if (menuFor === key) {
      setMenuFor(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuPos({ x: rect.right, y: rect.bottom })
    setMenuFor(key)
  }

  async function openEditor(meta: SkillMeta): Promise<void> {
    if (!activeProject) return
    setMenuFor(null)
    try {
      const skill = await window.ptnotes.skills.read(activeProject, meta.scope, meta.name)
      if (skill) setEditing(skill)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function toggleEnabled(meta: SkillMeta): Promise<void> {
    if (!activeProject) return
    setError('')
    try {
      if (meta.scope === 'builtin') {
        await window.ptnotes.skills.setBuiltinEnabled(meta.name, !meta.enabled)
      } else {
        await window.ptnotes.skills.setEnabled(activeProject, meta.scope, meta.name, !meta.enabled)
      }
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function moveSkill(meta: SkillMeta): Promise<void> {
    if (!activeProject) return
    const toScope = meta.scope === 'global' ? 'project' : 'global'
    setMenuFor(null)
    setError('')
    try {
      await window.ptnotes.skills.move(activeProject, meta.scope, meta.name, toScope)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function renderSection(
    title: string,
    items: SkillMeta[],
    opts: { badge?: string; manageable?: boolean } = {}
  ): React.JSX.Element {
    if (items.length === 0) return <></>
    const manageable = opts.manageable !== false
    return (
      <div className="skills-section">
        <div className="skills-section-title">{title}</div>
        {items.map((meta) => {
          const key = `${meta.scope}:${meta.name}`
          return (
            <div key={key} className={`skills-row${meta.enabled ? '' : ' disabled'}`}>
              <div className="skills-main">
                <span className="skills-badge">
                  {opts.badge ?? (meta.scope === 'global' ? 'Global' : 'Project')}
                </span>
                <span className="skills-name">{meta.name}</span>
                <span className="skills-desc">{meta.description || '(no description)'}</span>
              </div>
              <button
                className={`module-settings-toggle${meta.enabled ? ' on' : ''}`}
                title={meta.enabled ? 'Disable skill' : 'Enable skill'}
                onClick={() => void toggleEnabled(meta)}
              >
                <MdiIcon
                  path={meta.enabled ? mdiToggleSwitch : mdiToggleSwitchOffOutline}
                  size={32}
                />
              </button>
              {manageable && (
                <button
                  className="icon-btn small skills-menu-btn"
                  title="More actions"
                  onClick={(e) => openMenu(e, key)}
                >
                  <MdiIcon path={mdiDotsVertical} size={18} />
                </button>
              )}
              {menuFor === key && menuPos && (
                <>
                  {createPortal(
                    <>
                      <div className="menu-overlay" onClick={() => setMenuFor(null)} />
                      <div
                        ref={menuRef}
                        className="note-menu"
                        style={{ left: menuPos.x, top: menuPos.y }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button className="note-menu-item" onClick={() => void openEditor(meta)}>
                          <span className="note-menu-icon">
                            <MdiIcon path={mdiPencil} size={16} />
                          </span>{' '}
                          Edit skill
                        </button>
                        <button className="note-menu-item" onClick={() => void moveSkill(meta)}>
                          <span className="note-menu-icon">
                            <MdiIcon path={mdiSwapHorizontal} size={16} />
                          </span>{' '}
                          Move to {meta.scope === 'global' ? 'Project' : 'Global'} skills
                        </button>
                        <button
                          className="note-menu-item danger"
                          onClick={() => {
                            setMenuFor(null)
                            setDeleting(meta)
                          }}
                        >
                          <span className="note-menu-icon">
                            <MdiIcon path={mdiTrashCanOutline} size={16} />
                          </span>{' '}
                          Delete skill
                        </button>
                      </div>
                    </>,
                    document.body
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (!activeProject) {
    return <p className="hint">Select a project to manage skills.</p>
  }

  return (
    <>
      <p className="hint">
        Skills are named instruction documents the AI can load on demand. Project skills apply to
        the current project; global skills apply everywhere. The assistant sees a skills index in
        its system prompt and calls <code>read_skill</code> when a skill is relevant. Toggle a skill
        off to exclude it from the assistant; use the ⋮ menu on a skill to edit, move it between
        scopes, or delete it. Build-in skills ship with the app and are read-only — you can only
        enable or disable them here.
      </p>
      <div className="skills-toolbar">
        <button className="btn" onClick={() => setCreating(true)}>
          <MdiIcon path={mdiPlus} size={16} /> New skill
        </button>
        {error && <p className="form-error">{error}</p>}
      </div>
      {!skills ? (
        <p className="hint">Loading…</p>
      ) : (
        <>
          {renderSection('Global skills', skills.global)}
          {renderSection('Project skills', skills.project)}
          {renderSection('Build-in skills', skills.builtin, {
            badge: 'Build-in',
            manageable: false
          })}
          {skills.global.length === 0 &&
            skills.project.length === 0 &&
            skills.builtin.length === 0 && (
              <p className="hint">
                No skills yet — create one to teach the assistant reusable instructions.
              </p>
            )}
        </>
      )}
      {creating &&
        createPortal(
          <SkillEditorModal
            project={activeProject}
            initial={null}
            onClose={() => setCreating(false)}
            onSaved={() => {
              setCreating(false)
              void reload()
            }}
          />,
          document.body
        )}
      {editing &&
        createPortal(
          <SkillEditorModal
            project={activeProject}
            initial={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              void reload()
            }}
          />,
          document.body
        )}
      {deleting &&
        createPortal(
          <ConfirmModal
            title="Delete Skill"
            onClose={() => setDeleting(null)}
            onConfirm={() => {
              void window.ptnotes.skills
                .delete(activeProject, deleting.scope, deleting.name)
                .then(() => {
                  setDeleting(null)
                  void reload()
                })
            }}
            message={
              <>
                Delete the {deleting.scope} skill &quot;{deleting.name}&quot;? This cannot be
                undone.
              </>
            }
          />,
          document.body
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
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null)
  const [modules, setModules] = useState<ModuleSettings[] | null>(null)
  const [toolsets, setToolsets] = useState<ToolsetSettings[] | null>(null)
  const [error, setError] = useState('')
  const [pendingRoot, setPendingRoot] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    void window.ptnotes.settings.get().then(setStorage)
    void window.ptnotes.ai.getProfiles().then(setAiConfig)
    void window.ptnotes.modules.listAvailable().then(setModules)
    void window.ptnotes.toolsets.listAvailable().then(setToolsets)
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

  async function commitAi(next: AIConfig): Promise<void> {
    setError('')
    try {
      const saved = await window.ptnotes.ai.saveProfiles(next)
      setAiConfig(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
            className={category === 'appearance' ? 'active' : ''}
            onClick={() => setSettingsCategory('appearance')}
          >
            Appearance
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
          <button
            className={category === 'toolsets' ? 'active' : ''}
            onClick={() => setSettingsCategory('toolsets')}
          >
            Toolsets
          </button>
          <button
            className={category === 'mcpServer' ? 'active' : ''}
            onClick={() => setSettingsCategory('mcpServer')}
          >
            MCP Server
          </button>
          <button
            className={category === 'skills' ? 'active' : ''}
            onClick={() => setSettingsCategory('skills')}
          >
            Skills
          </button>
          <button
            className={category === 'bots' ? 'active' : ''}
            onClick={() => setSettingsCategory('bots')}
          >
            Bots
          </button>
          <button
            className={category === 'about' ? 'active' : ''}
            onClick={() => setSettingsCategory('about')}
          >
            About
          </button>
        </nav>
        <div className="settings-pane">
          {category === 'storage' ? (
            <>
              <p className="hint">
                Projects live in a root folder on this machine. You can change where all project
                data (notes, kanban cards, chats) is stored. Changing it moves every existing
                project to the new location.
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
          ) : category === 'appearance' ? (
            <>
              <AppearanceSettings />
            </>
          ) : category === 'modules' ? (
            <>
              <ModulesPane modules={modules} setModules={setModules} />
            </>
          ) : category === 'toolsets' ? (
            <>
              <ToolsetsPane toolsets={toolsets} setToolsets={setToolsets} />
            </>
          ) : category === 'mcpServer' ? (
            <>
              <McpServerPane />
            </>
          ) : category === 'skills' ? (
            <>
              <SkillsPane />
            </>
          ) : category === 'bots' ? (
            <>
              <BotsSettingsPane />
            </>
          ) : category === 'about' ? (
            <>
              <AboutPane />
            </>
          ) : (
            <>
              <AiSettingsPane config={aiConfig} onChange={setAiConfig} onCommit={commitAi} />
            </>
          )}
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {pendingRoot && (
        <ConfirmModal
          title="Move project data"
          onClose={() => setPendingRoot(null)}
          disabled={moving}
          confirmLabel={moving ? 'Moving…' : 'Move'}
          onConfirm={() => void confirmMove()}
          message={
            <>
              Move all project data from <code>{storage.rootDir}</code> to{' '}
              <code>{pendingRoot}</code>?
            </>
          }
        >
          <p className="hint">
            Every project folder, notes, chats and the project registry will be moved. The current
            location will no longer be used.
          </p>
        </ConfirmModal>
      )}
    </Modal>
  )
}
