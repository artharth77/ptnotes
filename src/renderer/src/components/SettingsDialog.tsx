import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  mdiDotsVertical,
  mdiPencil,
  mdiPlus,
  mdiSwapHorizontal,
  mdiToggleSwitch,
  mdiToggleSwitchOffOutline,
  mdiTrashCanOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { Modal, TextField } from './Modal'
import { MdiIcon } from './MdiIcon'
import type {
  AboutInfo,
  AIConfig,
  AIProfile,
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

  const profile = config.profiles.find((p) => p.id === config.activeProfileId) ?? config.profiles[0]
  const profileId = profile?.id ?? ''

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
    if (profile) setEditing({ ...profile })
  }

  async function deleteProfile(): Promise<void> {
    if (config.profiles.length <= 1) return
    const rest = config.profiles.filter((p) => p.id !== profileId)
    const next: AIConfig = {
      ...config,
      profiles: rest,
      activeProfileId: config.activeProfileId === profileId ? rest[0].id : config.activeProfileId
    }
    await onCommit(next)
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
        <label className="form-label profile-active">
          Active profile
          <select
            className="text-field"
            value={config.activeProfileId}
            onChange={(e) => {
              const next = { ...config, activeProfileId: e.target.value }
              onChange(next)
              void onCommit(next)
            }}
          >
            {config.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        </label>
        <div className="profile-actions">
          <button className="btn" onClick={addProfile}>
            <MdiIcon path={mdiPlus} size={16} /> New profile
          </button>
          <button className="btn" onClick={editProfile} disabled={!profile}>
            Edit profile
          </button>
          <button
            className="btn"
            onClick={() => void deleteProfile()}
            disabled={!profile || config.profiles.length <= 1}
          >
            Delete profile
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

function ToolsetsPane({
  toolsets,
  setToolsets
}: {
  toolsets: ToolsetSettings[] | null
  setToolsets: (m: ToolsetSettings[]) => void
}): React.JSX.Element {
  const [toggling, setToggling] = useState<string | null>(null)

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

  return (
    <>
      <p className="hint">
        Toolsets add extra tools the AI can use during chat. Each enabled toolset adds tools to
        every chat turn — this uses more tokens and increases the chance the AI selects the wrong
        tool. Toolsets are only active in the AI chat, never in module subagents.
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
                </span>
                <span className="module-settings-desc">{t.summary}</span>
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
        Markdown notes + todo lists + AI assistant, organized by project.
      </p>
      <p className="about-stack">
        A desktop app built with Electron and React. Notes are WYSIWYG-edited with TipTap and stored
        as markdown, todos live in a markdown checklist, and the AI chat works with any
        OpenAI-compatible API. Everything runs locally — your notes and data stay on this machine.
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
                  <div className="menu-overlay" onClick={() => setMenuFor(null)} />
                  <div
                    ref={menuRef}
                    className="note-menu"
                    style={{ left: menuPos.x, top: menuPos.y }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button className="note-menu-item" onClick={() => void openEditor(meta)}>
                      <span className="note-menu-icon">
                        <MdiIcon path={mdiPencil} size={15} />
                      </span>{' '}
                      Edit skill
                    </button>
                    <button className="note-menu-item" onClick={() => void moveSkill(meta)}>
                      <span className="note-menu-icon">
                        <MdiIcon path={mdiSwapHorizontal} size={15} />
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
                        <MdiIcon path={mdiTrashCanOutline} size={15} />
                      </span>{' '}
                      Delete skill
                    </button>
                  </div>
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
      {creating && (
        <SkillEditorModal
          project={activeProject}
          initial={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            void reload()
          }}
        />
      )}
      {editing && (
        <SkillEditorModal
          project={activeProject}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}
      {deleting && (
        <Modal title="Delete Skill" onClose={() => setDeleting(null)}>
          <p className="confirm-message">
            Delete the {deleting.scope} skill &quot;{deleting.name}&quot;? This cannot be undone.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              className="btn danger"
              onClick={() => {
                void window.ptnotes.skills
                  .delete(activeProject, deleting.scope, deleting.name)
                  .then(() => {
                    setDeleting(null)
                    void reload()
                  })
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
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
            className={category === 'skills' ? 'active' : ''}
            onClick={() => setSettingsCategory('skills')}
          >
            Skills
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
          ) : category === 'toolsets' ? (
            <>
              <ToolsetsPane toolsets={toolsets} setToolsets={setToolsets} />
            </>
          ) : category === 'skills' ? (
            <>
              <SkillsPane />
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
