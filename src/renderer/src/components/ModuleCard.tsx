import { useState } from 'react'
import { mdiChatProcessingOutline, mdiRefresh } from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import type { ModuleRun, ModuleStepState } from '@shared/types'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'
import { fileTypeIcon } from './contentIcons'
import { STATUS_LABELS } from './moduleStatus'

function stepIcon(step: ModuleStepState): string {
  switch (step.status) {
    case 'done':
      return '✔'
    case 'running':
      return '…'
    case 'failed':
      return '✕'
    default:
      return '·'
  }
}

function formatUpdatedAt(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Presentational card rendering a single module run with its live status. */
export function ModuleCard({
  run,
  compact,
  defaultExpanded = false
}: {
  run: ModuleRun
  compact?: boolean
  /** Start with the action area (output file + summary) expanded. */
  defaultExpanded?: boolean
}): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const loadModules = useAppStore((s) => s.loadModules)
  const active = !['done', 'failed', 'cancelled'].includes(run.status)
  const doneSteps = run.steps.filter((s) => s.status === 'done' || s.status === 'failed').length
  const [showSteps, setShowSteps] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(defaultExpanded)
  const [revealError, setRevealError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteOutputFiles, setDeleteOutputFiles] = useState(false)

  const pct = run.steps.length > 0 ? Math.round((doneSteps / run.steps.length) * 100) : 0
  const outputFiles = run.outputFiles?.length
    ? run.outputFiles
    : run.outputFile
      ? [run.outputFile]
      : []
  const hasActions = Boolean(outputFiles.length > 0 || run.summary)
  const toggleActions = (): void => {
    if (hasActions) setActionsOpen((v) => !v)
  }

  async function deleteRun(): Promise<void> {
    if (!activeProject) return
    setDeleting(true)
    try {
      await window.ptnotes.modules.deleteRun(activeProject, run.runId, deleteOutputFiles)
      await loadModules(activeProject)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
      setDeleteOutputFiles(false)
    }
  }

  return (
    <div
      className={`module-card ${compact ? 'compact' : ''} ${hasActions && actionsOpen ? 'actions-open' : ''} ${hasActions ? 'actions-clickable' : ''}`}
      onClick={toggleActions}
      title={
        hasActions
          ? actionsOpen
            ? 'Click to collapse details'
            : 'Click to expand details'
          : undefined
      }
    >
      <div className="module-card-header">
        <span className="module-card-name" title={run.module.name}>
          🧩 {run.module.name}
        </span>
        <span className="module-card-status-area">
          <button
            className="module-card-history-btn"
            title="View module chat history"
            onClick={(e) => {
              e.stopPropagation()
              useAppStore.getState().setModuleHistoryRunId(run.runId)
            }}
          >
            <MdiIcon path={mdiChatProcessingOutline} size={16} />
          </button>
          {!active && ['failed', 'cancelled'].includes(run.status) && (
            <button
              className="module-card-retry-btn"
              title="Retry this module run"
              onClick={(e) => {
                e.stopPropagation()
                if (activeProject) void window.ptnotes.modules.retry(activeProject, run.runId)
              }}
            >
              <MdiIcon path={mdiRefresh} size={16} />
            </button>
          )}
          {!active && (
            <button
              className="module-card-delete-btn"
              title="Delete this run"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDelete(true)
              }}
            >
              ✕
            </button>
          )}
          <span className={`module-status module-${run.status}`}>{STATUS_LABELS[run.status]}</span>
        </span>
      </div>
      <div className="module-card-meta">
        <span className="module-card-updated" title={new Date(run.updatedAt).toLocaleString()}>
          Updated {formatUpdatedAt(run.updatedAt)}
        </span>
      </div>
      <div className="module-card-title" title={run.title}>
        {run.title}
      </div>
      {run.error && <div className="module-card-error">⚠ {run.error}</div>}
      {run.steps.length > 0 && (
        <div className="module-steps">
          <div className="module-steps-progress">
            <span className="module-steps-progress-label">
              {doneSteps}/{run.steps.length} steps
            </span>
            <div className="module-progress-bar">
              <div
                className={`module-progress-fill${run.status === 'done' ? ' done' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <button
              className={`module-step-toggle${showSteps ? ' open' : ''}`}
              title={showSteps ? 'Hide steps' : 'Show steps'}
              onClick={(e) => {
                e.stopPropagation()
                setShowSteps((v) => !v)
              }}
              aria-expanded={showSteps}
            >
              ▸
            </button>
          </div>
          <div className={`module-steps-collapse${showSteps ? ' open' : ''}`}>
            <ol className="module-steps-list">
              {run.steps.map((step, i) => (
                <li key={step.id} className={`module-step module-step-${step.status}`}>
                  <div className="module-step-head">
                    <span className="module-step-icon">{stepIcon(step)}</span>
                    <span className="module-step-name" title={step.name}>
                      {i + 1}. {step.name}
                    </span>
                  </div>
                  {step.detail && <div className="module-step-detail">{step.detail}</div>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      <div className={`module-card-collapse${actionsOpen ? ' open' : ''}`}>
        <div className="module-card-collapse-inner">
          <div className="module-card-actions">
            {outputFiles.map((file) => (
              <button
                key={file}
                className={`btn small ghost${revealError ? ' module-output-missing' : ''}`}
                title={revealError || 'Reveal output file'}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!activeProject) return
                  void window.ptnotes.modules.reveal(activeProject, run.runId, file).then((res) => {
                    setRevealError(res.ok ? '' : (res.error ?? 'File not found.'))
                  })
                }}
              >
                {revealError ? '⚠ ' : null}
                <MdiIcon path={fileTypeIcon(file)} size={16} />
                <span className="module-output-name">{file.split(/[\\/]/).pop()}</span>
              </button>
            ))}
            {active && (
              <button
                className="btn small danger"
                title="Stop this module"
                onClick={(e) => {
                  e.stopPropagation()
                  if (activeProject) void window.ptnotes.modules.stop(activeProject, run.runId)
                }}
              >
                ⏹ Stop
              </button>
            )}
          </div>
          {run.summary && <div className="module-card-summary">{run.summary}</div>}
        </div>
      </div>
      {confirmDelete && (
        <Modal title="Delete module run" onClose={() => setConfirmDelete(false)}>
          <p className="confirm-message">
            Delete this run ({run.module.name} — &quot;{run.title}&quot;)?
          </p>
          <label className="confirm-checkbox">
            <input
              type="checkbox"
              checked={deleteOutputFiles}
              onChange={(e) => setDeleteOutputFiles(e.target.checked)}
              disabled={outputFiles.length === 0}
            />
            Also delete the related output file{outputFiles.length === 1 ? '' : 's'}
            {outputFiles.length === 0 ? ' (no output files)' : ` (${outputFiles.length})`}
          </label>
          {outputFiles.length === 0 && <p className="hint">This run has no output files.</p>}
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => void deleteRun()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
