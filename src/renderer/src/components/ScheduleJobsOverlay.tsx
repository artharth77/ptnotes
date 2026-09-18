import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  JobScope,
  ScheduleJob,
  ScheduleJobInput,
  ScheduleJobRun,
  ScheduleTimeRule
} from '@shared/types'
import { GLOBAL_PROJECT_KEY, computeNextRunAt } from '@shared/scheduleJobs'
import { useAppStore } from '../store/useAppStore'
import { friendlyError } from '../errors'
import { ConfirmModal, Modal, TextField } from './Modal'
import { MdiIcon } from './MdiIcon'
import {
  mdiPlus,
  mdiTrashCanOutline,
  mdiPause,
  mdiPlay,
  mdiRunFast,
  mdiToggleSwitch,
  mdiToggleSwitchOffOutline,
  mdiClose,
  mdiMenuLeft,
  mdiHistory,
  mdiTimelineClockOutline
} from '@mdi/js'

const DEFAULT_DAYS = [0, 1, 2, 3, 4, 5, 6]
/** Default day set for a new job: Monday–Friday. */
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Draft {
  id: string | null
  title: string
  enabled: boolean
  days: number[]
  timeRule: ScheduleTimeRule
  condition: 'exact' | 'next'
  prompt: string
  language: string
  scope: JobScope
}

function emptyDraft(defaultScope: JobScope = 'project'): Draft {
  return {
    id: null,
    title: '',
    enabled: true,
    days: [...DEFAULT_WEEKDAYS],
    timeRule: { kind: 'hourly', fromHours: 9, toHours: 18, minute: 0 },
    condition: 'next',
    prompt: '',
    language: '',
    scope: defaultScope
  }
}

function draftFromJob(job: ScheduleJob): Draft {
  return {
    id: job.id,
    title: job.title,
    enabled: job.enabled,
    days: job.days.length ? [...job.days] : [...DEFAULT_DAYS],
    timeRule: job.timeRule,
    condition: job.condition,
    prompt: job.prompt,
    language: job.language ?? '',
    scope: job.scope
  }
}

function fmtTime(ms: number | undefined): string {
  return ms !== undefined && ms > 0 ? new Date(ms).toLocaleString() : '—'
}

const RUN_LABELS: Record<ScheduleJobRun['status'], string> = {
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled'
}

/** Popup listing the selected job's recent runs with a raw-AI-trace button per run. */
function JobRunsPopup({
  project,
  jobId,
  jobTitle,
  onClose
}: {
  project: string
  jobId: string
  jobTitle: string
  onClose: () => void
}): React.JSX.Element {
  const openTraceViewer = useAppStore((s) => s.openTraceViewer)
  const [runs, setRuns] = useState<ScheduleJobRun[]>([])
  const load = useCallback(async (): Promise<void> => {
    try {
      setRuns(await window.ptnotes.jobs.runs(project, jobId, 20))
    } catch {
      setRuns([])
    }
  }, [project, jobId])
  useEffect(() => {
    window.ptnotes.jobs
      .runs(project, jobId, 20)
      .then(setRuns)
      .catch(() => setRuns([]))
    return window.ptnotes.jobs.onEvent((evt) => {
      if (evt.type === 'runs-changed' && evt.project === project) void load()
    })
  }, [load, project, jobId])

  return (
    <Modal title={`Runs — ${jobTitle}`} className="sched-runs-modal" onClose={onClose}>
      {runs.length === 0 ? (
        <p className="sched-runs-empty">No runs recorded for this job yet.</p>
      ) : (
        <div className="sched-runs-list">
          {runs.map((run) => (
            <div key={run.runId} className="sched-runs-item">
              <div className="sched-runs-item-head">
                <span className={`sched-run-status sched-run-${run.status}`}>
                  {RUN_LABELS[run.status]}
                </span>
                <span className="sched-runs-item-time">
                  {new Date(run.startedAt).toLocaleString()}
                  {run.finishedAt && run.finishedAt > run.startedAt && (
                    <> · {Math.round((run.finishedAt - run.startedAt) / 1000)}s</>
                  )}
                </span>
                <button
                  className="icon-btn sched-runs-trace-btn"
                  title="View raw AI trace"
                  onClick={() =>
                    openTraceViewer({
                      kind: 'jobs',
                      key: run.runId,
                      project,
                      title: `${jobTitle} · ${new Date(run.startedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}`
                    })
                  }
                >
                  <MdiIcon path={mdiTimelineClockOutline} size={16} />
                </button>
              </div>
              {(run.notice ?? run.error) && (
                <span className="sched-runs-item-text">{run.notice ?? run.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function ruleSummary(rule: ScheduleTimeRule): string {
  const pad = (v: number): string => String(v).padStart(2, '0')
  if (rule.kind === 'hourly') {
    return `Hourly ${pad(rule.fromHours)}–${pad(rule.toHours)} @ :${pad(rule.minute)}`
  }
  if (rule.kind === 'every30') {
    return `30 min ${pad(rule.fromHours)}–${pad(rule.toHours)} @ 00/30`
  }
  if (rule.kind === 'every10') {
    return `10 min ${pad(rule.fromHours)}–${pad(rule.toHours)} @ 00/10/..`
  }
  return rule.times.join(', ') || '(no times)'
}

export function ScheduleJobsOverlay(): React.JSX.Element {
  const close = useCallback(() => useAppStore.getState().setScheduleJobsOpen(false), [])
  const activeProject = useAppStore((s) => s.activeProject)
  const [jobs, setJobs] = useState<ScheduleJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [scopeMove, setScopeMove] = useState<{ srcKey: string; destKey: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [timesInput, setTimesInput] = useState('')
  const [timesError, setTimesError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [runsOpen, setRunsOpen] = useState(false)
  const [aiReady, setAiReady] = useState(false)
  const savedFlashTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    window.ptnotes.ai
      .getConfig()
      .then((cfg) => {
        if (cancelled) return
        const local = /localhost|127\.0\.0\.1/.test(cfg.baseUrl || '')
        const key = (cfg.apiKey || '').trim()
        setAiReady(!!cfg.model.trim() && (!!key || !!local || !cfg.baseUrl.trim()))
      })
      .catch(() => setAiReady(false))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      if (savedFlashTimerRef.current !== null) window.clearTimeout(savedFlashTimerRef.current)
    }
  }, [])

  function addTime(): void {
    const raw = timesInput.trim()
    const m = /^([0-2]?\d):([0-5]?\d)$/.exec(raw)
    if (!m || Number(m[1]) > 23) {
      setTimesError('Use the HH:MM format (24 h), e.g. 09:30.')
      return
    }
    const hour = String(Number(m[1])).padStart(2, '0')
    const minute = String(Number(m[2])).padStart(2, '0')
    const normalized = `${hour}:${minute}`
    const times = draft.timeRule.kind === 'list' ? draft.timeRule.times : []
    if (times.includes(normalized)) {
      setTimesError(`"${normalized}" is already in the list.`)
      return
    }
    patchRule({ kind: 'list', times: [...times, normalized].sort() })
    setTimesInput('')
    setTimesError(null)
  }

  const loadJobs = useCallback((): Promise<void> => {
    const proj = useAppStore.getState().activeProject
    return Promise.all([
      proj ? window.ptnotes.jobs.list(proj) : Promise.resolve([] as ScheduleJob[]),
      window.ptnotes.jobs.list(GLOBAL_PROJECT_KEY)
    ])
      .then(([projectJobs, globalJobs]) => setJobs([...projectJobs, ...globalJobs]))
      .catch(() => setJobs([]))
  }, [])

  const select = useCallback((job: ScheduleJob | null): void => {
    setSelectedId(job ? job.id : null)
    setError(null)
    if (job) setDraft(draftFromJob(job))
    else setDraft(emptyDraft(useAppStore.getState().activeProject ? 'project' : 'global'))
  }, [])

  useEffect(() => {
    void loadJobs()
    return window.ptnotes.jobs.onEvent((evt) => {
      if (evt.type !== 'runs-changed') return
      void loadJobs()
      setRunningIds((prev) => prev.filter((id) => id !== evt.jobId))
    })
  }, [loadJobs, activeProject])

  /** DB key for a job by id (global jobs live under the empty key). */
  const keyForJob = useCallback(
    (jobId: string | null): string | null => {
      const job = jobs.find((j) => j.id === jobId)
      if (!job) return null
      if (job.scope === 'global') return GLOBAL_PROJECT_KEY
      return activeProject
    },
    [jobs, activeProject]
  )

  const patchDraft = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }))

  const patchRule = (patch: Partial<ScheduleTimeRule>): void =>
    setDraft((d) => ({ ...d, timeRule: { ...d.timeRule, ...patch } as ScheduleTimeRule }))

  function buildInput(): ScheduleJobInput {
    return {
      id: draft.id ?? undefined,
      title: draft.title,
      enabled: draft.enabled,
      days: draft.days,
      timeRule: draft.timeRule,
      condition: draft.condition,
      prompt: draft.prompt,
      language: draft.language,
      scope: draft.scope,
      conditionMeta:
        draft.condition === 'next'
          ? {
              nextRunAt:
                computeNextRunAt(draft.timeRule, draft.days, Date.now() + 60_000) ?? undefined
            }
          : undefined
    }
  }

  async function afterSave(saved: ScheduleJob): Promise<void> {
    await loadJobs()
    setSelectedId(saved.id)
    setDraft(draftFromJob(saved))
    setError(null)
    setSavedFlash(true)
    if (savedFlashTimerRef.current !== null) window.clearTimeout(savedFlashTimerRef.current)
    savedFlashTimerRef.current = window.setTimeout(() => {
      savedFlashTimerRef.current = null
      setSavedFlash(false)
    }, 2000)
  }

  async function saveJob(): Promise<void> {
    const key = draft.scope === 'global' ? GLOBAL_PROJECT_KEY : activeProject
    if (key === null) {
      setError('Open a project to create a project-scoped job.')
      return
    }
    if (draft.days.length === 0) {
      setError('A job needs at least one day of week selected.')
      return
    }
    if (draft.timeRule.kind === 'list' && draft.timeRule.times.length === 0) {
      setError('Add at least one time to the time list.')
      return
    }
    const input = buildInput()
    const original = draft.id ? jobs.find((j) => j.id === draft.id) : undefined
    const srcKey = keyForJob(draft.id)
    if (original && srcKey !== null && draft.scope !== original.scope) {
      setScopeMove({ srcKey, destKey: key })
      return
    }
    try {
      const saved = await window.ptnotes.jobs.save(key, input)
      await afterSave(saved)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  async function confirmScopeMove(): Promise<void> {
    if (!scopeMove || !draft.id) {
      setScopeMove(null)
      return
    }
    const { srcKey, destKey } = scopeMove
    const id = draft.id
    setScopeMove(null)
    try {
      const saved = await window.ptnotes.jobs.moveScope(srcKey, destKey, id, buildInput())
      await afterSave(saved)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  function cancelClick(): void {
    if (selectedId === null) {
      close()
      return
    }
    // editing: revert the form to the persisted data (no save)
    select(jobs.find((j) => j.id === selectedId) ?? null)
  }

  async function toggleEnabled(): Promise<void> {
    const key = keyForJob(draft.id)
    if (key === null || !draft.id) return
    try {
      const updated = await window.ptnotes.jobs.setEnabled(key, draft.id, !draft.enabled)
      await loadJobs()
      setDraft(draftFromJob(updated))
    } catch {
      /* keep UI state */
    }
  }

  async function runNow(): Promise<void> {
    const key = keyForJob(draft.id)
    if (key === null || !draft.id || runningIds.includes(draft.id)) return
    setRunningIds([...runningIds, draft.id])
    try {
      await window.ptnotes.jobs.runNow(key, draft.id)
    } catch {
      // failure lands via runs-changed event
    }
  }

  async function deleteJob(): Promise<void> {
    const key = keyForJob(deleteTarget)
    if (key === null || !deleteTarget) return
    try {
      await window.ptnotes.jobs.delete(key, deleteTarget)
      await loadJobs()
      if (selectedId === deleteTarget) {
        setSelectedId(null)
        setDraft(emptyDraft(activeProject ? 'project' : 'global'))
      }
    } catch {
      /* ignore */
    }
    setDeleteTarget(null)
  }

  const isEditing = selectedId !== null

  return (
    <Modal title="Jobs" className="sched-jobs-modal" onClose={close}>
      <div className="sched-jobs">
        <div className="sched-jobs-toolbar">
          <button
            className="icon-btn"
            onClick={() => select(null)}
            title="New job (clears the selection)"
          >
            <MdiIcon path={mdiPlus} size={16} />
          </button>
          <button
            className="icon-btn danger"
            title="Delete the selected job"
            disabled={!isEditing}
            onClick={() => setDeleteTarget(selectedId)}
          >
            <MdiIcon path={mdiTrashCanOutline} size={16} />
          </button>
          <button
            className="icon-btn"
            title={draft.enabled ? 'Disable the selected job' : 'Enable the selected job'}
            disabled={!isEditing}
            onClick={() => void toggleEnabled()}
          >
            <MdiIcon path={draft.enabled ? mdiPause : mdiPlay} size={16} />
          </button>
          <button
            className="icon-btn primary"
            title={
              runningIds.includes(selectedId ?? '')
                ? 'Running…'
                : aiReady
                  ? 'Execute now'
                  : 'Execute now (AI is not configured)'
            }
            disabled={!isEditing || runningIds.includes(selectedId ?? '') || !aiReady}
            onClick={() => void runNow()}
          >
            <MdiIcon path={mdiRunFast} size={16} />
          </button>
          {runningIds.includes(selectedId ?? '') && (
            <span className="sched-jobs-running">Running…</span>
          )}
          <button
            className="icon-btn sched-jobs-history-btn"
            title="Run history and AI traces"
            disabled={!isEditing}
            onClick={() => setRunsOpen(true)}
          >
            <MdiIcon path={mdiHistory} size={16} />
          </button>
        </div>

        <div className="sched-jobs-body">
          <div className="sched-jobs-list">
            {(() => {
              const projectJobs = activeProject ? jobs.filter((j) => j.scope === 'project') : []
              const globalJobs = jobs.filter((j) => j.scope === 'global')
              const renderItem = (job: ScheduleJob): React.JSX.Element => (
                <button
                  key={job.id}
                  className={`sched-jobs-item ${job.id === selectedId ? 'active' : ''}`}
                  onClick={() => select(job)}
                >
                  <span className="sched-jobs-item-title">{job.title}</span>
                  <span className="sched-jobs-item-sub">{ruleSummary(job.timeRule)}</span>
                  {!job.enabled && (
                    <span className="sched-jobs-item-pause">
                      <MdiIcon path={mdiPause} size={16} />
                    </span>
                  )}
                </button>
              )
              return (
                <>
                  {activeProject ? (
                    <>
                      <p className="sched-jobs-section">This project</p>
                      {projectJobs.length === 0 && (
                        <p className="sched-jobs-empty">No project jobs yet.</p>
                      )}
                      {projectJobs.map(renderItem)}
                    </>
                  ) : (
                    <p className="sched-jobs-empty">Open a project to manage its jobs.</p>
                  )}
                  <p className="sched-jobs-section">Global (all projects)</p>
                  {globalJobs.length === 0 && (
                    <p className="sched-jobs-empty">No global jobs yet.</p>
                  )}
                  {globalJobs.map(renderItem)}
                </>
              )
            })()}
          </div>

          <div className="sched-jobs-detail">
            <div className="sched-jobs-detail-scroll">
              <h3>{isEditing ? 'Job detail' : 'New job'}</h3>
              {isEditing && (
                <div className="sched-jobs-meta">
                  <span>
                    Last executed: {fmtTime(jobs.find((j) => j.id === draft.id)?.lastRunAt)}
                  </span>
                  <span>
                    Next execute:{' '}
                    {fmtTime(
                      draft.condition === 'next'
                        ? jobs.find((j) => j.id === draft.id)?.nextRunAt
                        : undefined
                    )}
                  </span>
                </div>
              )}
              <div className="sched-jobs-title-row">
                <label className="sched-jobs-field sched-jobs-title-field">
                  <span>Job title</span>
                  <TextField value={draft.title} onChange={(v) => patchDraft({ title: v })} />
                </label>
                <div className="sched-jobs-field sched-jobs-enabled-field">
                  <span>Enabled</span>
                  <button
                    className={`module-settings-toggle${draft.enabled ? ' on' : ''}`}
                    title={draft.enabled ? 'Disable this job' : 'Enable this job'}
                    onClick={() => patchDraft({ enabled: !draft.enabled })}
                  >
                    <MdiIcon
                      path={draft.enabled ? mdiToggleSwitch : mdiToggleSwitchOffOutline}
                      size={32}
                    />
                  </button>
                </div>
              </div>
              <div className="sched-jobs-field">
                <span>Run in</span>
                <div className="sched-jobs-rule-seg" role="group" aria-label="Job scope">
                  <button
                    type="button"
                    className={`day-seg ${draft.scope === 'project' ? 'active' : ''}`}
                    disabled={!activeProject}
                    title={
                      activeProject
                        ? 'Run in the current project only'
                        : 'Open a project to use project scope'
                    }
                    onClick={() => patchDraft({ scope: 'project' })}
                  >
                    This project
                  </button>
                  <button
                    type="button"
                    className={`day-seg ${draft.scope === 'global' ? 'active' : ''}`}
                    title="Run in every project, then summarize all results into one notification"
                    onClick={() => patchDraft({ scope: 'global' })}
                  >
                    All projects
                  </button>
                </div>
                {draft.scope === 'global' && (
                  <span className="sched-jobs-scope-hint">
                    Runs the prompt in every project, then summarizes all results into one
                    notification.
                  </span>
                )}
              </div>
              <div className="sched-jobs-field">
                <span>Days of week</span>
                <div className="sched-jobs-days" role="group" aria-label="Days of week">
                  {WEEKDAYS.map((label, i) => {
                    const active = draft.days.includes(i)
                    return (
                      <button
                        key={label}
                        type="button"
                        className={`day-seg ${active ? 'active' : ''}`}
                        title={active ? `Deselect ${label}` : `Select ${label}`}
                        onClick={() =>
                          patchDraft({
                            days: active
                              ? draft.days.filter((d) => d !== i)
                              : [...draft.days, i].sort((a, b) => a - b)
                          })
                        }
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="sched-jobs-field">
                <span>Time rule</span>
                <div className="sched-jobs-rule-seg" role="group" aria-label="Time rule">
                  {(
                    [
                      { kind: 'hourly', label: 'Every hour' },
                      { kind: 'every30', label: 'Every 30 minutes' },
                      { kind: 'every10', label: 'Every 10 minutes' },
                      { kind: 'list', label: 'Specific time list' }
                    ] as Array<{ kind: ScheduleTimeRule['kind']; label: string }>
                  ).map((opt) => {
                    const active = draft.timeRule.kind === opt.kind
                    return (
                      <button
                        key={opt.kind}
                        type="button"
                        className={`day-seg ${active ? 'active' : ''}`}
                        title={active ? opt.label : `Switch to ${opt.label.toLowerCase()}`}
                        onClick={() => {
                          if (opt.kind === 'hourly') {
                            patchRule({
                              kind: 'hourly',
                              ...('minute' in draft.timeRule ? {} : { minute: 0 })
                            } as Partial<ScheduleTimeRule>)
                          } else if (opt.kind === 'list') {
                            patchRule({ kind: 'list', times: [] })
                          } else {
                            patchRule({ kind: opt.kind })
                          }
                        }}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                {draft.timeRule.kind !== 'list' ? (
                  <div className="sched-jobs-row">
                    <label>
                      From HH
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={draft.timeRule.fromHours}
                        onChange={(e) => patchRule({ fromHours: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      To HH
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={draft.timeRule.toHours}
                        onChange={(e) => patchRule({ toHours: Number(e.target.value) })}
                      />
                    </label>
                    {draft.timeRule.kind === 'hourly' && 'minute' in draft.timeRule && (
                      <label>
                        At MM
                        <input
                          type="number"
                          min={0}
                          max={59}
                          value={draft.timeRule.minute}
                          onChange={(e) => patchRule({ minute: Number(e.target.value) })}
                        />
                      </label>
                    )}
                  </div>
                ) : (
                  <div className="sched-jobs-times">
                    <span className="sched-jobs-times-label">Time list</span>
                    <div className="sched-jobs-times-row">
                      <div className="sched-jobs-times-list">
                        {draft.timeRule.kind === 'list' && draft.timeRule.times.length === 0 ? (
                          <span className="sched-jobs-times-empty">No times yet.</span>
                        ) : (
                          draft.timeRule.kind === 'list' &&
                          draft.timeRule.times.map((t) => (
                            <span key={t} className="kanban-chip">
                              {t}
                              <button
                                className="kanban-chip-remove"
                                title={`Remove ${t}`}
                                onClick={() =>
                                  patchRule({
                                    times: (draft.timeRule as { times: string[] }).times.filter(
                                      (x) => x !== t
                                    )
                                  })
                                }
                              >
                                <MdiIcon path={mdiClose} size={16} />
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <div className="sched-jobs-times-add">
                        <button className="btn" onClick={addTime}>
                          <MdiIcon path={mdiMenuLeft} size={16} /> Add
                        </button>
                        <input
                          className="sched-jobs-times-input"
                          type="text"
                          value={timesInput}
                          placeholder="HH:MM"
                          onChange={(e) => {
                            setTimesInput(e.target.value)
                            setTimesError(null)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addTime()
                            }
                          }}
                        />
                      </div>
                    </div>
                    {timesError && <span className="form-error">{timesError}</span>}
                  </div>
                )}
              </div>
              <div className="sched-jobs-field">
                <span>Execution condition</span>
                <label className="sched-jobs-radio">
                  <input
                    type="radio"
                    name="sched-cond"
                    checked={draft.condition === 'exact'}
                    onChange={() => patchDraft({ condition: 'exact' })}
                  />
                  Meet exactly time (±2 min window, deduped)
                </label>
                <label className="sched-jobs-radio">
                  <input
                    type="radio"
                    name="sched-cond"
                    checked={draft.condition === 'next'}
                    onChange={() => patchDraft({ condition: 'next' })}
                  />
                  Next execute time (pre-computed, fires once reached)
                </label>
              </div>
              <label className="sched-jobs-field">
                <span>Prompt</span>
                <textarea
                  className="sched-jobs-prompt"
                  rows={5}
                  value={draft.prompt}
                  onChange={(e) => patchDraft({ prompt: e.target.value })}
                  placeholder={
                    draft.scope === 'global'
                      ? 'What the background AI should do in every project (it can use module tools). Results are summarized into one answer.'
                      : 'What the background AI should do for this project (it can use module tools).'
                  }
                />
              </label>
              <label className="sched-jobs-field">
                <span>Preferred response language</span>
                <TextField
                  value={draft.language}
                  onChange={(v) => patchDraft({ language: v })}
                  placeholder="English"
                />
              </label>
            </div>
            <div className="modal-actions">
              {error && <p className="form-error">{error}</p>}
              <button className="btn" onClick={cancelClick}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => void saveJob()} disabled={savedFlash}>
                {savedFlash ? 'Saved ✓' : isEditing ? 'Save changes' : 'Create job'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {runsOpen && selectedId && keyForJob(selectedId) !== null && (
        <JobRunsPopup
          project={keyForJob(selectedId)!}
          jobId={selectedId}
          jobTitle={jobs.find((j) => j.id === selectedId)?.title ?? selectedId}
          onClose={() => setRunsOpen(false)}
        />
      )}
      {scopeMove && (
        <ConfirmModal
          title="Change job scope"
          message={`Changing "Run in" recreates the job in ${
            scopeMove.destKey === GLOBAL_PROJECT_KEY ? 'all projects' : 'this project'
          } and deletes the existing job in ${
            scopeMove.srcKey === GLOBAL_PROJECT_KEY ? 'all projects' : 'this project'
          }, including its run history and AI traces. This cannot be undone.`}
          confirmLabel="Move & delete"
          onConfirm={() => void confirmScopeMove()}
          onClose={() => setScopeMove(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Delete job"
          message={`Delete job "${jobs.find((j) => j.id === deleteTarget)?.title ?? deleteTarget}" and its run history? This cannot be undone.`}
          onConfirm={() => void deleteJob()}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </Modal>
  )
}
