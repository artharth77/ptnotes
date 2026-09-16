import { useCallback, useEffect, useState } from 'react'
import type { ScheduleJob, ScheduleJobInput, ScheduleTimeRule } from '@shared/types'
import { computeNextRunAt } from '@shared/scheduleJobs'
import { useAppStore } from '../store/useAppStore'
import { ConfirmModal, Modal, TextField } from './Modal'

const DEFAULT_DAYS = [0, 1, 2, 3, 4, 5, 6]
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
    days: [...DEFAULT_DAYS],
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
    const days = draft.days.length ? draft.days : DEFAULT_DAYS
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
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
    <Modal title="Schedule Jobs" className="sched-jobs-modal" onClose={close}>
      <div className="sched-jobs">
        <div className="sched-jobs-toolbar">
          <button
            className="btn"
            onClick={() => select(null)}
            title="Clear selection and start a new job"
          >
            New job
          </button>
          <button
            className="btn danger"
            disabled={!isEditing}
            onClick={() => setDeleteTarget(selectedId)}
          >
            Delete
          </button>
          <button className="btn" disabled={!isEditing} onClick={() => void toggleEnabled()}>
            {draft.enabled ? 'Disable job' : 'Enable job'}
          </button>
          <button
            className="btn primary"
            disabled={!isEditing || runningIds.includes(selectedId ?? '')}
            onClick={() => void runNow()}
          >
            {runningIds.includes(selectedId ?? '') ? 'Running…' : 'Execute now'}
          </button>
        </div>

        <div className="sched-jobs-list">
          {jobs.length === 0 && <p className="sched-jobs-empty">No jobs yet — create one below.</p>}
          {jobs.map((job) => (
            <button
              key={job.id}
              className={`sched-jobs-item ${job.id === selectedId ? 'active' : ''}`}
              onClick={() => select(job)}
            >
              <span className="sched-jobs-item-title">
                {job.enabled ? '' : '⏸ '}
                {job.title}
              </span>
              <span className="sched-jobs-item-sub">{ruleSummary(job.timeRule)}</span>
            </button>
          ))}
        </div>

        <div className="sched-jobs-detail">
          <h3>{isEditing ? 'Job detail' : 'New job'}</h3>
          {isEditing && (
            <div className="sched-jobs-meta">
              <span>Last executed: {fmtTime(jobs.find((j) => j.id === draft.id)?.lastRunAt)}</span>
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
          <label className="sched-jobs-field">
            <span>Job title</span>
            <TextField value={draft.title} onChange={(v) => patchDraft({ title: v })} />
          </label>
          <label className="sched-jobs-switch">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => patchDraft({ enabled: e.target.checked })}
            />
            Enabled
          </label>
          <div className="sched-jobs-field">
            <span>Days of week</span>
            <div className="sched-jobs-days">
              {WEEKDAYS.map((label, i) => (
                <label key={label} className="day-chip">
                  <input
                    type="checkbox"
                    checked={draft.days.includes(i)}
                    onChange={(e) =>
                      patchDraft({
                        days: e.target.checked
                          ? [...draft.days, i].sort((a, b) => a - b)
                          : draft.days.filter((d) => d !== i)
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="sched-jobs-field">
            <span>Time rule</span>
            <select
              className="sched-jobs-select"
              value={draft.timeRule.kind}
              onChange={(e) => {
                const kind = e.target.value as ScheduleTimeRule['kind']
                if (kind === 'hourly') {
                  patchRule({
                    kind,
                    ...('minute' in draft.timeRule ? {} : { minute: 0 })
                  } as Partial<ScheduleTimeRule>)
                } else if (kind === 'list') {
                  patchRule({ times: ['09:00'] })
                } else {
                  patchRule({ kind })
                }
              }}
            >
              <option value="hourly">Every hour from HH to HH at MM</option>
              <option value="every30">Every 30 minutes from HH to HH at 00 and 30</option>
              <option value="every10">
                Every 10 minutes from HH to HH at 00, 10, 20, 30, 40, 50
              </option>
              <option value="list">Specific time list</option>
            </select>
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
              <div className="sched-jobs-row times-row">
                <label>
                  Times (HH:MM, comma separated)
                  <input
                    type="text"
                    value={(draft.timeRule as { times: string[] }).times.join(', ')}
                    onChange={(e) =>
                      patchRule({ times: e.target.value.split(',').map((t) => t.trim()) })
                    }
                  />
                </label>
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
            <button className="btn" onClick={() => select(null)}>
              New job
            </button>
            <button className="btn primary" onClick={() => void saveJob()}>
              {isEditing ? 'Save changes' : 'Create job'}
            </button>
          </div>
        </div>
      </div>
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
