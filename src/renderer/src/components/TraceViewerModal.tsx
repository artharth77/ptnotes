import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'
import type { AiTraceFile } from '@shared/types'

interface TraceViewerTarget {
  kind: 'chat' | 'module'
  key: string
  title: string
}

/**
 * Read-only viewer for a raw AI trace file (chat session or module run). Shows the
 * full formatted JSON plus "Reveal in Finder" (needs the trace `path` returned by
 * the IPC read) and copy-to-clipboard.
 */
export function TraceViewerModal(): React.JSX.Element | null {
  const viewer = useAppStore((s) => s.traceViewer)
  const close = useAppStore((s) => s.closeTraceViewer)
  const activeProject = useAppStore((s) => s.activeProject)
  if (!viewer) return null
  return (
    <TraceViewerContent
      key={`${viewer.kind}:${viewer.key}`}
      viewer={viewer}
      project={activeProject ?? ''}
      onClose={close}
    />
  )
}

function TraceViewerContent({
  viewer,
  project,
  onClose
}: {
  viewer: TraceViewerTarget
  project: string
  onClose: () => void
}): React.JSX.Element {
  const [trace, setTrace] = useState<AiTraceFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load =
      viewer.kind === 'chat'
        ? window.ptnotes.chat.readTrace(project, viewer.key)
        : window.ptnotes.modules.readTrace(project, viewer.key)
    load
      .then((t) => {
        if (!cancelled) setTrace(t)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load trace')
      })
    return () => {
      cancelled = true
    }
  }, [viewer.kind, viewer.key, project])

  async function copy(): Promise<void> {
    if (!trace) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — ignore
    }
  }

  const entryCount = trace?.entries.length ?? 0

  return (
    <Modal title={`Raw AI Trace — ${viewer.title}`} onClose={onClose} className="trace-modal">
      {error && <div className="form-error">{error}</div>}
      {!error && !trace && <div className="trace-empty">Loading trace…</div>}
      {!error && trace && (
        <>
          <div className="trace-meta">
            <span>
              {trace.kind === 'chat' ? 'Chat session' : 'Module run'} · {entryCount} exchange
              {entryCount === 1 ? '' : 's'}
            </span>
            {trace.updatedAt > 0 && (
              <span>Updated {new Date(trace.updatedAt).toLocaleString()}</span>
            )}
          </div>
          {entryCount === 0 && (
            <div className="trace-empty">
              No AI exchanges recorded for this session yet. Send a message and reopen this view.
            </div>
          )}
          <div className="trace-actions">
            {trace.path && (
              <button
                className="btn small"
                title="Show the trace file in Finder"
                onClick={() => void window.ptnotes.files.reveal(trace.path!)}
              >
                Reveal in Finder
              </button>
            )}
            <button className="btn small" onClick={() => void copy()} disabled={entryCount === 0}>
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
          </div>
          <pre className="trace-json">{JSON.stringify(trace, null, 2)}</pre>
        </>
      )}
    </Modal>
  )
}
