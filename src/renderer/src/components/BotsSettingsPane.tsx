import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { mdiPencil, mdiPlus, mdiTrashCanOutline } from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import type { AIProfile } from '@shared/types'
import type { BotMemoryEntry, GroupChatMeta } from '@shared/bots'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'
import { friendlyError } from '../errors'

interface FormState {
  id?: string
  name: string
  role: string
  roleDetails: string
  persona: string
  profileId: string
  model: string
}

const EMPTY_FORM: FormState = {
  name: '',
  role: '',
  roleDetails: '',
  persona: '',
  profileId: '',
  model: ''
}

/** Settings ▸ Bots — manage the global bot library and per-project memories. */
export function BotsSettingsPane(): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const bots = useAppStore((s) => s.botProfiles)
  const loadBotProfiles = useAppStore((s) => s.loadBotProfiles)
  const saveBotProfile = useAppStore((s) => s.saveBotProfile)
  const deleteBotProfile = useAppStore((s) => s.deleteBotProfile)
  const [profiles, setProfiles] = useState<AIProfile[]>([])
  const [userName, setUserName] = useState('')
  const [editing, setEditing] = useState<FormState | null>(null)
  const [memories, setMemories] = useState<BotMemoryEntry[]>([])
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string
    groups: GroupChatMeta[]
  } | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const editorWasOpen = useRef(false)

  useLayoutEffect(() => {
    const open = editing !== null
    if (open && !editorWasOpen.current) {
      nameInputRef.current?.scrollIntoView({ block: 'start' })
    }
    editorWasOpen.current = open
  }, [editing])

  useEffect(() => {
    void loadBotProfiles()
    void window.ptnotes.ai.getProfiles().then((cfg) => setProfiles(cfg.profiles))
    void window.ptnotes.bots.getUserName().then(setUserName)
  }, [loadBotProfiles])

  useEffect(() => {
    let cancelled = false
    const load = activeProject
      ? window.ptnotes.bots.listMemories(activeProject)
      : Promise.resolve([])
    load.then((m) => {
      if (!cancelled) setMemories(m)
    })
    return () => {
      cancelled = true
    }
  }, [activeProject, bots])

  async function save(): Promise<void> {
    if (!editing) return
    setError('')
    try {
      await saveBotProfile({
        ...(editing.id ? { id: editing.id } : {}),
        name: editing.name,
        role: editing.role,
        roleDetails: editing.roleDetails || null,
        persona: editing.persona,
        profileId: editing.profileId || null,
        model: editing.model || null
      })
      setEditing(null)
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  async function saveUserName(): Promise<void> {
    const saved = await window.ptnotes.bots.setUserName(userName)
    setUserName(saved)
  }

  async function openDeleteConfirm(id: string): Promise<void> {
    setError('')
    setConfirmDelete({ id, groups: [] })
    if (!activeProject) return
    try {
      const groups = await window.ptnotes.bots.listGroups(activeProject)
      setConfirmDelete((cur) =>
        cur?.id === id ? { id, groups: groups.filter((g) => g.botIds.includes(id)) } : cur
      )
    } catch {
      // membership info is best-effort; deletion still works without it
    }
  }

  async function removeBot(): Promise<void> {
    if (!confirmDelete) return
    const id = confirmDelete.id
    setConfirmDelete(null)
    setError('')
    try {
      await deleteBotProfile(id)
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  const botMemories = memories.filter((m) => m.botId === editing?.id)

  return (
    <>
      <p className="hint">
        Bots are global identities you can add to group chats. Each bot has a role, an optional role
        description (shared with the other bots in the group), a persona and an optional model
        override; memories are scoped per project. Your name below tells the bots what to call you.
      </p>
      <label className="form-label">
        Your name (optional)
        <input
          className="form-input"
          value={userName}
          placeholder="Bots will address you by this name (e.g. Alex)"
          onChange={(e) => setUserName(e.target.value)}
          onBlur={() => void saveUserName()}
        />
      </label>
      <div className="bots-lib-header">
        <span className="form-label">Bot library</span>
        <button
          className="btn small"
          onClick={() => setEditing({ ...EMPTY_FORM })}
          disabled={!!editing}
        >
          <MdiIcon path={mdiPlus} size={14} /> New bot
        </button>
      </div>
      <div className="bots-lib-list">
        {bots.length === 0 && !editing && <div className="form-hint">No bots yet.</div>}
        {bots.map((b) => (
          <div key={b.id} className="bots-lib-row">
            <div className="bots-lib-info">
              <span className="bots-lib-name">{b.name}</span>
              {b.role && <span className="command-badge">{b.role}</span>}
              <span className="bots-lib-id">@{b.id}</span>
            </div>
            <div className="bots-lib-actions">
              <button
                className="icon-btn"
                title="Edit bot"
                onClick={() =>
                  setEditing({
                    id: b.id,
                    name: b.name,
                    role: b.role,
                    roleDetails: b.roleDetails ?? '',
                    persona: b.persona,
                    profileId: b.profileId ?? '',
                    model: b.model ?? ''
                  })
                }
              >
                <MdiIcon path={mdiPencil} size={14} />
              </button>
              <button
                className="icon-btn"
                title="Delete bot"
                onClick={() => void openDeleteConfirm(b.id)}
              >
                <MdiIcon path={mdiTrashCanOutline} size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="bots-editor">
          <div className="bots-editor-title">
            {editing.id ? `Edit ${editing.name || 'bot'}` : 'New bot'}
          </div>
          <label className="form-label">
            Name
            <input
              className="form-input"
              ref={nameInputRef}
              autoFocus
              value={editing.name}
              placeholder="e.g. Alice"
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <label className="form-label">
            Role
            <input
              className="form-input"
              value={editing.role}
              placeholder="e.g. Project Manager"
              onChange={(e) => setEditing({ ...editing, role: e.target.value })}
            />
          </label>
          <label className="form-label">
            Role details (optional)
            <textarea
              className="form-input bots-persona"
              rows={2}
              value={editing.roleDetails}
              placeholder="What this role does, so other bots know when to involve it (e.g. “Owns the schedule, breaks goals into tasks, tracks progress”)"
              onChange={(e) => setEditing({ ...editing, roleDetails: e.target.value })}
            />
          </label>
          <label className="form-label">
            Persona / standing instructions
            <textarea
              className="form-input bots-persona"
              rows={4}
              value={editing.persona}
              placeholder="How this bot behaves in group chats…"
              onChange={(e) => setEditing({ ...editing, persona: e.target.value })}
            />
          </label>
          <label className="form-label">
            AI profile
            <select
              className="form-input"
              value={editing.profileId}
              onChange={(e) => setEditing({ ...editing, profileId: e.target.value })}
            >
              <option value="">Active profile</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.model || 'no model'})
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Model override
            <input
              className="form-input"
              value={editing.model}
              placeholder="Optional — overrides the profile's model"
              onChange={(e) => setEditing({ ...editing, model: e.target.value })}
            />
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => void save()}
              disabled={!editing.name.trim()}
            >
              Save
            </button>
          </div>
          {editing.id && activeProject && (
            <div className="bots-memory">
              <div className="form-label">Memory in “{activeProject}”</div>
              {botMemories.length === 0 && <div className="form-hint">Nothing remembered yet.</div>}
              {botMemories.map((m) => (
                <div key={m.id} className="bots-memory-row">
                  <span className="bots-memory-content">{m.content}</span>
                  <button
                    className="icon-btn"
                    title="Forget"
                    onClick={() => {
                      void window.ptnotes.bots
                        .deleteMemory(activeProject, m.botId, m.id)
                        .then((ok) => {
                          if (ok)
                            setMemories((prev) =>
                              prev.filter((x) => x.id !== m.id || x.botId !== m.botId)
                            )
                        })
                    }}
                  >
                    <MdiIcon path={mdiTrashCanOutline} size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      {confirmDelete && (
        <Modal title="Delete Bot" onClose={() => setConfirmDelete(null)}>
          <p className="confirm-message">
            Delete bot &quot;{bots.find((b) => b.id === confirmDelete.id)?.name ?? confirmDelete.id}
            &quot;? This cannot be undone.
          </p>
          {confirmDelete.groups.length > 0 && (
            <p className="hint">
              The bot is a member of {confirmDelete.groups.length} group chat
              {confirmDelete.groups.length === 1 ? '' : 's'} in this project (
              {confirmDelete.groups.map((g) => `“${g.title}”`).join(', ')}) and will be removed from
              {confirmDelete.groups.length === 1 ? ' it' : ' them'}.
            </p>
          )}
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => void removeBot()}>
              Delete
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
