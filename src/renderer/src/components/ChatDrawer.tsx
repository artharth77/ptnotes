import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../store/useAppStore'
import { MarkdownContent } from './MarkdownContent'
import type { ChatMessage, ChatSessionMeta, NoteMeta, Todo } from '@shared/types'

const NO_SESSIONS: ChatSessionMeta[] = []

function deriveLocalTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Untitled chat'
  const words = clean.split(' ')
  const sliced = words.slice(0, 8).join(' ')
  return sliced.length > 60 ? `${sliced.slice(0, 60).trimEnd()}…` : sliced
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface ContentPart {
  type: 'think' | 'text'
  content: string
}

function splitContent(content: string): ContentPart[] {
  const parts: ContentPart[] = []
  let index = 0
  while (index < content.length) {
    const open = content.indexOf('<think', index)
    if (open === -1) {
      const rest = content.slice(index)
      if (rest.trim()) parts.push({ type: 'text', content: rest })
      break
    }
    if (open > index) {
      const pre = content.slice(index, open)
      if (pre.trim()) parts.push({ type: 'text', content: pre })
    }
    const close = content.indexOf('</think>', open)
    if (close === -1) {
      const rest = content.slice(open).replace(/^<think\b[^>]*>\s*/, '')
      if (rest.trim()) parts.push({ type: 'think', content: rest.trim() })
      break
    }
    const inner = content.slice(open, close).replace(/^<think\b[^>]*>\s*/, '')
    if (inner.trim()) parts.push({ type: 'think', content: inner.trim() })
    index = close + '</think>'.length
  }
  return parts
}

function ThinkBox({ content }: { content: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={`think-box ${open ? 'open' : ''}`}>
      <button className="think-header" onClick={() => setOpen(!open)}>
        <span>💭 Thinking</span>
        <span className="think-toggle">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="think-body">{content}</div>}
    </div>
  )
}

const USER_MSG_COLLAPSE_LIMIT = 400

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

function UserBubble({ content }: { content: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const long = content.length > USER_MSG_COLLAPSE_LIMIT
  const shown = long && !expanded ? content.slice(0, USER_MSG_COLLAPSE_LIMIT) : content
  return (
    <div className="chat-msg-content user-bubble">
      {shown}
      {long && (
        <button className="chat-msg-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : '… Show more'}
        </button>
      )}
    </div>
  )
}

export function ChatDrawer({ width }: { width?: number }): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const activeNoteId = useAppStore((s) => s.activeNoteId)
  const notes = useAppStore((s) => s.notes)
  const todos = useAppStore((s) => s.todos)
  const projectFiles = useAppStore((s) => s.projectFiles)
  const refreshFiles = useAppStore((s) => s.refreshFiles)
  const messages = useAppStore((s) =>
    s.activeProject ? s.chatMessages[s.activeProject] : undefined
  )
  const chatBusy = useAppStore((s) => s.chatBusy)
  const chatStreamProject = useAppStore((s) => s.chatStreamProject)
  const appendChatMessage = useAppStore((s) => s.appendChatMessage)
  const setChatBusy = useAppStore((s) => s.setChatBusy)
  const setChatStreamProject = useAppStore((s) => s.setChatStreamProject)
  const sessions = useAppStore((s) =>
    s.activeProject ? (s.chatSessions[s.activeProject] ?? NO_SESSIONS) : NO_SESSIONS
  )
  const newChat = useAppStore((s) => s.newChat)
  const openChat = useAppStore((s) => s.openChat)
  const loadChatSessions = useAppStore((s) => s.loadChatSessions)
  const getActiveSessionId = useAppStore((s) => s.getActiveSessionId)
  const chatTitle = useAppStore((s) =>
    s.activeProject ? (s.chatTitles[s.activeProject] ?? '') : ''
  )
  const setChatTitle = useAppStore((s) => s.setChatTitle)
  const renameChat = useAppStore((s) => s.renameChat)
  const deleteChat = useAppStore((s) => s.deleteChat)
  const selectNote = useAppStore((s) => s.selectNote)
  const setTab = useAppStore((s) => s.setTab)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [historyPos, setHistoryPos] = useState<{ top: number; right: number } | null>(null)
  const historyBtnRef = useRef<HTMLButtonElement>(null)

  function closeHistory(): void {
    setHistoryOpen(false)
    setRenamingId(null)
    setRenameValue('')
    setHistoryPos(null)
  }

  function openHistory(): void {
    const el = historyBtnRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      setHistoryPos({ top: rect.bottom + 4, right: Math.max(0, window.innerWidth - rect.right) })
    }
    setHistoryOpen(true)
    if (activeProject) void loadChatSessions(activeProject)
  }

  const [input, setInput] = useState('')
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const [mention, setMention] = useState<{
    kind: 'note' | 'todo' | 'file'
    start: number
    query: string
  } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [dragActive, setDragActive] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevBusy = useRef(false)

  const list = useMemo(() => messages ?? [], [messages])

  const mentionItems = useMemo<(NoteMeta | Todo | string)[]>(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    if (mention.kind === 'todo') {
      return todos.filter((t) => t.text.toLowerCase().includes(q))
    }
    if (mention.kind === 'file') {
      return projectFiles.filter((f) => f.toLowerCase().includes(q))
    }
    const filtered = notes.filter((n) => n.name.toLowerCase().includes(q))
    const active = notes.find((n) => n.id === activeNoteId)
    if (mention.query === '' && active) {
      return [active, ...filtered.filter((n) => n.id !== active.id)]
    }
    return filtered
  }, [mention, notes, todos, projectFiles, activeNoteId])

  const mentionName = (item: NoteMeta | Todo | string): string =>
    typeof item === 'string' ? item : 'name' in item ? item.name : item.text

  function focusInput(): void {
    const el = textareaRef.current
    if (el && !el.disabled) el.focus()
  }

  useEffect(() => {
    focusInput()
  }, [])

  useEffect(() => {
    if (prevBusy.current && !chatBusy) {
      focusInput()
    }
    prevBusy.current = chatBusy
  }, [chatBusy])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [list, chatBusy])

  function updateMention(value: string, sel: number): void {
    const before = value.slice(0, sel)
    const at = before.lastIndexOf('@')
    const bang = before.lastIndexOf('!')
    const hash = before.lastIndexOf('#')
    const last = Math.max(at, bang, hash)
    if (last === -1) {
      setMention(null)
      return
    }
    const token = before.slice(last + 1)
    if (token.includes(' ')) {
      setMention(null)
      return
    }
    if (last === at) setMention({ kind: 'note', start: last, query: token })
    else if (last === bang) setMention({ kind: 'todo', start: last, query: token })
    else setMention({ kind: 'file', start: last, query: token })
    setMentionIndex(0)
  }

  function insertMention(name: string): void {
    if (!mention) return
    const before = input.slice(0, mention.start)
    const after = input.slice(mention.start + 1 + mention.query.length)
    const token =
      mention.kind === 'todo'
        ? `todo:${name} `
        : mention.kind === 'file'
          ? `file:${name} `
          : `note:${name} `
    setInput(`${before}${token}${after}`)
    setMention(null)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        const pos = before.length + token.length
        el.focus()
        el.setSelectionRange(pos, pos)
      }
    })
  }

  async function send(): Promise<void> {
    const project = activeProject
    const text = input.trim()
    if (!text || !project || chatBusy) return

    const isFirstMessage = list.length === 0
    const history = list
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text, toolCalls: [] }
    const assistantMsg: ChatMessage = { id: uid(), role: 'assistant', content: '', toolCalls: [] }
    appendChatMessage(project, userMsg)
    appendChatMessage(project, assistantMsg)
    if (isFirstMessage) {
      setChatTitle(project, deriveLocalTitle(text))
    }
    setInput('')
    setMention(null)
    setChatBusy(true)
    setChatStreamProject(project)
    try {
      await window.ptnotes.ai.send(project, text, history)
    } finally {
      setChatBusy(false)
      setChatStreamProject(null)
      await saveCurrent(project)
    }
    if (isFirstMessage) {
      void refineTitle(project, text)
    }
  }

  function onDragOver(e: React.DragEvent): void {
    if (chatBusy || !activeProject) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }

  function onDragLeave(e: React.DragEvent): void {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragActive(false)
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault()
    setDragActive(false)
    const project = activeProject
    if (chatBusy || !project) return
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length === 0) return
    void (async () => {
      const tokens: string[] = []
      for (const file of dropped) {
        const path = window.ptnotes.files.getPathForFile(file)
        if (!path) continue
        try {
          const savedPath = await window.ptnotes.files.copyToProject(project, path, file.name)
          const idx = Math.max(savedPath.lastIndexOf('/'), savedPath.lastIndexOf('\\'))
          const fileName = idx === -1 ? savedPath : savedPath.slice(idx + 1)
          tokens.push(`file:${fileName}`)
        } catch (err) {
          console.error('Skipped unsupported file:', file.name, err)
        }
      }
      if (tokens.length === 0) {
        window.alert(
          'No supported files added. PDFs and text files (markdown, JSON, logs, YAML, plain text) can be added.'
        )
        return
      }
      await refreshFiles()
      const insert = `${tokens.join(' ')} `
      setInput((prev) => (prev ? `${prev.trimEnd()} ${insert}` : insert))
      setMention(null)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) {
          el.focus()
          const pos = el.value.length
          el.setSelectionRange(pos, pos)
        }
      })
    })()
  }

  async function refineTitle(project: string, text: string): Promise<void> {
    const sessionId = getActiveSessionId(project)
    if (!sessionId) return
    let aiTitle = ''
    try {
      aiTitle = (await window.ptnotes.ai.generateTitle(project, text)).trim()
    } catch {
      aiTitle = ''
    }
    if (!aiTitle) return
    aiTitle = aiTitle.replace(/^["“”']+|["“”']+$/g, '').trim()
    if (!aiTitle) return
    setChatTitle(project, aiTitle)
    await renameChat(project, sessionId, aiTitle)
  }

  async function saveCurrent(project: string): Promise<void> {
    const sessionId = getActiveSessionId(project)
    if (!sessionId) return
    const msgs = useAppStore.getState().chatMessages[project]
    if (!msgs || msgs.length === 0) return
    await window.ptnotes.chat.write(project, {
      sessionId,
      title: useAppStore.getState().chatTitles[project] ?? undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: msgs
    })
    await loadChatSessions(project)
  }

  async function stop(): Promise<void> {
    const project = chatStreamProject ?? activeProject
    if (!project) return
    await window.ptnotes.ai.stop(project)
    setChatBusy(false)
    setChatStreamProject(null)
  }

  async function openNote(noteName: string): Promise<void> {
    if (!activeProject) return
    const note =
      notes.find((n) => n.name === noteName) ?? notes.find((n) => n.name.includes(noteName))
    if (!note) return
    await selectNote(note.id)
    setTab('notes')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (mentionItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        insertMention(mentionName(mentionItems[mentionIndex]!))
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <aside
      className="chat-drawer"
      style={width ? { width } : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="chat-header">
        <span className="chat-header-title" title={chatTitle || 'AI Assistant'}>
          {chatTitle || 'AI Assistant'}
        </span>
        <div className="chat-header-actions">
          <div className="chat-history-wrap">
            <button
              ref={historyBtnRef}
              className="btn small ghost"
              onClick={() => {
                if (historyOpen) {
                  closeHistory()
                } else {
                  openHistory()
                }
              }}
              title="Chat history"
            >
              🕘
            </button>
            {historyOpen &&
              createPortal(
                <>
                  <div className="chat-history-overlay" onClick={closeHistory} />
                  <div className="chat-history" style={historyPos ?? { top: 0, right: 0 }}>
                    {sessions.length === 0 && (
                      <div className="chat-history-empty">No past chats</div>
                    )}
                    {sessions.map((s) => (
                      <div key={s.sessionId} className="chat-history-item">
                        {renamingId === s.sessionId ? (
                          <div className="chat-history-rename">
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (activeProject) {
                                    void renameChat(activeProject, s.sessionId, renameValue.trim())
                                  }
                                  setRenamingId(null)
                                } else if (e.key === 'Escape') {
                                  setRenamingId(null)
                                }
                              }}
                            />
                            <button
                              className="btn small primary"
                              onClick={() => {
                                if (activeProject) {
                                  void renameChat(activeProject, s.sessionId, renameValue.trim())
                                }
                                setRenamingId(null)
                              }}
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <button
                            className="chat-history-open"
                            onClick={() => {
                              if (activeProject) void openChat(activeProject, s.sessionId)
                              closeHistory()
                            }}
                            title={`${s.title} · ${s.messageCount} message${s.messageCount === 1 ? '' : 's'} · ${new Date(s.createdAt).toLocaleString()}`}
                          >
                            <span className="chat-history-title">{s.title}</span>
                            <span className="chat-history-meta">
                              {s.messageCount} msg · {new Date(s.updatedAt).toLocaleDateString()}
                            </span>
                          </button>
                        )}
                        <button
                          className="chat-history-rename-btn"
                          title="Rename chat"
                          onClick={() => {
                            setRenamingId(s.sessionId)
                            setRenameValue(s.title)
                          }}
                        >
                          <span className="note-menu-icon">✎</span>
                        </button>
                        <button
                          className="chat-history-rename-btn"
                          title="Delete chat"
                          onClick={() => {
                            if (activeProject) void deleteChat(activeProject, s.sessionId)
                            if (renamingId === s.sessionId) setRenamingId(null)
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>
                </>,
                document.body
              )}
          </div>
          <button
            className="btn small ghost"
            onClick={() => {
              if (activeProject) void newChat(activeProject)
            }}
            disabled={chatBusy}
            title="Start a new chat"
          >
            + New Chat
          </button>
        </div>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {list.length === 0 && (
          <div className="chat-empty">
            <p>Ask me to create notes, manage todos, or research the web and save findings.</p>
            <p className="chat-empty-project">
              Working on: <strong>{activeProject}</strong>
            </p>
            <p className="chat-empty-hint">
              Type @ to reference a note, ! to reference a todo, # to reference a file. Drop PDFs or
              text files (markdown, JSON, logs, YAML, plain text) to add them to the project&apos;s
              files.
            </p>
          </div>
        )}
        {list.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div className="chat-msg-label">{m.role === 'user' ? 'You' : 'Assistant'}</div>
            {m.attachments && m.attachments.length > 0 && (
              <div className="chat-attachments">
                {(m.attachments ?? []).map((a) => (
                  <button
                    key={a.id}
                    className="chat-attachment"
                    title={a.savedPath}
                    onClick={() => void window.ptnotes.files.reveal(a.savedPath)}
                  >
                    <span className="chat-attachment-icon">📎</span>
                    <span className="chat-attachment-name">{a.name}</span>
                    {typeof a.pageCount === 'number' && (
                      <span className="chat-attachment-meta">{a.pageCount} pages</span>
                    )}
                    <span className="chat-attachment-mode">
                      {a.mode === 'extract' ? 'Extracted' : 'Uploaded'}
                    </span>
                    {a.truncated && (
                      <span
                        className="chat-attachment-warn"
                        title="PDF was truncated; the tail was cut off"
                      >
                        ⚠
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0 && (
              <div className="chat-tools">
                {(m.toolCalls ?? []).map((tc) => (
                  <div key={tc.id} className={`chat-tool ${tc.ok ? 'ok' : 'fail'}`}>
                    <div className="chat-tool-header">
                      <button
                        className="chat-tool-toggle-btn"
                        onClick={() =>
                          setExpandedTools((prev) => ({ ...prev, [tc.id]: !prev[tc.id] }))
                        }
                      >
                        <span className="chat-tool-name">
                          {tc.ok ? '🛠' : '⚠️'} {tc.name}
                        </span>
                        <span className="chat-tool-toggle">{expandedTools[tc.id] ? '▲' : '▼'}</span>
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
                            📄 {noteId}
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
                if (m.role === 'assistant' && !m.error) {
                  return (
                    <div key={i} className="chat-msg-content">
                      <MarkdownContent
                        content={part.content}
                        onOpenNote={(n) => void openNote(n)}
                      />
                    </div>
                  )
                }
                if (m.role === 'user') {
                  return <UserBubble key={i} content={part.content} />
                }
                return (
                  <div key={i} className={`chat-msg-content ${m.error ? 'error' : ''}`}>
                    {part.content}
                  </div>
                )
              })}
            {chatBusy &&
              m.id === list[list.length - 1]?.id &&
              m.role === 'assistant' &&
              !m.content && <span className="chat-typing">thinking…</span>}
          </div>
        ))}
        {chatBusy && (
          <div className="chat-status">
            <span className="chat-spinner" />
            <span>AI is thinking…</span>
          </div>
        )}
      </div>

      <div className="chat-input">
        {mentionItems.length > 0 && (
          <div className="mention-popup">
            {mentionItems.map((item, i) => (
              <div
                key={typeof item === 'string' ? item : 'name' in item ? item.name : item.text}
                className={`mention-item ${i === mentionIndex ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(mentionName(item))
                }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                <span className="mention-icon">
                  {mention?.kind === 'todo' ? '☑' : mention?.kind === 'file' ? '📎' : '📄'}
                </span>
                {mentionName(item)}
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          placeholder={
            activeProject ? 'Ask the assistant… (@ note, ! todo, # file)' : 'Select a project first'
          }
          disabled={!activeProject || chatBusy}
          rows={2}
          onChange={(e) => {
            setInput(e.target.value)
            updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }}
          onKeyDown={onKeyDown}
        />
        {chatBusy ? (
          <button className="btn danger" onClick={() => void stop()}>
            ⏹ Stop
          </button>
        ) : (
          <button
            className="btn primary"
            onClick={() => void send()}
            disabled={!input.trim() || !activeProject}
          >
            Send
          </button>
        )}
      </div>

      {dragActive && (
        <div className="chat-drop-overlay">
          <span className="chat-drop-icon">📄</span>
          <span>Drop PDF or text files to add to project files</span>
        </div>
      )}
    </aside>
  )
}
