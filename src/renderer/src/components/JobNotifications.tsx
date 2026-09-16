import { useCallback, useEffect, useState } from 'react'
import type { ScheduleJobEvent } from '@shared/types'

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

  const close = useCallback((id: string): void => {
    setItems((prev) => prev.filter((n) => n.id !== id))
  }, [])

  if (items.length === 0) return null
  return (
    <div className="job-notifications">
      {items.map((n) => (
        <div key={n.id} className="job-notification">
          <div className="job-notification-head">
            <span className="job-notification-title">{n.jobTitle}</span>
            <span className="job-notification-time">
              {new Date(n.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <button
              className="job-notification-close"
              aria-label="Close"
              onClick={() => close(n.id)}
            >
              ✕
            </button>
          </div>
          <div className="job-notification-body">{n.text}</div>
        </div>
      ))}
    </div>
  )
}
