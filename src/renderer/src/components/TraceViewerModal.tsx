import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'
import type { AiTraceEntry, AiTraceFile, AiTraceRole } from '@shared/types'
import { normalizeUsage } from '@shared/usage'
import { mdiCheck, mdiContentCopy } from '@mdi/js'

interface TraceViewerTarget {
  kind: 'chat' | 'module' | 'bots'
  key: string
  title: string
}

type TraceRow = 'prompts' | 'assistance' | 'tools'

const ROW_LABEL: Record<TraceRow, string> = {
  prompts: 'Prompts',
  assistance: 'Assistance',
  tools: 'Tools'
}

const ROWS: TraceRow[] = ['prompts', 'assistance', 'tools']

function rowFor(entry: AiTraceEntry): TraceRow {
  if (entry.role === 'tool') return 'tools'
  if (entry.role === 'assistant') return 'assistance'
  return 'prompts'
}

function roleLabel(role: AiTraceRole): string {
  return role.toUpperCase()
}

function previewFor(entry: AiTraceEntry): string {
  if (entry.role === 'tool') return entry.name ?? 'tool'
  return entry.content ?? ''
}

/** True for tool responses whose JSON result carries `ok: false`. */
function toolResultFailed(entry: AiTraceEntry): boolean {
  if (entry.role !== 'tool' || !entry.content) return false
  try {
    const parsed = JSON.parse(entry.content) as { ok?: unknown }
    return parsed.ok === false
  } catch {
    return false
  }
}

function formatMs(ms?: number): string {
  return ms == null ? '—' : `${ms}ms`
}

/**
 * Interactive browser for a raw AI trace file (chat session or module run).
 * Three panels: timeline (top), item list (left), and readable detail (right),
 * with click-sync selection across all three.
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
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  function selectEntry(seq: number): void {
    setSelectedSeq(seq)
    listRef.current
      ?.querySelector(`[data-seq="${seq}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    timelineRef.current
      ?.querySelector(`[data-seq="${seq}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }

  useEffect(() => {
    let cancelled = false
    const load =
      viewer.kind === 'chat'
        ? window.ptnotes.chat.readTrace(project, viewer.key)
        : viewer.kind === 'bots'
          ? window.ptnotes.bots.readTrace(project, viewer.key)
          : window.ptnotes.modules.readTrace(project, viewer.key)
    load
      .then((t) => {
        if (cancelled) return
        if (!t) {
          setError('No trace data found for this session.')
          return
        }
        setTrace(t)
        setSelectedSeq(t.entries.length > 0 ? t.entries[0].seq : null)
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

  const entries = trace?.entries ?? []
  const selected = entries.find((e) => e.seq === selectedSeq) ?? null

  return (
    <Modal title={`AI Trace — ${viewer.title}`} onClose={onClose} className="trace-modal">
      {error && <div className="form-error">{error}</div>}
      {!error && !trace && <div className="trace-empty">Loading trace…</div>}
      {!error && trace && (
        <>
          <div className="trace-meta">
            <span>
              {trace.kind === 'chat' ? 'Chat session' : 'Module run'} · {entries.length} exchange
              {entries.length === 1 ? '' : 's'}
              {trace.updatedAt > 0 && <> · Updated {new Date(trace.updatedAt).toLocaleString()}</>}
            </span>
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
              <button
                className="btn small"
                onClick={() => void copy()}
                disabled={entries.length === 0}
              >
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
            </div>
          </div>
          {entries.length === 0 && (
            <div className="trace-empty">
              No AI exchanges recorded for this session yet. Send a message and reopen this view.
            </div>
          )}
          {entries.length > 0 && (
            <div className="trace-panels">
              <TraceTimeline
                entries={entries}
                selectedSeq={selectedSeq}
                onSelect={selectEntry}
                scrollRef={timelineRef}
              />
              <div className="trace-middle">
                <TraceList
                  entries={entries}
                  selectedSeq={selectedSeq}
                  onSelect={selectEntry}
                  listRef={listRef}
                />
                <TraceDetail entry={selected} />
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

function TraceTimeline({
  entries,
  selectedSeq,
  onSelect,
  scrollRef
}: {
  entries: AiTraceEntry[]
  selectedSeq: number | null
  onSelect: (seq: number) => void
  scrollRef: React.Ref<HTMLDivElement>
}): React.JSX.Element {
  const { buckets, seqs } = useMemo(() => {
    const b: Record<TraceRow, AiTraceEntry[]> = { prompts: [], assistance: [], tools: [] }
    const s = new Set<number>()
    for (const e of entries) {
      b[rowFor(e)].push(e)
      s.add(e.seq)
    }
    return { buckets: b, seqs: Array.from(s).sort((a, z) => a - z) }
  }, [entries])

  return (
    <div className="trace-timeline">
      <div className="trace-timeline-inner">
        <div className="trace-timeline-labels">
          {ROWS.map((row) => (
            <div className="trace-timeline-label" key={row}>
              {ROW_LABEL[row]}
            </div>
          ))}
        </div>
        <div className="trace-timeline-scroll" ref={scrollRef}>
          <div className="trace-timeline-grid">
            {seqs.map((seq) => (
              <div className="trace-timeline-col" key={seq}>
                {ROWS.map((row) => {
                  const e = buckets[row].find((x) => x.seq === seq)
                  if (!e) return <div className="trace-timeline-slot" key={row} />
                  return (
                    <button
                      key={row}
                      data-seq={e.seq}
                      className={`trace-timeline-box trace-role-${e.role}${
                        selectedSeq === e.seq ? ' selected' : ''
                      }`}
                      title={previewFor(e)}
                      onClick={() => onSelect(e.seq)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function TraceList({
  entries,
  selectedSeq,
  onSelect,
  listRef
}: {
  entries: AiTraceEntry[]
  selectedSeq: number | null
  onSelect: (seq: number) => void
  listRef: React.Ref<HTMLDivElement>
}): React.JSX.Element {
  return (
    <div className="trace-list" ref={listRef}>
      {entries.map((e) => (
        <button
          key={e.seq}
          data-seq={e.seq}
          className={`trace-list-item${selectedSeq === e.seq ? ' selected' : ''}`}
          onClick={() => onSelect(e.seq)}
        >
          <span className={`trace-list-tag trace-role-${e.role}`}>{roleLabel(e.role)}</span>
          <span className={`trace-list-preview${toolResultFailed(e) ? ' error' : ''}`}>
            {previewFor(e) || '—'}
          </span>
          <span className="trace-list-time">{new Date(e.ts).toLocaleTimeString()}</span>
        </button>
      ))}
    </div>
  )
}

function TraceDetail({ entry }: { entry: AiTraceEntry | null }): React.JSX.Element {
  if (!entry) {
    return (
      <div className="trace-detail trace-detail-empty">Select an exchange to see its details.</div>
    )
  }
  const usage = normalizeUsage(entry.usage)
  return (
    <div className="trace-detail">
      <div className="trace-detail-header">
        <span className="trace-detail-title">
          <span className={`trace-list-tag trace-role-${entry.role}`}>{roleLabel(entry.role)}</span>
          {entry.role === 'assistant' && entry.model && (
            <span className="trace-detail-model">{entry.model}</span>
          )}
        </span>
        <span className="trace-detail-time">{new Date(entry.ts).toLocaleString()}</span>
      </div>

      {entry.role === 'tool' && (
        <>
          <Row k="Tool" v={entry.name ?? '—'} />
          <Row k="Call ID" v={entry.toolCallId ?? '—'} />
          <Row k="Duration" v={formatMs(entry.durationMs)} />
          {entry.content && (
            <Block label="Result" copyText={entry.content}>
              {entry.content}
            </Block>
          )}
        </>
      )}

      {entry.role === 'assistant' && (
        <>
          <Row k="Endpoint" v={endpointLabel(entry)} />
          <Row k="Duration" v={formatMs(entry.durationMs)} />
          <Row k="Finish reason" v={entry.finishReason ?? '—'} />
          {entry.reasoning && (
            <details className="trace-detail-collapse">
              <summary className="trace-summary-row">
                <span>Reasoning</span>
                <CopyIconButton text={entry.reasoning} title="Copy reasoning" />
              </summary>
              <div className="trace-detail-content trace-detail-mono">{entry.reasoning}</div>
            </details>
          )}
          {entry.content && (
            <Block label="Content" copyText={entry.content}>
              {entry.content}
            </Block>
          )}
          {entry.toolCalls && entry.toolCalls.length > 0 && (
            <Block label="Tool calls">
              {entry.toolCalls.map((tc) => (
                <div className="trace-toolcall" key={tc.id}>
                  <div className="trace-toolcall-head">
                    <span className="trace-toolcall-name">{tc.name}</span>
                    <CopyIconButton
                      text={JSON.stringify(tc.args, null, 2)}
                      title={`Copy ${tc.name} arguments`}
                    />
                  </div>
                  <pre className="trace-toolcall-args">{JSON.stringify(tc.args, null, 2)}</pre>
                </div>
              ))}
            </Block>
          )}
        </>
      )}

      {(entry.role === 'system' || entry.role === 'user') && (
        <>
          {entry.content && (
            <Block label="Content" copyText={entry.content}>
              {entry.content}
            </Block>
          )}
          {entry.file && <Row k="Attachment" v={entry.file.filename} />}
        </>
      )}

      {entry.error && <div className="trace-detail-error">{entry.error}</div>}
      {entry.usage !== undefined &&
        (usage ? (
          <>
            <Row k="Input tokens" v={usage.input.toLocaleString()} />
            <Row k="Output tokens" v={usage.output.toLocaleString()} />
            {usage.cached !== undefined && <Row k="Cache read" v={usage.cached.toLocaleString()} />}
          </>
        ) : (
          <Block label="Usage" mono>
            {JSON.stringify(entry.usage, null, 2)}
          </Block>
        ))}
    </div>
  )
}

function endpointLabel(entry: AiTraceEntry): string {
  const parts: string[] = []
  if (entry.baseUrl) parts.push(entry.baseUrl)
  if (entry.endpoint) parts.push(entry.endpoint)
  if (entry.model) parts.push(entry.model)
  return parts.join(' · ') || '—'
}

function Block({
  label,
  children,
  mono,
  copyText
}: {
  label: string
  children: ReactNode
  mono?: boolean
  copyText?: string
}): React.JSX.Element {
  return (
    <div className="trace-detail-block">
      <div className="trace-detail-label-row">
        <div className="trace-detail-label">{label}</div>
        {copyText != null && copyText !== '' && (
          <CopyIconButton text={copyText} title={`Copy ${label.toLowerCase()}`} />
        )}
      </div>
      <div className={`trace-detail-content${mono ? ' trace-detail-mono' : ''}`}>{children}</div>
    </div>
  )
}

function CopyIconButton({ text, title }: { text: string; title?: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — ignore
    }
  }
  return (
    <button
      className={`icon-btn trace-copy-btn${copied ? ' copied' : ''}`}
      title={copied ? 'Copied' : (title ?? 'Copy')}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void onCopy()
      }}
    >
      <MdiIcon path={copied ? mdiCheck : mdiContentCopy} size={13} />
    </button>
  )
}

function Row({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="trace-detail-row">
      <span className="trace-detail-key">{k}</span>
      <span className="trace-detail-val">{v}</span>
    </div>
  )
}
