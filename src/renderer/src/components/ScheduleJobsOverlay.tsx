import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScheduleJob, ScheduleJobInput, ScheduleJobRun, ScheduleTimeRule } from '@shared/types'
import { computeNextRunAt } from '@shared/scheduleJobs'
import { useAppStore } from '../store/useAppStore'
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
}

function emptyDraft(): Draft {
  return {
    id: null,
    title: '',
    enabled: true,
    days: [...DEFAULT_WEEKDAYS],
    timeRule: { kind: 'hourly', fromHours: 9, toHours: 18, minute: 0 },
    condition: 'exact',
    prompt: '',
    language: ''
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
    language: job.language ?? ''
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
  const [error, setError] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [timesInput, setTimesInput] = useState('')
  const [timesError, setTimesError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [runsOpen, setRunsOpen] = useState(false)
  const savedFlashTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (savedFlashTimerRef.current !== null) window.clearTimeout(savedFlashTimerRef.current)
    }
  }, [])

  function addTime(): void {
    const raw = timesInput.trim()
    const m = /^([0-9]|[0-2][0-9]):([0-5][0-9])$/.exec(raw)
    if (!m) {
      setTimesError('Use the HH:MM format (24 h), e.g. 09:30.')
      return
    }
    const hour = String(Number(m[1])).padStart(2, '0')
    const normalized = `${hour}:${m[2]}`
    const times = draft.timeRule.kind === 'list' ? draft.timeRule.times : []
    if (times.includes(normalized)) {
      setTimesError(`"${normalized}" is already in the list.`)
      return
    }
    patchRule({ kind: 'list', times: [...times, normalized].sort() })
    setTimesInput('')
    setTimesError(null)
  }

  const loadJobs = useCallback(async (project: string): Promise<void> => {
    try {
      setJobs(await window.ptnotes.jobs.list(project))
    } catch {
      setJobs([])
    }
  }, [])

  const select = useCallback((job: ScheduleJob | null): void => {
    setSelectedId(job ? job.id : null)
    setError(null)
    if (job) setDraft(draftFromJob(job))
    else setDraft(emptyDraft())
  }, [])

  useEffect(() => {
    const cur = useAppStore.getState().activeProject
    if (!cur) return
    window.ptnotes.jobs
      .list(cur)
      .then(setJobs)
      .catch(() => setJobs([]))
    return window.ptnotes.jobs.onEvent((evt) => {
      const projectNow = useAppStore.getState().activeProject
      if (evt.type !== 'runs-changed' || !projectNow) return
      window.ptnotes.jobs
        .list(projectNow)
        .then(setJobs)
        .catch(() => setJobs([]))
      setRunningIds((prev) => prev.filter((id) => id !== evt.jobId))
    })
  }, [loadJobs])

  const patchDraft = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }))

  const patchRule = (patch: Partial<ScheduleTimeRule>): void =>
    setDraft((d) => ({ ...d, timeRule: { ...d.timeRule, ...patch } as ScheduleTimeRule }))

  async function saveJob(): Promise<void> {
    if (!activeProject) return
    if (draft.days.length === 0) {
      setError('A job needs at least one day of week selected.')
      return
    }
    const days = draft.days
    const input: ScheduleJobInput = {
      id: draft.id ?? undefined,
      title: draft.title,
      enabled: draft.enabled,
      days,
      timeRule: draft.timeRule,
      condition: draft.condition,
      prompt: draft.prompt,
      language: draft.language,
      conditionMeta:
        draft.condition === 'next'
          ? {
              nextRunAt: computeNextRunAt(draft.timeRule, days, Date.now() + 60_000) ?? undefined
            }
          : undefined
    }
    try {
      const saved = await window.ptnotes.jobs.save(activeProject, input)
      await loadJobs(activeProject)
      setSelectedId(saved.id)
      setDraft(draftFromJob(saved))
      setError(null)
      setSavedFlash(true)
      if (savedFlashTimerRef.current !== null) window.clearTimeout(savedFlashTimerRef.current)
      savedFlashTimerRef.current = window.setTimeout(() => {
        savedFlashTimerRef.current = null
        setSavedFlash(false)
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
    if (!activeProject || !draft.id) return
    try {
      const updated = await window.ptnotes.jobs.setEnabled(activeProject, draft.id, !draft.enabled)
      await loadJobs(activeProject)
      setDraft(draftFromJob(updated))
    } catch {
      /* keep UI state */
    }
  }

  async function runNow(): Promise<void> {
    if (!activeProject || !draft.id || runningIds.includes(draft.id)) return
    setRunningIds([...runningIds, draft.id])
    try {
      await window.ptnotes.jobs.runNow(activeProject, draft.id)
    } catch {
      // failure lands via runs-changed event
    }
  }

  async function deleteJob(): Promise<void> {
    const project = activeProject
    if (!project || !deleteTarget) return
    try {
      await window.ptnotes.jobs.delete(project, deleteTarget)
      await loadJobs(project)
      if (selectedId === deleteTarget) {
        setSelectedId(null)
        setDraft(emptyDraft())
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
            title={runningIds.includes(selectedId ?? '') ? 'Running…' : 'Execute now'}
            disabled={!isEditing || runningIds.includes(selectedId ?? '')}
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
            {jobs.length === 0 && (
              <p className="sched-jobs-empty">No jobs yet — create one below.</p>
            )}
            {jobs.map((job) => (
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
            ))}
          </div>

          <div className="sched-jobs-detail">
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
                  <div className="sched-jobs-times-list">
                    {draft.timeRule.kind === 'list' && draft.timeRule.times.length === 0 ? (
                      <span className="sched-jobs-times-empty">No times yet — add one below.</span>
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
                    <button className="btn" onClick={addTime}>
                      Add
                    </button>
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
                placeholder="What the background AI should do for this project (it can use module tools)."
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
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
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
      {runsOpen && activeProject && selectedId && (
        <JobRunsPopup
          project={activeProject}
          jobId={selectedId}
          jobTitle={jobs.find((j) => j.id === selectedId)?.title ?? selectedId}
          onClose={() => setRunsOpen(false)}
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
