import { useCallback, useEffect, useRef, useState } from 'react'
import { mdiCheckBold, mdiClose, mdiContentCopy } from '@mdi/js'
import type { ScheduleJobEvent } from '@shared/types'
import { projectLabel } from '@shared/scheduleJobs'
import { MdiIcon } from './MdiIcon'
import { MarkdownContent } from './MarkdownContent'

interface NoticeItem {
  id: string
  jobTitle: string
  project: string
  text: string
  ts: number
}

/** Bottom-right stack of scheduled-job notifications (one block per run, close with x). */
export function JobNotifications(): React.JSX.Element | null {
  const [items, setItems] = useState<NoticeItem[]>([])

  useEffect(() => {
    return window.ptnotes.jobs.onEvent((evt: ScheduleJobEvent) => {
      if (evt.type !== 'notify') return
      setItems((prev) => [
        ...prev,
        {
          id: evt.runId,
          jobTitle: evt.jobTitle,
          project: evt.project,
          text: evt.text,
          ts: evt.ts
        }
      ])
    })
  }, [])

  const [leavingIds, setLeavingIds] = useState<string[]>([])

  const leavingRef = useRef<Set<string>>(new Set())

  const close = useCallback((id: string): void => {
    if (leavingRef.current.has(id)) return
    leavingRef.current.add(id)
    setLeavingIds((prev) => [...prev, id])
    window.setTimeout(() => {
      leavingRef.current.delete(id)
      setLeavingIds((prev) => prev.filter((l) => l !== id))
      setItems((prev) => prev.filter((n) => n.id !== id))
    }, 180)
  }, [])

  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copiedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const copy = useCallback((id: string, text: string): void => {
    void navigator.clipboard.writeText(text)
    setCopiedId(id)
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null
      setCopiedId(null)
    }, 2000)
  }, [])

  if (items.length === 0) return null
  return (
    <div className="job-notifications">
      {items.map((n) => (
        <div
          key={n.id}
          className={`job-notification ${leavingIds.includes(n.id) ? 'leaving' : ''}`}
        >
          <div className="job-notification-head">
            <span className="job-notification-title">{n.jobTitle}</span>
            <span className="job-notification-project">{projectLabel(n.project)}</span>
            <span className="job-notification-time">
              {new Date(n.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {n.text.trim() !== '' && (
              <button
                className="job-notification-close"
                aria-label="Copy"
                title="Copy to clipboard"
                onClick={() => copy(n.id, n.text)}
              >
                <MdiIcon path={copiedId === n.id ? mdiCheckBold : mdiContentCopy} size={16} />
              </button>
            )}
            <button
              className="job-notification-close"
              aria-label="Close"
              onClick={() => close(n.id)}
            >
              <MdiIcon path={mdiClose} size={16} />
            </button>
          </div>
          <div className="job-notification-body">
            <MarkdownContent content={n.text} />
          </div>
        </div>
      ))}
    </div>
  )
}
