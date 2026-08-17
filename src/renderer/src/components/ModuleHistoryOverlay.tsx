import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../store/useAppStore'
import { MarkdownContent } from './MarkdownContent'
import { MdiIcon } from './MdiIcon'
import { NOTE_LINK_ICON } from './contentIcons'
import { STATUS_LABELS } from './moduleStatus'
import { splitContent } from './chatContent'
import { ThinkBox, UserBubble } from './chatBubbles'
import type { ModuleChatMessage, ModuleRun } from '@shared/types'

function noteIdFromToolCall(name: string, result?: string): string | null {
  if (name !== 'create_note' && name !== 'update_note') return null
  if (!result) return null
  try {
    const data = JSON.parse(result) as { ok?: boolean; note?: string }
    return data.ok && data.note ? data.note : null
  } catch {
    return null
  }
}

function toolHeading(t: NonNullable<ModuleChatMessage['toolCalls']>[number]): string {
  const a = t.args as { steps?: unknown[]; index?: number; status?: string; id?: string }
  switch (t.name) {
    case 'set_n':
      return `Planned ${Array.isArray(a.steps) ? a.steps.length : 0} steps`
    case 'update_step':
      return `Step ${String(a.index ?? '?')}: ${a.status ?? '…'}`
    case 'start_module':
      return `Started module: ${a.id ?? '?'}`
    default:
      return t.name
  }
}

const NO_RUNS: ModuleRun[] = []
const HISTORY_WIDTH_DEFAULT = 400
const HISTORY_ANIM_MS = 250

export function ModuleHistoryOverlay(): React.JSX.Element | null {
  const activeProject = useAppStore((s) => s.activeProject)
  const runId = useAppStore((s) => s.moduleHistoryRunId)
  const setModuleHistoryRunId = useAppStore((s) => s.setModuleHistoryRunId)
  const [closingRunId, setClosingRunId] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    []
  )

  if (!activeProject || !runId) return null

  const close = (): void => {
    if (closingRunId === runId) return
    setClosingRunId(runId)
    timerRef.current = window.setTimeout(() => {
      setClosingRunId(null)
      setModuleHistoryRunId(null)
    }, HISTORY_ANIM_MS)
  }

  const closing = closingRunId === runId

  return (
    <ModuleHistoryPanel
      key={runId}
      project={activeProject}
      runId={runId}
      closing={closing}
      onClose={close}
    />
  )
}

function ModuleHistoryPanel({
  project,
  runId,
  closing,
  onClose
}: {
  project: string
  runId: string
  closing: boolean
  onClose: () => void
}): React.JSX.Element {
  const selectNote = useAppStore((s) => s.selectNote)
  const setTab = useAppStore((s) => s.setTab)
  const openSkillEditor = useAppStore((s) => s.openSkillEditor)
  const openTraceViewer = useAppStore((s) => s.openTraceViewer)
  const notes = useAppStore((s) => s.notes)
  const runs = useAppStore((s) => s.moduleRuns[project] ?? NO_RUNS)

  const [messages, setMessages] = useState<ModuleChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(HISTORY_WIDTH_DEFAULT)
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const [showSystem, setShowSystem] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const run = runs.find((r) => r.runId === runId)
  const active = run
    ? run.status === 'queued' || run.status === 'planning' || run.status === 'running'
    : false

  useEffect(() => {
    let cancelled = false
    window.ptnotes.modules
      .readChat(project, runId)
      .then((chat) => {
        if (cancelled) return
        const el = document.querySelector<HTMLElement>('.chat-col')
        if (el && el.clientWidth > 100) setWidth(el.clientWidth)
        setMessages(chat)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load module chat')
      })
    return () => {
      cancelled = true
    }
  }, [project, runId])

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      window.ptnotes.modules
        .readChat(project, runId)
        .then((chat) => {
          setMessages(chat)
          setError(null)
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load module chat'))
    }, 1500)
    return () => clearInterval(timer)
  }, [active, project, runId])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, runId])

  const runChatMessages = messages.filter((m) => m.role !== 'system')
  const systemText = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n')

  async function openNote(noteName: string): Promise<void> {
    const note =
      notes.find((n) => n.name === noteName) ?? notes.find((n) => n.name.includes(noteName))
    if (!note) return
    await selectNote(note.id)
    setTab('notes')
  }

  return createPortal(
    <div className={`module-history${closing ? ' closing' : ''}`}>
      <div className="module-history-backdrop" onClick={onClose} />
      <div className="module-history-panel" style={{ width }}>
        <div className="module-history-header">
          <div className="module-history-title">
            {run ? (
              <>
                <span className="module-card-name">🧩 {run.module.name}</span>
                <span className="module-history-run-title">{run.title}</span>
              </>
            ) : (
              <span className="module-card-name">🧩 Module run</span>
            )}
            {run && (
              <span className={`module-status module-${run.status}`}>
                {STATUS_LABELS[run.status]}
              </span>
            )}
          </div>
          <div className="module-history-header-actions">
            <button
              className="module-history-trace-btn"
              title="View raw AI trace"
              onClick={() =>
                openTraceViewer({ kind: 'module', key: runId, title: run?.title ?? runId })
              }
            >
              Raw trace
            </button>
            <button className="module-history-close" title="Close (Esc)" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        {run && run.steps && run.steps.length > 0 && (
          <div className="module-history-steps">
            {run.steps.map((s, i) => (
              <span
                key={i}
                className={`module-history-step module-step-${s.status}`}
                title={s.name}
              >
                {i + 1}
              </span>
            ))}
          </div>
        )}
        <div className="module-history-list" ref={listRef}>
          {error && <div className="chat-msg-content error">{error}</div>}
          {!error && messages.length === 0 && (
            <div className="module-history-empty">No conversation recorded yet for this run.</div>
          )}
          {systemText && (
            <div className="module-history-system">
              <button
                className="module-history-system-toggle"
                onClick={() => setShowSystem(!showSystem)}
              >
                <span>System prompt</span>
                <span className="think-toggle">{showSystem ? '▲' : '▼'}</span>
              </button>
              {showSystem && <pre className="module-history-system-body">{systemText}</pre>}
            </div>
          )}
          {runChatMessages.map((m) =>
            m.role === 'tool' ? null : m.role === 'user' ? (
              <div key={m.id} className="chat-msg user">
                <div className="chat-msg-label">You</div>
                <UserBubble content={m.content ?? ''} />
              </div>
            ) : (
              <div key={m.id} className="chat-msg assistant">
                <div className="chat-msg-label">Assistant</div>
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <div className="chat-tools">
                    {m.toolCalls.map((tc) => (
                      <div key={tc.id} className={`chat-tool ${tc.ok ? 'ok' : 'fail'}`}>
                        <div className="chat-tool-header">
                          <button
                            className="chat-tool-toggle-btn"
                            onClick={() =>
                              setExpandedTools((prev) => ({ ...prev, [tc.id]: !prev[tc.id] }))
                            }
                          >
                            <span className="chat-tool-name">
                              {tc.ok ? '🛠' : '⚠️'} {toolHeading(tc)}
                            </span>
                            <span className="chat-tool-toggle">
                              {expandedTools[tc.id] ? '▲' : '▼'}
                            </span>
                          </button>
                          {(() => {
                            const noteId = noteIdFromToolCall(tc.name, tc.result)
                            return noteId ? (
                              <button
                                className="chat-tool-note"
                                title={`Open note: ${noteId}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void openNote(noteId)
                                }}
                              >
                                <MdiIcon path={NOTE_LINK_ICON} size={16} /> {noteId}
                              </button>
                            ) : null
                          })()}
                        </div>
                        {expandedTools[tc.id] && tc.result && (
                          <pre className="chat-tool-result">{tc.result}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {m.content &&
                  splitContent(m.content).map((part, i) => {
                    if (part.type === 'think') {
                      return <ThinkBox key={i} content={part.content} />
                    }
                    return (
                      <div key={i} className="chat-msg-content">
                        <MarkdownContent
                          content={part.content}
                          onOpenNote={(n) => void openNote(n)}
                          onOpenSkill={(n) => openSkillEditor(n)}
                        />
                      </div>
                    )
                  })}
              </div>
            )
          )}
          {active && (
            <div className="chat-status">
              <span className="chat-spinner" />
              <span>Module is still running…</span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
