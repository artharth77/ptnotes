import { useCallback, useEffect, useRef, useState } from 'react'
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
  AIProviderConfig,
  ModuleSettings,
  SkillContent,
  SkillList,
  SkillMeta,
  SkillScope,
  StorageSettings
} from '@shared/types'
import appIcon from '../../../../resources/icon.png'

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
            <div
              key={m.id}
              className={`module-settings-row${m.enabled ? '' : ' disabled'}`}
              aria-pressed={m.enabled}
              onClick={() => void toggle(m)}
            >
              <span className="module-settings-info">
                <span className="module-settings-name">{m.name}</span>
                <span className="module-settings-desc">{m.summary}</span>
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
    if (!menuFor) return
    function onPointerDown(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
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
      await window.ptnotes.skills.setEnabled(activeProject, meta.scope, meta.name, !meta.enabled)
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

  function renderSection(title: string, items: SkillMeta[]): React.JSX.Element {
    if (items.length === 0) return <></>
    return (
      <div className="skills-section">
        <div className="skills-section-title">{title}</div>
        {items.map((meta) => {
          const key = `${meta.scope}:${meta.name}`
          return (
            <div key={key} className={`skills-row${meta.enabled ? '' : ' disabled'}`}>
              <div className="skills-main">
                <span className="skills-badge">
                  {meta.scope === 'global' ? 'Global' : 'Project'}
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
              <button
                className="icon-btn small skills-menu-btn"
                title="More actions"
                onClick={(e) => openMenu(e, key)}
              >
                <MdiIcon path={mdiDotsVertical} size={18} />
              </button>
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
        scopes, or delete it.
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
          {skills.global.length === 0 && skills.project.length === 0 && (
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
