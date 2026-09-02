import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  mdiChevronDown,
  mdiCogOutline,
  mdiFileOutline,
  mdiPencil,
  mdiPlus,
  mdiPuzzleOutline,
  mdiSend,
  mdiStopCircleOutline,
  mdiTimelineClockOutline,
  mdiTrashCanOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import {
  formatGroupDateLabel,
  formatGroupTimestamp,
  GROUP_CHAT_PAGE_SIZE,
  linkifyBotMentions,
  MAX_GROUP_BOTS,
  parseGroupAsk,
  resolveKanbanCardNames,
  splitMentionSegments
} from '@shared/bots'
import type { GroupChatMeta, GroupMessage } from '@shared/bots'
import type { AskAnswer, AskQuestion } from '@shared/types'
import { MarkdownContent } from './MarkdownContent'
import { USER_MSG_COLLAPSE_LIMIT } from './chatContent'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'
import { KANBAN_LINK_ICON, NOTE_LINK_ICON } from './contentIcons'

const BOT_HUES = [212, 152, 268, 24, 340, 188, 48, 300, 96, 0]

// Stable empty-array constants: zustand v5 selectors must never return a fresh
// reference per call, or useSyncExternalStore re-renders forever (blank screen).
const NO_GROUPS: GroupChatMeta[] = []
const NO_MESSAGES: GroupMessage[] = []
const NO_RUNS: never[] = []

function botColor(id: string | undefined): string {
  if (!id) return 'var(--accent, #4a7dff)'
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return `hsl(${BOT_HUES[hash % BOT_HUES.length]}, 58%, 46%)`
}

function botInitial(name: string): string {
  return (name.trim()[0] ?? 'B').toUpperCase()
}

/** A row in the group-chat mention popup: a group bot, a note, a kanban card or a project file. */
type MentionItem =
  | { kind: 'bot'; id: string; name: string; role?: string }
  | { kind: 'note'; id: string; name: string }
  | { kind: 'kanban'; id: string; name: string }
  | { kind: 'file'; id: string; name: string }

/** Right-drawer view: multi-bot group chat with a leader, @mentions and background tasks. */
export function GroupChatPanel(): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const botProfiles = useAppStore((s) => s.botProfiles)
  const groups = useAppStore((s) =>
    activeProject ? (s.botGroups[activeProject] ?? NO_GROUPS) : NO_GROUPS
  )
  const activeGroupId = useAppStore((s) =>
    activeProject ? (s.activeBotGroupId[activeProject] ?? null) : null
  )
  const activeGroup = groups.find((g) => g.groupId === activeGroupId) ?? null
  const messages = useAppStore((s) =>
    activeGroupId ? (s.botGroupMessages[activeGroupId] ?? NO_MESSAGES) : NO_MESSAGES
  )
  const windowMeta = useAppStore((s) =>
    activeGroupId ? s.botGroupWindowMeta[activeGroupId] : undefined
  )
  const hasMore = windowMeta?.hasMore ?? false
  const total = windowMeta?.total ?? messages.length
  const busy = useAppStore((s) =>
    activeGroupId ? (s.botGroupBusy[activeGroupId] ?? false) : false
  )
  const typing = useAppStore((s) => (activeGroupId ? (s.botTyping[activeGroupId] ?? null) : null))
  const botTaskRuns = useAppStore((s) =>
    activeProject ? (s.botTaskRuns[activeProject] ?? NO_RUNS) : NO_RUNS
  )
  const tasksBusy = botTaskRuns.some((r) => !['done', 'failed', 'cancelled'].includes(r.status))
  const loadBotProfiles = useAppStore((s) => s.loadBotProfiles)
  const loadBotGroups = useAppStore((s) => s.loadBotGroups)
  const sendBotGroupMessage = useAppStore((s) => s.sendBotGroupMessage)
  const loadOlderBotGroupMessages = useAppStore((s) => s.loadOlderBotGroupMessages)
  const stopBotGroup = useAppStore((s) => s.stopBotGroup)
  const setRightView = useAppStore((s) => s.setRightView)
  const openTraceViewer = useAppStore((s) => s.openTraceViewer)
  const notes = useAppStore((s) => s.notes)
  const schedules = useAppStore((s) => s.schedules)
  const kanban = useAppStore((s) => s.kanban)
  const projectFiles = useAppStore((s) => s.projectFiles)
  const refreshFiles = useAppStore((s) => s.refreshFiles)
  const selectNote = useAppStore((s) => s.selectNote)
  const selectSchedule = useAppStore((s) => s.selectSchedule)
  const setTab = useAppStore((s) => s.setTab)
  const setActiveKanbanCard = useAppStore((s) => s.setActiveKanbanCard)

  const [input, setInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [groupModal, setGroupModal] = useState<'create' | 'edit' | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const nearBottomRef = useRef(true)
  const loadingOlderRef = useRef(false)
  const prependAnchorRef = useRef<string | null>(null)
  const prevScrollRef = useRef<{ height: number; top: number } | null>(null)
  const prevGroupRef = useRef<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [mention, setMention] = useState<{
    kind: 'at' | 'kanban' | 'file'
    start: number
    query: string
  } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [showJumpDown, setShowJumpDown] = useState(false)

  useEffect(() => {
    if (activeProject) {
      void loadBotProfiles()
      void loadBotGroups(activeProject)
    }
  }, [activeProject, loadBotProfiles, loadBotGroups])

  // Scroll management: jump to bottom on group switch / first load, follow new
  // messages only while near the bottom, and keep the viewport anchored when
  // older messages are prepended by load-older.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const prevGroup = prevGroupRef.current
    prevGroupRef.current = activeGroupId
    if (prevGroup !== activeGroupId) {
      prependAnchorRef.current = null
      prevScrollRef.current = null
      nearBottomRef.current = true
      setShowJumpDown(false)
      el.scrollTop = el.scrollHeight
      return
    }
    const anchor = prependAnchorRef.current
    if (anchor !== null) {
      prependAnchorRef.current = null
      const prev = prevScrollRef.current
      prevScrollRef.current = null
      if (messages[0]?.id !== anchor && prev) {
        el.scrollTop = el.scrollHeight - prev.height + prev.top
        return
      }
    }
    if (nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages, activeGroupId])

  // Follow the typing indicator only while the user is at the bottom.
  useEffect(() => {
    if (!typing) return
    const el = scrollRef.current
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [typing])

  function triggerLoadOlder(): void {
    const el = scrollRef.current
    if (!el || !activeProject || !activeGroupId || !hasMore || loadingOlderRef.current) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    prependAnchorRef.current = messages[0]?.id ?? null
    prevScrollRef.current = { height: el.scrollHeight, top: el.scrollTop }
    void loadOlderBotGroupMessages(activeProject, activeGroupId)
      .catch(() => {
        prependAnchorRef.current = null
        prevScrollRef.current = null
      })
      .finally(() => {
        loadingOlderRef.current = false
        setLoadingOlder(false)
      })
  }

  function onScroll(e: React.UIEvent<HTMLDivElement>): void {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    nearBottomRef.current = atBottom
    setShowJumpDown(!atBottom)
    if (el.scrollTop < 80) triggerLoadOlder()
  }

  function jumpToBottom(): void {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    setShowJumpDown(false)
  }

  function focusInput(): void {
    const el = inputRef.current
    if (el && !el.disabled) el.focus()
  }

  // The input is disabled until a group is loaded (async on first open), so
  // focus it once it becomes enabled rather than only on mount.
  const inputReady = !!activeGroup && !busy
  const focusedRef = useRef(false)
  useEffect(() => {
    if (inputReady && !focusedRef.current) {
      focusedRef.current = true
      focusInput()
    }
  }, [inputReady])

  // The panel stays mounted while collapsed, so re-focus when it re-opens.
  const botsOpen = useAppStore((s) => s.botsOpen)
  const prevBotsOpen = useRef(false)
  useEffect(() => {
    if (botsOpen && !prevBotsOpen.current) focusInput()
    prevBotsOpen.current = botsOpen
  }, [botsOpen])

  const prevBusy = useRef(false)
  useEffect(() => {
    if (prevBusy.current && !busy) focusInput()
    prevBusy.current = busy
  }, [busy])

  const groupBots = useMemo(
    () =>
      (activeGroup?.botIds ?? [])
        .map((id) => botProfiles.find((b) => b.id === id))
        .filter((b): b is (typeof botProfiles)[number] => !!b),
    [activeGroup, botProfiles]
  )

  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!mention || !activeGroup) return []
    const q = mention.query.toLowerCase()
    if (mention.kind === 'kanban') {
      return (kanban?.cards ?? [])
        .filter((c) => c.title.toLowerCase().includes(q))
        .map((c) => ({ kind: 'kanban', id: c.id, name: c.title }))
    }
    if (mention.kind === 'file') {
      return projectFiles
        .filter((f) => f.toLowerCase().includes(q))
        .map((f) => ({ kind: 'file', id: f, name: f }))
    }
    const bots: MentionItem[] = groupBots
      .filter((b) => b.id.toLowerCase().includes(q) || b.name.toLowerCase().includes(q))
      .map((b) => ({ kind: 'bot', id: b.id, name: b.name, role: b.role }))
    const noteItems: MentionItem[] = notes
      .filter((n) => n.name.toLowerCase().includes(q))
      .map((n) => ({ kind: 'note', id: n.id, name: n.name }))
    return [...bots, ...noteItems]
  }, [mention, activeGroup, groupBots, notes, kanban, projectFiles])

  function updateMention(value: string, caret: number): void {
    const before = value.slice(0, caret)
    const last = Math.max(before.lastIndexOf('@'), before.lastIndexOf('!'), before.lastIndexOf('#'))
    if (last === -1 || !activeGroup) {
      setMention(null)
      return
    }
    const token = before.slice(last + 1)
    if (token.includes(' ')) {
      setMention(null)
      return
    }
    const ch = before[last]
    if (ch === '@') setMention({ kind: 'at', start: last, query: token })
    else if (ch === '!') setMention({ kind: 'kanban', start: last, query: token })
    else {
      if (!mention || mention.kind !== 'file' || mention.start !== last) {
        void refreshFiles()
      }
      setMention({ kind: 'file', start: last, query: token })
    }
    setMentionIndex(0)
  }

  function insertMention(item: MentionItem): void {
    if (!mention) return
    const before = input.slice(0, mention.start)
    const after = input.slice(mention.start + 1 + mention.query.length)
    const token =
      item.kind === 'bot'
        ? `@${item.id} `
        : item.kind === 'note'
          ? `note:${item.name} `
          : item.kind === 'kanban'
            ? `kanban:${item.id} `
            : `file:${item.name} `
    const next = `${before}${token}${after}`
    setInput(next)
    setMention(null)
    inputRef.current?.focus()
  }

  async function send(): Promise<void> {
    const text = input.trim()
    if (!text || busy || !activeGroup) return
    setInput('')
    setMention(null)
    await sendBotGroupMessage(text)
    inputRef.current?.focus()
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
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const item = mentionItems[mentionIndex] ?? mentionItems[0]
        if (item) insertMention(item)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  async function openNote(noteName: string): Promise<void> {
    if (!activeProject) return
    const note =
      notes.find((n) => n.id === noteName) ??
      notes.find((n) => n.name === noteName) ??
      notes.find((n) => n.name.includes(noteName))
    if (!note) return
    await selectNote(note.id)
    setTab('notes')
  }

  async function openSchedule(planName: string): Promise<void> {
    if (!activeProject) return
    const plan =
      schedules.find((s) => s.id === planName) ??
      schedules.find((s) => s.name === planName) ??
      schedules.find((s) => s.name.includes(planName))
    if (!plan) return
    await selectSchedule(plan.id)
    setTab('planner')
  }

  function openKanbanCard(ref: string): void {
    if (!activeProject || !kanban) return
    const q = ref.trim().toLowerCase()
    const card =
      kanban.cards.find((c) => c.id.toLowerCase() === q) ??
      kanban.cards.find((c) => c.title.toLowerCase() === q) ??
      kanban.cards.find((c) => {
        const t = c.title.toLowerCase()
        return t.includes(q) || q.includes(t)
      })
    if (!card) return
    setTab('kanban')
    setActiveKanbanCard(card.id)
  }

  function openFile(fileName: string): void {
    if (!activeProject) return
    void window.ptnotes.files.revealByName(activeProject, fileName)
  }

  return (
    <div className="chat-drawer gc-drawer">
      <div className="chat-header">
        <GroupSwitcher
          title={activeGroup?.title ?? 'Bot group chat'}
          open={historyOpen}
          setOpen={setHistoryOpen}
          groups={groups}
          activeId={activeGroupId}
          onNewGroup={() => setGroupModal('create')}
        />
        <div className="chat-header-actions">
          <button
            className="btn small ghost"
            onClick={() => setRightView('botTasks')}
            title={tasksBusy ? 'Bot background tasks — running…' : 'Bot background tasks'}
          >
            {tasksBusy ? (
              <span className="topbar-chat-spinner" />
            ) : (
              <MdiIcon path={mdiPuzzleOutline} size={16} />
            )}
            Tasks
          </button>
          {activeGroup && (
            <button
              className="btn small ghost"
              onClick={() =>
                openTraceViewer({
                  kind: 'bots',
                  key: activeGroup.groupId,
                  title: activeGroup.title
                })
              }
              title="View raw AI trace"
            >
              <MdiIcon path={mdiTimelineClockOutline} size={16} />
            </button>
          )}
          {activeGroup && (
            <button
              className="btn small ghost"
              onClick={() => setGroupModal('edit')}
              title="Group settings"
            >
              <MdiIcon path={mdiCogOutline} size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="chat-scroll gc-scroll" ref={scrollRef} onScroll={onScroll}>
        {!activeProject && <div className="list-empty">Open a project to use bot groups.</div>}
        {activeProject && groups.length === 0 && (
          <div className="list-empty">
            No group chats yet.
            <p className="module-hint">
              Create a bot in Settings ▸ Bots, then create a group and pick a leader.
            </p>
            <button className="btn primary" onClick={() => setGroupModal('create')}>
              + New group
            </button>
          </div>
        )}
        {activeProject && activeGroup && (
          <div className="gc-roster">
            {groupBots.map((b) => (
              <span key={b.id} className="gc-roster-chip" title={`${b.name} (@${b.id})`}>
                <span className="gc-avatar tiny" style={{ background: botColor(b.id) }}>
                  {botInitial(b.name)}
                </span>
                {b.name}
                {b.id === activeGroup.leaderBotId && <span className="gc-leader-star">★</span>}
              </span>
            ))}
          </div>
        )}
        {activeProject &&
          activeGroup &&
          messages.length > 0 &&
          (hasMore || loadingOlder ? (
            <button className="gc-load-older" disabled={loadingOlder} onClick={triggerLoadOlder}>
              {loadingOlder
                ? 'Loading earlier messages…'
                : `Load earlier messages (${total - messages.length} older)`}
            </button>
          ) : (
            total > GROUP_CHAT_PAGE_SIZE && (
              <div className="gc-history-start">Beginning of chat</div>
            )
          ))}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {(i === 0 ||
              new Date(messages[i - 1].ts).toDateString() !== new Date(m.ts).toDateString()) && (
              <div className="gc-date-divider">
                <span>{formatGroupDateLabel(m.ts)}</span>
              </div>
            )}
            <MessageRow
              msg={m}
              groupId={activeGroupId ?? ''}
              leaderId={activeGroup?.leaderBotId}
              bots={groupBots}
              kanbanCards={kanban?.cards ?? []}
              onOpenNote={(n) => void openNote(n)}
              onOpenPlan={(p) => void openSchedule(p)}
              onOpenKanban={(t) => openKanbanCard(t)}
              onOpenFile={openFile}
            />
          </Fragment>
        ))}
        {typing && (
          <div className="gc-typing">
            <span className="gc-avatar tiny gc-typing-avatar">{botInitial(typing)}</span>
            <span>
              <strong>{typing}</strong> is typing
              <span className="gc-dots">
                <i />
                <i />
                <i />
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="chat-input">
        {showJumpDown && (
          <button
            className="chat-jump-down"
            onClick={jumpToBottom}
            title="Jump to bottom"
            aria-label="Jump to bottom"
          >
            <MdiIcon path={mdiChevronDown} size={20} />
          </button>
        )}
        {mentionItems.length > 0 && (
          <div className="mention-popup">
            {mentionItems.map((item, i) => (
              <div
                key={`${item.kind}:${item.id}`}
                ref={(el) => {
                  if (el && i === mentionIndex) el.scrollIntoView({ block: 'nearest' })
                }}
                className={`mention-item ${i === mentionIndex ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(item)
                }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                {item.kind === 'bot' ? (
                  <>
                    <span className="gc-avatar tiny" style={{ background: botColor(item.id) }}>
                      {botInitial(item.name)}
                    </span>
                    <span className="mention-icon">@{item.id}</span>
                    {item.name}
                    {item.role ? <span className="command-badge">{item.role}</span> : null}
                  </>
                ) : (
                  <>
                    <span className="mention-icon">
                      <MdiIcon
                        path={
                          item.kind === 'kanban'
                            ? KANBAN_LINK_ICON
                            : item.kind === 'file'
                              ? mdiFileOutline
                              : NOTE_LINK_ICON
                        }
                        size={16}
                      />
                    </span>
                    {item.name}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={input}
          placeholder={
            activeGroup
              ? 'Message the group… (@ bot or note, ! kanban card, # file)'
              : 'Create a group chat to start'
          }
          disabled={!activeGroup || busy}
          rows={2}
          onChange={(e) => {
            setInput(e.target.value)
            updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <button className="btn danger" onClick={() => void stopBotGroup()}>
            <MdiIcon path={mdiStopCircleOutline} size={16} /> Stop
          </button>
        ) : (
          <button
            className="btn primary"
            onClick={() => void send()}
            disabled={!input.trim() || !activeGroup}
            title="Send"
          >
            <MdiIcon path={mdiSend} size={16} />
          </button>
        )}
      </div>

      {groupModal && activeProject && (
        <GroupModal
          mode={groupModal}
          project={activeProject}
          group={groupModal === 'edit' ? activeGroup : null}
          profiles={botProfiles}
          onClose={() => setGroupModal(null)}
        />
      )}
    </div>
  )
}

function MessageRow({
  msg,
  groupId,
  leaderId,
  bots,
  kanbanCards,
  onOpenNote,
  onOpenPlan,
  onOpenKanban,
  onOpenFile
}: {
  msg: GroupMessage
  groupId: string
  leaderId?: string
  bots: { id: string; name: string }[]
  kanbanCards: { id: string; title: string }[]
  onOpenNote?: (noteName: string) => void
  onOpenPlan?: (planName: string) => void
  onOpenKanban?: (cardTitle: string) => void
  onOpenFile?: (fileName: string) => void
}): React.JSX.Element {
  if (msg.senderKind === 'ask') {
    return <GroupAskBubble msg={msg} groupId={groupId} />
  }
  if (msg.senderKind === 'system') {
    return (
      <div className={`gc-system${msg.error ? ' error' : ''}`} title={formatGroupTimestamp(msg.ts)}>
        {msg.content}
      </div>
    )
  }
  if (msg.senderKind === 'user') {
    return (
      <div className="chat-msg user gc-msg">
        <div className="chat-msg-label gc-msg-meta">You · {formatGroupTimestamp(msg.ts)}</div>
        <GroupUserBubble content={msg.content} bots={bots} kanbanCards={kanbanCards} />
      </div>
    )
  }
  const isLeader = msg.botId === leaderId || msg.isLeader
  return (
    <div className="chat-msg assistant gc-msg">
      <div className="gc-msg-head">
        <span className="gc-avatar" style={{ background: botColor(msg.botId) }}>
          {botInitial(msg.senderName)}
        </span>
        <span className="gc-msg-name">{msg.senderName}</span>
        {msg.role && <span className="gc-role-badge">{msg.role}</span>}
        {isLeader && <span className="gc-leader-badge">leader</span>}
        <span className="gc-msg-time">{formatGroupTimestamp(msg.ts)}</span>
      </div>
      <div className={`chat-msg-content${msg.error ? ' error' : ''}`}>
        <MarkdownContent
          content={linkifyBotMentions(msg.content, bots)}
          mentionColor={mentionColor}
          onOpenNote={onOpenNote}
          onOpenPlan={onOpenPlan}
          onOpenKanban={onOpenKanban}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  )
}

/** Per-bot color for mention chips (module-level so MarkdownContent's memo stays stable). */
const mentionColor = (botId: string): string => botColor(botId)

/** User bubble with @mention chips — same collapse behavior as the 1:1 chat's UserBubble. */
function GroupUserBubble({
  content,
  bots,
  kanbanCards
}: {
  content: string
  bots: { id: string; name: string }[]
  kanbanCards: { id: string; title: string }[]
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const long = content.length > USER_MSG_COLLAPSE_LIMIT
  const shown = long && !expanded ? content.slice(0, USER_MSG_COLLAPSE_LIMIT) : content
  const segments = splitMentionSegments(resolveKanbanCardNames(shown, kanbanCards), bots)
  return (
    <div className="chat-msg-content user-bubble">
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          seg.text
        ) : (
          <span key={`${seg.botId}-${i}`} className="chat-mention" title={seg.botId}>
            @{seg.name}
          </span>
        )
      )}
      {long && (
        <button className="chat-msg-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : '… Show more'}
        </button>
      )}
    </div>
  )
}

/**
 * Interactive `ask_user` bubble posted by a bot task: user-style, right-aligned.
 * Pending → per-question radios/checkboxes/free text + Cancel/Confirm; answered →
 * read-only question→answer lines; cancelled → state only.
 */
function GroupAskBubble({
  msg,
  groupId
}: {
  msg: GroupMessage
  groupId: string
}): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const respondBotGroupAsk = useAppStore((s) => s.respondBotGroupAsk)
  const ask = useMemo(() => parseGroupAsk(msg.content), [msg.content])
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [freeText, setFreeText] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  if (!ask) {
    return (
      <div className="chat-msg user gc-msg">
        <div className="chat-msg-label gc-msg-meta">
          Question · {msg.senderName} · {formatGroupTimestamp(msg.ts)}
        </div>
        <div className="chat-msg-content user-bubble">{msg.content}</div>
      </div>
    )
  }

  const pending = ask.status === 'pending'
  const allAnswered = ask.questions.every((q) =>
    q.options?.length
      ? (selections[q.id]?.length ?? 0) > 0
      : (freeText[q.id] ?? '').trim().length > 0
  )

  const toggle = (q: AskQuestion, option: string): void => {
    setSelections((prev) => {
      const cur = prev[q.id] ?? []
      if (q.multiple) {
        return {
          ...prev,
          [q.id]: cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option]
        }
      }
      return { ...prev, [q.id]: [option] }
    })
  }

  const respond = async (cancelled: boolean): Promise<void> => {
    if (!activeProject || submitting) return
    setSubmitting(true)
    try {
      const answers: AskAnswer[] = cancelled
        ? []
        : ask.questions.map((q) => {
            const sel = selections[q.id]
            if (q.options?.length) {
              return sel && sel.length > 0
                ? { id: q.id, answer: sel.join(', '), ...(q.multiple ? { selections: sel } : {}) }
                : { id: q.id, answer: '' }
            }
            return { id: q.id, answer: freeText[q.id] ?? '' }
          })
      await respondBotGroupAsk(activeProject, groupId, msg.id, answers, cancelled)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="chat-msg user gc-msg">
      <div className="chat-msg-label gc-msg-meta">
        Question · {msg.senderName} · {formatGroupTimestamp(msg.ts)}
      </div>
      <div className="chat-msg-content user-bubble gc-ask">
        {ask.status === 'answered'
          ? ask.questions.map((q) => {
              const a = ask.answers?.find((x) => x.id === q.id)
              return (
                <div key={q.id} className="gc-ask-resolved">
                  <span className="gc-ask-q">{q.question}</span>
                  <strong className="gc-ask-a">{a?.answer || '—'}</strong>
                </div>
              )
            })
          : ask.questions.map((q) => (
              <div key={q.id} className="gc-ask-question">
                <div className="gc-ask-q">{q.question}</div>
                {pending &&
                  (q.options?.length ? (
                    <div className="gc-ask-options">
                      {q.options.map((option) => (
                        <label key={option} className="gc-ask-option">
                          <input
                            type={q.multiple ? 'checkbox' : 'radio'}
                            name={`${msg.id}-${q.id}`}
                            checked={selections[q.id]?.includes(option) ?? false}
                            onChange={() => toggle(q, option)}
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <input
                      className="gc-ask-input"
                      type={q.secret ? 'password' : 'text'}
                      value={freeText[q.id] ?? ''}
                      placeholder="Type your answer…"
                      onChange={(e) => setFreeText((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    />
                  ))}
              </div>
            ))}
        {pending && (
          <div className="gc-ask-actions">
            <button className="btn small" disabled={submitting} onClick={() => void respond(true)}>
              Cancel
            </button>
            <button
              className="btn small primary"
              disabled={submitting || !allAnswered}
              onClick={() => void respond(false)}
            >
              Confirm
            </button>
          </div>
        )}
        {!pending && (
          <div className={`gc-ask-state${ask.status === 'cancelled' ? ' cancelled' : ''}`}>
            {ask.status === 'cancelled' ? 'Cancelled' : 'Answered'}
          </div>
        )}
      </div>
    </div>
  )
}

/** Header dropdown: group title + chevron; lists group chats with a "New group chat" row on top. */ function GroupSwitcher({
  title,
  open,
  setOpen,
  groups,
  activeId,
  onNewGroup
}: {
  title: string
  open: boolean
  setOpen: (v: boolean) => void
  groups: GroupChatMeta[]
  activeId: string | null
  onNewGroup: () => void
}): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const openBotGroup = useAppStore((s) => s.openBotGroup)
  const renameBotGroupLocal = useAppStore((s) => s.updateBotGroup)
  const deleteBotGroupLocal = useAppStore((s) => s.deleteBotGroup)
  const openTraceViewer = useAppStore((s) => s.openTraceViewer)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // Keyboard focus: 0 = "New group chat" row, 1..n = groups[i-1].
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const focusIndexRef = useRef<number | null>(null)

  const close = useCallback((): void => {
    setOpen(false)
    setRenamingId(null)
    setRenameValue('')
    setDeletingId(null)
    focusIndexRef.current = null
    setFocusIndex(null)
  }, [setOpen])

  useEffect(() => {
    if (!open) return
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, left: Math.max(0, rect.left) })
    function onDown(e: MouseEvent): void {
      const target = e.target as HTMLElement
      if (btnRef.current?.contains(target)) return
      if (target.closest('.chat-history')) return
      if (target.closest('.modal-overlay')) return
      close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, setOpen, close])

  useEffect(() => {
    if (!open) return
    const count = groups.length + 1
    function onKey(e: KeyboardEvent): void {
      if (renamingId || deletingId) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const cur = focusIndexRef.current
        const next =
          cur == null
            ? e.key === 'ArrowDown'
              ? 0
              : count - 1
            : e.key === 'ArrowDown'
              ? (cur + 1) % count
              : (cur - 1 + count) % count
        focusIndexRef.current = next
        setFocusIndex(next)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (e.key === 'Enter') {
        const cur = focusIndexRef.current
        if (cur == null) return
        e.preventDefault()
        if (cur === 0) {
          close()
          onNewGroup()
          return
        }
        const g = groups[cur - 1]
        if (g && activeProject) void openBotGroup(activeProject, g.groupId)
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [
    open,
    close,
    renamingId,
    deletingId,
    groups,
    activeId,
    activeProject,
    onNewGroup,
    openBotGroup
  ])

  return (
    <>
      <button
        ref={btnRef}
        className="chat-header-title gc-switcher"
        onClick={() => {
          if (open) {
            close()
            return
          }
          const idx = groups.findIndex((g) => g.groupId === activeId)
          focusIndexRef.current = idx >= 0 ? idx + 1 : 0
          setFocusIndex(focusIndexRef.current)
          setOpen(true)
        }}
        title="Group chats"
      >
        <span className="gc-switcher-label">{title}</span>
        <MdiIcon path={mdiChevronDown} size={14} />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="chat-history-overlay" onClick={close} />
            <div className="chat-history" style={pos}>
              <button
                className={`chat-history-new${focusIndex === 0 ? ' focused' : ''}`}
                ref={(el) => {
                  if (el && focusIndex === 0) el.scrollIntoView({ block: 'nearest' })
                }}
                onMouseEnter={() => {
                  focusIndexRef.current = 0
                  setFocusIndex(0)
                }}
                onClick={() => {
                  close()
                  onNewGroup()
                }}
              >
                <MdiIcon path={mdiPlus} size={14} />
                New group chat
              </button>
              {groups.length === 0 && <div className="chat-history-empty">No group chats yet</div>}
              {groups.map((g, i) => (
                <div
                  key={g.groupId}
                  ref={(el) => {
                    if (el && focusIndex === i + 1) el.scrollIntoView({ block: 'nearest' })
                  }}
                  className={`chat-history-item${g.groupId === activeId ? ' active' : ''}${
                    focusIndex === i + 1 ? ' focused' : ''
                  }`}
                  onMouseEnter={() => {
                    focusIndexRef.current = i + 1
                    setFocusIndex(i + 1)
                  }}
                >
                  {renamingId === g.groupId ? (
                    <div className="chat-history-rename">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && activeProject) {
                            void renameBotGroupLocal(activeProject, g.groupId, {
                              title: renameValue.trim()
                            })
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
                            void renameBotGroupLocal(activeProject, g.groupId, {
                              title: renameValue.trim()
                            })
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
                        if (activeProject) void openBotGroup(activeProject, g.groupId)
                        close()
                      }}
                      title={`${g.title} · ${g.messageCount} message${g.messageCount === 1 ? '' : 's'}`}
                    >
                      <span className="chat-history-title">{g.title}</span>
                      <span className="chat-history-meta">
                        {g.messageCount} msg · {new Date(g.updatedAt).toLocaleDateString()}
                      </span>
                    </button>
                  )}
                  <button
                    className="chat-history-rename-btn"
                    title="Rename group"
                    onClick={() => {
                      setRenamingId(g.groupId)
                      setRenameValue(g.title)
                    }}
                  >
                    <MdiIcon path={mdiPencil} size={14} />
                  </button>
                  <button
                    className="chat-history-rename-btn"
                    title="View raw AI trace"
                    onClick={() =>
                      openTraceViewer({ kind: 'bots', key: g.groupId, title: g.title })
                    }
                  >
                    <MdiIcon path={mdiTimelineClockOutline} size={14} />
                  </button>
                  <button
                    className="chat-history-rename-btn"
                    title="Delete group"
                    onClick={() => setDeletingId(g.groupId)}
                  >
                    <MdiIcon path={mdiTrashCanOutline} size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>,
          document.body
        )}
      {deletingId && (
        <Modal title="Delete group chat" onClose={() => setDeletingId(null)}>
          <p className="confirm-message">
            Delete group chat &quot;
            {groups.find((g) => g.groupId === deletingId)?.title ?? deletingId}
            &quot;? Its messages and background task history are removed too. This cannot be undone.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeletingId(null)}>
              Cancel
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (activeProject) void deleteBotGroupLocal(activeProject, deletingId)
                setDeletingId(null)
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

function GroupModal({
  mode,
  project,
  group,
  profiles,
  onClose
}: {
  mode: 'create' | 'edit'
  project: string
  group: GroupChatMeta | null
  profiles: { id: string; name: string; role: string }[]
  onClose: () => void
}): React.JSX.Element {
  const createBotGroup = useAppStore((s) => s.createBotGroup)
  const updateBotGroup = useAppStore((s) => s.updateBotGroup)
  const deleteBotGroup = useAppStore((s) => s.deleteBotGroup)
  const clearBotGroupHistory = useAppStore((s) => s.clearBotGroupHistory)
  const openSettings = useAppStore((s) => s.openSettings)
  const [title, setTitle] = useState(group?.title ?? '')
  // Existing rosters can contain ids of since-deleted bots (deleteBot only scrubs open
  // project DBs); don't resurrect them — saving would re-persist the ghosts.
  const [botIds, setBotIds] = useState<string[]>(() =>
    (group?.botIds ?? []).filter((id) => profiles.some((p) => p.id === id))
  )
  const [leaderBotId, setLeaderBotId] = useState(group?.leaderBotId ?? '')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [saving, setSaving] = useState(false)

  function toggleBot(id: string): void {
    setBotIds((prev) => {
      if (!prev.includes(id) && prev.length >= MAX_GROUP_BOTS) return prev
      const next = prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]
      if (!next.includes(leaderBotId)) setLeaderBotId(next[0] ?? '')
      return next
    })
  }

  async function save(): Promise<void> {
    setError('')
    if (botIds.length === 0) {
      setError('Assign at least one bot.')
      return
    }
    if (botIds.length > MAX_GROUP_BOTS) {
      setError(`A group chat can have at most ${MAX_GROUP_BOTS} bots.`)
      return
    }
    if (!leaderBotId) {
      setError('Pick a group leader.')
      return
    }
    setSaving(true)
    try {
      if (mode === 'create') {
        await createBotGroup(project, {
          title: title.trim() || 'Group chat',
          botIds,
          leaderBotId
        })
      } else if (group) {
        await updateBotGroup(project, group.groupId, {
          title: title.trim() || 'Group chat',
          botIds,
          leaderBotId
        })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={mode === 'create' ? 'New group chat' : 'Group settings'} onClose={onClose}>
      <label className="form-label">Title</label>
      <input
        className="form-input"
        value={title}
        placeholder="Group chat title"
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="form-label">Bots</label>
      {profiles.length === 0 && (
        <div className="form-hint">
          No bots yet —{' '}
          <button className="inline-link" onClick={() => openSettings('bots')}>
            create one in Settings ▸ Bots
          </button>
          .
        </div>
      )}
      <div className="gc-bot-select">
        {profiles.map((b) => (
          <label key={b.id} className="gc-bot-option">
            <input
              type="checkbox"
              checked={botIds.includes(b.id)}
              disabled={botIds.length >= MAX_GROUP_BOTS && !botIds.includes(b.id)}
              onChange={() => toggleBot(b.id)}
            />
            <span className="gc-bot-option-name">{b.name}</span>
            {b.role && <span className="command-badge">{b.role}</span>}
          </label>
        ))}
      </div>
      {botIds.length >= MAX_GROUP_BOTS && (
        <div className="form-hint">
          Group is full — at most {MAX_GROUP_BOTS} bots per group chat.
        </div>
      )}
      <label className="form-label">Group leader</label>
      {botIds.length === 0 ? (
        <div className="form-hint">Select bots first — the leader acts on untagged messages.</div>
      ) : (
        <div className="gc-bot-select">
          {botIds.map((id) => {
            const b = profiles.find((p) => p.id === id)
            return (
              <label key={id} className="gc-bot-option">
                <input
                  type="radio"
                  name="gc-leader"
                  checked={leaderBotId === id}
                  onChange={() => setLeaderBotId(id)}
                />
                <span className="gc-bot-option-name">{b?.name ?? id}</span>
              </label>
            )
          })}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions gc-modal-actions">
        {mode === 'edit' && group && (
          <>
            <button
              className="btn danger"
              disabled={saving}
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true)
                  return
                }
                void (async () => {
                  await clearBotGroupHistory(project, group.groupId)
                  onClose()
                })()
              }}
            >
              {confirmClear ? 'Really clear?' : 'Clear history'}
            </button>
            <button
              className="btn danger"
              disabled={saving}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true)
                  return
                }
                void (async () => {
                  await deleteBotGroup(project, group.groupId)
                  onClose()
                })()
              }}
            >
              {confirmDelete ? 'Really delete?' : 'Delete group'}
            </button>
          </>
        )}
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
