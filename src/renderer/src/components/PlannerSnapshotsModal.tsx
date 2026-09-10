import { useEffect, useState } from 'react'
import { mdiRestore, mdiTagOutline, mdiTrashCanOutline } from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { friendlyError } from '../errors'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'
import type { Schedule, SnapshotMeta } from '@shared/types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB']
  let v = bytes
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function PlannerSnapshotsModal(): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const activeScheduleId = useAppStore((s) => s.activeScheduleId)
  const scheduleContent = useAppStore((s) => s.scheduleContent)
  const snapshots = useAppStore((s) => s.snapshotList)
  const refreshSnapshots = useAppStore((s) => s.refreshSnapshots)
  const restoreSnapshot = useAppStore((s) => s.restoreSnapshot)
  const setSnapshotTag = useAppStore((s) => s.setSnapshotTag)
  const deleteSnapshot = useAppStore((s) => s.deleteSnapshot)
  const setSnapshotsOpen = useAppStore((s) => s.setSnapshotsOpen)

  const [editingTagTs, setEditingTagTs] = useState<number | null>(null)
  const [tagValue, setTagValue] = useState('')
  const [previewTs, setPreviewTs] = useState<number | null>(null)
  const [previewSchedule, setPreviewSchedule] = useState<Schedule | null>(null)
  const [confirmDeleteTs, setConfirmDeleteTs] = useState<number | null>(null)
  const [busyTs, setBusyTs] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void refreshSnapshots()
  }, [refreshSnapshots])

  async function handleRestore(ts: number): Promise<void> {
    if (!activeProject || !activeScheduleId) return
    setBusyTs(ts)
    setError('')
    try {
      await restoreSnapshot(ts)
      setSnapshotsOpen(false)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusyTs(null)
    }
  }

  async function commitTag(ts: number): Promise<void> {
    setEditingTagTs(null)
    if (!activeProject || !activeScheduleId) return
    const value = tagValue.trim()
    const current = snapshots.find((s) => s.ts === ts)
    if ((current?.tag ?? null) === (value || null)) return
    setBusyTs(ts)
    setError('')
    try {
      await setSnapshotTag(ts, value || null)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusyTs(null)
    }
  }

  async function doDelete(): Promise<void> {
    if (!confirmDeleteTs) return
    setBusyTs(confirmDeleteTs)
    setError('')
    try {
      await deleteSnapshot(confirmDeleteTs)
      if (previewTs === confirmDeleteTs) {
        setPreviewTs(null)
        setPreviewSchedule(null)
      }
      setConfirmDeleteTs(null)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusyTs(null)
    }
  }

  async function togglePreview(ts: number): Promise<void> {
    if (previewTs === ts) {
      setPreviewTs(null)
      setPreviewSchedule(null)
      return
    }
    setPreviewTs(ts)
    setPreviewSchedule(null)
    if (!activeProject || !activeScheduleId) return
    try {
      setPreviewSchedule(await window.ptnotes.snapshots.read(activeProject, activeScheduleId, ts))
    } catch {
      setPreviewSchedule(null)
    }
  }

  return (
    <Modal
      title={`Snapshots — ${scheduleContent?.name ?? activeScheduleId ?? ''}`}
      className="snapshots-modal"
      onClose={() => setSnapshotsOpen(false)}
    >
      <p className="hint">
        Captured automatically on save (1/min for 10 min, 1/hour for 24 h, 1/day for 7 days, 1/week
        for 30 days). Tagged snapshots are kept until you delete them.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="snapshot-list">
        {snapshots.length === 0 && (
          <div className="list-empty">
            No snapshots yet — they appear once the schedule is saved.
          </div>
        )}
        {snapshots.map((snapshot) => (
          <SnapshotRow
            key={snapshot.ts}
            snapshot={snapshot}
            matchesLatest={snapshot.hash === snapshots[0].hash}
            expanded={previewTs === snapshot.ts}
            preview={previewTs === snapshot.ts ? previewSchedule : null}
            editingTag={editingTagTs === snapshot.ts}
            tagValue={tagValue}
            busy={busyTs === snapshot.ts}
            onTogglePreview={() => void togglePreview(snapshot.ts)}
            onStartTag={() => {
              setEditingTagTs(snapshot.ts)
              setTagValue(snapshot.tag ?? '')
            }}
            onTagValue={setTagValue}
            onCommitTag={() => void commitTag(snapshot.ts)}
            onCancelTag={() => setEditingTagTs(null)}
            onRestore={() => void handleRestore(snapshot.ts)}
            onRequestDelete={() => setConfirmDeleteTs(snapshot.ts)}
          />
        ))}
      </div>
      {confirmDeleteTs !== null && (
        <Modal title="Delete Snapshot" onClose={() => setConfirmDeleteTs(null)}>
          <p className="confirm-message">
            Delete this snapshot permanently? Its tag will be removed too.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmDeleteTs(null)}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => void doDelete()}>
              Delete
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

function SnapshotRow({
  snapshot,
  matchesLatest,
  expanded,
  preview,
  editingTag,
  tagValue,
  busy,
  onTogglePreview,
  onStartTag,
  onTagValue,
  onCommitTag,
  onCancelTag,
  onRestore,
  onRequestDelete
}: {
  snapshot: SnapshotMeta
  matchesLatest: boolean
  expanded: boolean
  preview: Schedule | null
  editingTag: boolean
  tagValue: string
  busy: boolean
  onTogglePreview: () => void
  onStartTag: () => void
  onTagValue: (v: string) => void
  onCommitTag: () => void
  onCancelTag: () => void
  onRestore: () => void
  onRequestDelete: () => void
}): React.JSX.Element {
  return (
    <div className={`snapshot-item${snapshot.tag ? ' tagged' : ''}${expanded ? ' expanded' : ''}`}>
      <div className="snapshot-row">
        <button className="snapshot-main" title="Toggle preview" onClick={onTogglePreview}>
          <span className="snapshot-time">{formatTime(snapshot.ts)}</span>
          {snapshot.tag && <span className="snapshot-tag">{snapshot.tag}</span>}
          <span className="snapshot-meta">
            {snapshot.hash.slice(0, 8)} · {formatBytes(snapshot.size)}
          </span>
        </button>
        <span className="snapshot-actions">
          {editingTag ? (
            <input
              className="text-field snapshot-tag-input"
              type="text"
              value={tagValue}
              autoFocus
              maxLength={64}
              placeholder="Tag"
              onChange={(e) => onTagValue(e.target.value)}
              onBlur={onCommitTag}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitTag()
                if (e.key === 'Escape') onCancelTag()
              }}
            />
          ) : (
            <button
              className={`icon-btn small${snapshot.tag ? ' active' : ''}`}
              title={snapshot.tag ? 'Edit tag' : 'Add tag'}
              onClick={onStartTag}
            >
              <MdiIcon path={mdiTagOutline} size={15} />
            </button>
          )}
          <button
            className="icon-btn small"
            title={matchesLatest ? 'Content matches the latest snapshot' : 'Restore this snapshot'}
            disabled={busy || matchesLatest}
            onClick={onRestore}
          >
            <MdiIcon path={mdiRestore} size={15} />
          </button>
          <button
            className="icon-btn small danger"
            title={matchesLatest ? 'Latest content — cannot be deleted' : 'Delete snapshot'}
            disabled={busy || matchesLatest}
            onClick={onRequestDelete}
          >
            <MdiIcon path={mdiTrashCanOutline} size={15} />
          </button>
        </span>
      </div>
      {editingTag && !snapshot.tag && (
        <p className="hint snapshot-tag-hint">
          Name this snapshot — tagged snapshots are never purged.
        </p>
      )}
      {expanded && (
        <div className="snapshot-preview">
          {!preview && <span className="snapshot-meta">Loading…</span>}
          {preview && (
            <>
              <div className="snapshot-preview-head">
                {preview.tasks.length} top-level task{preview.tasks.length === 1 ? '' : 's'} · saved
                as “{preview.name}”
              </div>
              <ul className="snapshot-preview-tasks">
                {preview.tasks.slice(0, 30).map((t) => (
                  <li key={t.id} className={`task-status-${t.status}`}>
                    {t.title}
                  </li>
                ))}
                {preview.tasks.length > 30 && <li className="snapshot-meta">…</li>}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
