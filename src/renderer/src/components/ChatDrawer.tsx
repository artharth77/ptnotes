import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  mdiChevronDown,
  mdiFileOutline,
  mdiHistory,
  mdiMenuUp,
  mdiPencil,
  mdiTimelineClockOutline,
  mdiTrashCanOutline,
  mdiTrayArrowDown,
  mdiTrayArrowUp,
  mdiTrayFull
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { MarkdownContent } from './MarkdownContent'
import { ModuleCard } from './ModuleCard'
import { MdiIcon } from './MdiIcon'
import { NOTE_LINK_ICON, TODO_LINK_ICON } from './contentIcons'
import { isReasoningOpen, splitContent } from './chatContent'
import { ThinkBox, UserBubble } from './chatBubbles'
import { builtinSlashCommands, builtinSlashNames } from '../commands'
import {
  MAX_COMMAND_ROWS,
  buildSkillCommandList,
  buildSkillMessage,
  extractSlashToken,
  filterSlashCommands
} from '@shared/slash'
import type { SlashCommand, SlashCommandContext } from '@shared/slash'
import type {
  AIConfig,
  ChatMessage,
  ChatSessionMeta,
  ModuleRun,
  NoteMeta,
  SkillList,
  Todo
} from '@shared/types'
import { formatTokens, sumUsage } from '@shared/usage'

const NO_SESSIONS: ChatSessionMeta[] = []
const NO_MODULE_RUNS: ModuleRun[] = []

const IS_MAC = window.electron.process.platform === 'darwin'

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

/** Compact Q&A summary for `ask_user` tool bubbles (question → answer lines). */
function AskToolSummary({
  args,
  result
}: {
  args: Record<string, unknown>
  result: string
}): React.JSX.Element {
  const questions = useMemo(() => {
    const raw = Array.isArray(args.questions) ? args.questions : []
    return raw
      .map((r) =>
        typeof r === 'object' && r !== null
          ? (r as { id?: unknown; question?: unknown })
          : ({} as { id?: unknown; question?: unknown })
      )
      .map((q) => ({ id: String(q.id ?? ''), question: String(q.question ?? '') }))
      .filter((q) => q.id && q.question)
  }, [args])
  const { cancelled, byId } = useMemo(() => {
    try {
      const data = JSON.parse(result) as {
        cancelled?: boolean
        answers?: { id?: string; answer?: string; selections?: string[] }[]
      }
      const map: Record<string, string> = {}
      for (const a of data.answers ?? []) {
        if (!a.id) continue
        map[a.id] =
          a.selections && a.selections.length > 0 ? a.selections.join(', ') : (a.answer ?? '')
      }
      return { cancelled: !!data.cancelled, byId: map }
    } catch {
      return { cancelled: false, byId: {} }
    }
  }, [result])
  if (questions.length === 0) {
    return <pre className="chat-tool-result">{result}</pre>
  }
  return (
    <div className="ask-tool-summary">
      {cancelled && <div className="ask-tool-cancelled">Cancelled by user</div>}
      {questions.map((q, i) => (
        <div key={q.id} className="ask-tool-item">
          <div className="ask-tool-qlabel">Question {i + 1}</div>
          <div className="ask-tool-qtext">{q.question}</div>
          <div className="ask-tool-atext">{byId[q.id] ?? (cancelled ? '—' : '…')}</div>
        </div>
      ))}
    </div>
  )
}

export function ChatDrawer({ width }: { width?: number }): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const activeNoteId = useAppStore((s) => s.activeNoteId)
  const activeScheduleId = useAppStore((s) => s.activeScheduleId)
  const notes = useAppStore((s) => s.notes)
  const todos = useAppStore((s) => s.todos)
  const projectFiles = useAppStore((s) => s.projectFiles)
  const refreshFiles = useAppStore((s) => s.refreshFiles)
  const messages = useAppStore((s) =>
    s.activeProject ? s.chatMessages[s.activeProject] : undefined
  )
  const chatBusy = useAppStore((s) => s.chatBusy)
  const chatStreamProject = useAppStore((s) => s.chatStreamProject)
  const chatWaitRuns = useAppStore((s) => s.chatWaitRuns)
  const appendChatMessage = useAppStore((s) => s.appendChatMessage)
  const setChatBusy = useAppStore((s) => s.setChatBusy)
  const setChatStreamProject = useAppStore((s) => s.setChatStreamProject)
  const setChatWaitRuns = useAppStore((s) => s.setChatWaitRuns)
  const sessions = useAppStore((s) =>
    s.activeProject ? (s.chatSessions[s.activeProject] ?? NO_SESSIONS) : NO_SESSIONS
  )
  const newChat = useAppStore((s) => s.newChat)
  const openChat = useAppStore((s) => s.openChat)
  const openSettings = useAppStore((s) => s.openSettings)
  const openSkillEditor = useAppStore((s) => s.openSkillEditor)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const loadChatSessions = useAppStore((s) => s.loadChatSessions)
  const getActiveSessionId = useAppStore((s) => s.getActiveSessionId)
  const chatTitle = useAppStore((s) =>
    s.activeProject ? (s.chatTitles[s.activeProject] ?? '') : ''
  )
  const setChatTitle = useAppStore((s) => s.setChatTitle)
  const renameChat = useAppStore((s) => s.renameChat)
  const deleteChat = useAppStore((s) => s.deleteChat)
  const openTraceViewer = useAppStore((s) => s.openTraceViewer)
  const selectNote = useAppStore((s) => s.selectNote)
  const selectSchedule = useAppStore((s) => s.selectSchedule)
  const schedules = useAppStore((s) => s.schedules)
  const moduleRuns = useAppStore((s) =>
    s.activeProject ? (s.moduleRuns[s.activeProject] ?? NO_MODULE_RUNS) : NO_MODULE_RUNS
  )
  const setTab = useAppStore((s) => s.setTab)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyIndex, setHistoryIndex] = useState(0)
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
    setHistoryIndex(0)
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
  const [skillList, setSkillList] = useState<SkillList | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [nav, setNav] = useState<{ entries: string[]; index: number } | null>(null)
  const [showJumpDown, setShowJumpDown] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevBusy = useRef(false)

  const [aiReady, setAiReady] = useState(false)
  const [activeModel, setActiveModel] = useState('')
  const [activeProfileName, setActiveProfileName] = useState('')
  const [activeProfileId, setActiveProfileId] = useState('')
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null)
  const [profileMenuPos, setProfileMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileNameBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    window.ptnotes.ai.getConfig().then((cfg) => {
      if (cancelled) return
      const local = /localhost|127\.0\.0\.1/.test(cfg.baseUrl || '')
      const key = (cfg.apiKey || '').trim()
      setAiReady(!!cfg.model.trim() && (!!key || !!local || !cfg.baseUrl.trim()))
    })
    window.ptnotes.ai.getProfiles().then((cfg) => {
      if (cancelled) return
      setAiConfig(cfg)
      setActiveProfileId(cfg.activeProfileId)
      const active = cfg.profiles.find((p) => p.id === cfg.activeProfileId)
      setActiveProfileName(active?.name ?? '')
      setActiveModel(active?.model ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [settingsOpen])

  const profiles = aiConfig?.profiles ?? []

  function openProfileMenu(): void {
    const el = profileNameBtnRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      const menuHeight = Math.min(
        aiConfig?.profiles.length ? aiConfig?.profiles.length * 55 : 40,
        280
      )
      setProfileMenuPos({
        top: Math.max(4, rect.top - menuHeight - 4),
        right: Math.max(0, window.innerWidth - rect.right)
      })
    }
    setProfileMenuOpen(true)
  }

  function closeProfileMenu(): void {
    setProfileMenuOpen(false)
  }

  async function switchProfile(id: string): Promise<void> {
    if (!aiConfig) return
    if (id === activeProfileId) {
      closeProfileMenu()
      return
    }
    closeProfileMenu()
    try {
      const saved = await window.ptnotes.ai.saveProfiles({ ...aiConfig, activeProfileId: id })
      setAiConfig(saved)
      setActiveProfileId(saved.activeProfileId)
      const active = saved.profiles.find((p) => p.id === saved.activeProfileId)
      setActiveProfileName(active?.name ?? '')
      setActiveModel(active?.model ?? '')
    } catch {
      // ignore switch failures
    }
  }

  const list = useMemo(() => messages ?? [], [messages])

  const usageTotal = useMemo(() => sumUsage(list), [list])

  const userHistory = useMemo(
    () =>
      list.filter((m) => m.role === 'user' && m.content.trim().length > 0).map((m) => m.content),
    [list]
  )

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

  const commands = useMemo<SlashCommand[]>(
    () =>
      activeProject
        ? [...builtinSlashCommands, ...buildSkillCommandList(skillList, builtinSlashNames)]
        : builtinSlashCommands,
    [skillList, activeProject]
  )

  const slashToken = useMemo(() => extractSlashToken(input), [input])

  const slashItems = useMemo<SlashCommand[]>(() => {
    if (slashToken === null || slashDismissed) return []
    return filterSlashCommands(commands, slashToken).slice(0, MAX_COMMAND_ROWS)
  }, [slashToken, commands, slashDismissed])

  function focusInput(): void {
    const el = textareaRef.current
    if (el && !el.disabled) el.focus()
  }

  useEffect(() => {
    if (!historyOpen) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        closeHistory()
        focusInput()
        return
      }
      if (renamingId !== null) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHistoryIndex((i) => Math.min(i + 1, Math.max(0, sessions.length - 1)))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHistoryIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' && sessions.length > 0) {
        e.preventDefault()
        const s = sessions[Math.min(historyIndex, sessions.length - 1)]
        if (s && activeProject) void openChat(activeProject, s.sessionId)
        closeHistory()
        focusInput()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [historyOpen, sessions, historyIndex, renamingId, activeProject, openChat])

  useEffect(() => {
    if (!historyOpen || sessions.length === 0) return
    const items = document.querySelectorAll('.chat-history-item')
    const active = items[Math.min(historyIndex, sessions.length - 1)]
    active?.scrollIntoView({ block: 'nearest' })
  }, [historyOpen, historyIndex, sessions.length])

  useEffect(() => {
    focusInput()
  }, [])

  const chatOpen = useAppStore((s) => s.chatOpen)
  const prevChatOpen = useRef(false)
  useEffect(() => {
    if (chatOpen && !prevChatOpen.current) focusInput()
    prevChatOpen.current = chatOpen
  }, [chatOpen])

  useEffect(() => {
    if (prevBusy.current && !chatBusy) {
      focusInput()
      if (activeProject) {
        window.ptnotes.skills
          .list(activeProject)
          .then(setSkillList)
          .catch(() => {})
      }
    }
    prevBusy.current = chatBusy
  }, [chatBusy, activeProject])

  useEffect(() => {
    if (!activeProject) return
    let cancelled = false
    window.ptnotes.skills
      .list(activeProject)
      .then((list) => {
        if (!cancelled) setSkillList(list)
      })
      .catch(() => {
        if (!cancelled) setSkillList(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeProject, settingsOpen])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [list, chatBusy])

  function onScroll(e: React.UIEvent<HTMLDivElement>): void {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setShowJumpDown(!atBottom)
  }

  function jumpToBottom(): void {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    setShowJumpDown(false)
  }

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
    else {
      if (!mention || mention.kind !== 'file' || mention.start !== last) {
        void refreshFiles()
      }
      setMention({ kind: 'file', start: last, query: token })
    }
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

  function commandFromInput(value: string): SlashCommand | undefined {
    if (!value.startsWith('/')) return undefined
    const first = value.slice(1).split(/\s+/)[0]
    if (!first) return undefined
    return commands.find((c) => c.name === first)
  }

  function runCommand(cmd: SlashCommand, args: string): void {
    setInput('')
    setMention(null)
    setSlashDismissed(true)
    if (cmd.action) {
      const ctx: SlashCommandContext = {
        project: activeProject,
        newChat: (p: string) => newChat(p),
        openAiSettings: () => openSettings('ai')
      }
      void cmd.action(ctx)
      return
    }
    const message = buildSkillMessage(cmd.name, cmd.scope ?? 'project', args)
    void send(message)
  }

  function acceptSlash(run: boolean, item?: SlashCommand): void {
    const cmd = item ?? slashItems[slashIndex] ?? slashItems[0]
    if (!cmd) return
    const nextInput = `/${cmd.name}${run ? '' : ' '}`
    setInput(nextInput)
    setSlashDismissed(true)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        const pos = nextInput.length
        el.setSelectionRange(pos, pos)
      }
    })
    if (run) {
      runCommand(cmd, '')
    }
  }

  async function send(textOverride?: string): Promise<void> {
    const project = activeProject
    const text = (textOverride ?? input).trim()
    if (!text || !project || chatBusy) return

    const isFirstMessage = list.length === 0
    const history = list
    const sessionId = getActiveSessionId(project)
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text, toolCalls: [] }
    const assistantMsg: ChatMessage = { id: uid(), role: 'assistant', content: '', toolCalls: [] }
    appendChatMessage(project, userMsg)
    appendChatMessage(project, assistantMsg)
    if (isFirstMessage) {
      setChatTitle(project, deriveLocalTitle(text))
    }
    setInput('')
    setNav(null)
    setMention(null)
    setChatBusy(true)
    setChatStreamProject(project)
    setChatWaitRuns([])
    try {
      await window.ptnotes.ai.send(
        project,
        sessionId ?? '',
        text,
        history,
        activeNoteId,
        activeScheduleId
      )
    } finally {
      setChatBusy(false)
      setChatStreamProject(null)
      setChatWaitRuns([])
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
          'No supported files added. PDFs, Excel (.xlsx/.xlsm) and text files (markdown, JSON, logs, YAML, plain text) can be added.'
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
      aiTitle = (await window.ptnotes.ai.generateTitle(project, sessionId, text)).trim()
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
    setChatWaitRuns([])
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

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    const mod = (IS_MAC ? e.metaKey : e.ctrlKey) && e.shiftKey
    if (mod && !e.altKey) {
      const key = e.key.toLowerCase()
      if (key === 'n') {
        e.preventDefault()
        closeHistory()
        if (!chatBusy && activeProject) {
          void (async () => {
            await newChat(activeProject)
            focusInput()
          })()
        }
        return
      }
      if (key === 'h') {
        e.preventDefault()
        if (historyOpen) {
          closeHistory()
          focusInput()
        } else {
          openHistory()
          textareaRef.current?.blur()
        }
        return
      }
    }
    if (historyOpen) return
    if (e.ctrlKey && !e.metaKey && !e.altKey) {
      const el = scrollRef.current
      if (e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault()
        if (!el) return
        if (e.key === 'Home') {
          el.scrollTo({ top: 0, behavior: 'auto' })
        } else if (e.key === 'End') {
          el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
        } else {
          const delta = el.clientHeight * 0.8
          el.scrollTo({
            top: e.key === 'PageUp' ? el.scrollTop - delta : el.scrollTop + delta,
            behavior: 'auto'
          })
        }
        return
      }
    }
    if (slashItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => (i + 1) % slashItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => (i - 1 + slashItems.length) % slashItems.length)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        acceptSlash(false)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        acceptSlash(true)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashDismissed(true)
        return
      }
    }
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
        insertMention(mentionName(mentionItems[mentionIndex]!))
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    if (e.key === 'ArrowUp') {
      if (userHistory.length === 0) return
      e.preventDefault()
      if (!nav) {
        const entries = [...userHistory]
        setNav({ entries, index: entries.length - 1 })
        setInput(entries[entries.length - 1]!)
      } else if (nav.index > 0) {
        setNav({ ...nav, index: nav.index - 1 })
        setInput(nav.entries[nav.index - 1]!)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      if (!nav) return
      e.preventDefault()
      if (nav.index < nav.entries.length - 1) {
        setNav({ ...nav, index: nav.index + 1 })
        setInput(nav.entries[nav.index + 1]!)
      } else {
        setNav(null)
        setInput('')
      }
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const cmd = commandFromInput(input)
      if (cmd) {
        const first = input.slice(1).split(/\s+/)[0]
        const args = input.slice(1 + first.length).trim()
        runCommand(cmd, args)
      } else {
        void send()
      }
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
              <MdiIcon path={mdiHistory} size={16} />
            </button>
            {historyOpen &&
              createPortal(
                <>
                  <div className="chat-history-overlay" onClick={closeHistory} />
                  <div className="chat-history" style={historyPos ?? { top: 0, right: 0 }}>
                    {sessions.length === 0 && (
                      <div className="chat-history-empty">No past chats</div>
                    )}
                    {sessions.map((s, index) => (
                      <div
                        key={s.sessionId}
                        className={
                          index === Math.min(historyIndex, sessions.length - 1)
                            ? 'chat-history-item active'
                            : 'chat-history-item'
                        }
                        onMouseMove={() => setHistoryIndex(index)}
                      >
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
                              focusInput()
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
                          <span className="note-menu-icon">
                            <MdiIcon path={mdiPencil} size={14} />
                          </span>
                        </button>
                        <button
                          className="chat-history-rename-btn"
                          title="View raw AI trace"
                          onClick={() =>
                            openTraceViewer({ kind: 'chat', key: s.sessionId, title: s.title })
                          }
                        >
                          <MdiIcon path={mdiTimelineClockOutline} size={14} />
                        </button>
                        <button
                          className="chat-history-rename-btn"
                          title="Delete chat"
                          onClick={() => {
                            if (activeProject) void deleteChat(activeProject, s.sessionId)
                            if (renamingId === s.sessionId) setRenamingId(null)
                          }}
                        >
                          <MdiIcon path={mdiTrashCanOutline} size={14} />
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
              if (!activeProject) return
              const id = getActiveSessionId(activeProject)
              if (id) openTraceViewer({ kind: 'chat', key: id, title: chatTitle || 'AI Assistant' })
            }}
            title="View AI trace"
          >
            <MdiIcon path={mdiTimelineClockOutline} size={16} />
          </button>
          <button
            className="btn small ghost"
            onClick={async () => {
              if (!activeProject) return
              await newChat(activeProject)
              focusInput()
            }}
            disabled={chatBusy}
            title="Start a new chat"
          >
            + New Chat
          </button>
        </div>
      </div>

      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        {!aiReady && (
          <div className="chat-ai-hint">
            <div className="chat-ai-hint-title">AI not configured</div>
            <p className="chat-ai-hint-text">
              Set up an AI provider in Settings to use the chat assistant.
            </p>
            <button className="btn small primary" onClick={() => openSettings('ai')}>
              AI Settings
            </button>
          </div>
        )}
        {list.length === 0 && (
          <div className="chat-empty">
            <p>Ask me to create notes, manage todos, or research the web and save findings.</p>
            <p className="chat-empty-project">
              Working on: <strong>{activeProject}</strong>
            </p>
            <p className="chat-empty-hint">
              Type / for commands and skills, @ to reference a note, ! to reference a todo, # to
              reference a file. Drop PDFs, Excel (.xlsx/.xlsm) or text files (markdown, JSON, logs,
              YAML, plain text) to add them to the project&apos;s files.
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
            {m.content &&
              splitContent(m.content)
                .filter((part) => part.type === 'think')
                .map((part, i) => {
                  const streaming =
                    chatBusy && m.id === list[list.length - 1]?.id && isReasoningOpen(m.content)
                  return <ThinkBox key={i} content={part.content} streaming={streaming} />
                })}
            {m.content &&
              splitContent(m.content)
                .filter((part) => part.type === 'text')
                .map((part, i) => {
                  if (m.role === 'assistant' && !m.error) {
                    return (
                      <div key={i} className="chat-msg-content">
                        <MarkdownContent
                          content={part.content}
                          enableImageZoom
                          onOpenNote={(n) => void openNote(n)}
                          onOpenSkill={(n) => openSkillEditor(n)}
                          onOpenPlan={(n) => void openSchedule(n)}
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
                            <MdiIcon path={NOTE_LINK_ICON} size={16} /> {noteId}
                          </button>
                        ) : null
                      })()}
                    </div>
                    {expandedTools[tc.id] &&
                      tc.result &&
                      (tc.name === 'ask_user' ? (
                        <AskToolSummary args={tc.args} result={tc.result} />
                      ) : (
                        <pre className="chat-tool-result">{tc.result}</pre>
                      ))}
                    {tc.name === 'start_module' &&
                      (() => {
                        let runId = ''
                        try {
                          runId = (JSON.parse(tc.result ?? '{}') as { runId?: string }).runId ?? ''
                        } catch {
                          /* unparseable start_module result */
                        }
                        const run = runId ? moduleRuns.find((r) => r.runId === runId) : undefined
                        return run ? <ModuleCard run={run} compact defaultExpanded /> : null
                      })()}
                  </div>
                ))}
              </div>
            )}
            {chatBusy &&
              m.id === list[list.length - 1]?.id &&
              m.role === 'assistant' &&
              !m.content && <span className="chat-typing">thinking…</span>}
          </div>
        ))}
        {chatBusy && (
          <div className="chat-status">
            <span className="chat-spinner" />
            {chatWaitRuns.length > 0 ? (
              <span>
                Waiting for {chatWaitRuns.length} module run{chatWaitRuns.length > 1 ? 's' : ''}…
              </span>
            ) : (
              <span>AI is thinking…</span>
            )}
          </div>
        )}
      </div>

      {(usageTotal || activeModel || activeProfileName) && (
        <div className="chat-statusbar">
          {(activeModel || activeProfileName) && (
            <span className="chat-statusbar-model">
              <button
                type="button"
                className="chat-statusbar-name"
                ref={profileNameBtnRef}
                title="Switch profile"
                aria-label="Switch profile"
                onClick={openProfileMenu}
              >
                <span className="chat-statusbar-name-text">
                  {activeModel ? activeModel : '---'}
                </span>
              </button>
              <button
                type="button"
                className="chat-statusbar-switch"
                title="Switch profile"
                aria-label="Switch profile"
                onClick={openProfileMenu}
              >
                <MdiIcon path={mdiMenuUp} size={14} />
              </button>
            </span>
          )}
          {usageTotal && (
            <>
              <span className="chat-statusbar-usage" title="Total input tokens for this chat">
                <MdiIcon path={mdiTrayArrowDown} size={14} />
                {formatTokens(usageTotal.input)}
              </span>
              <span className="chat-statusbar-usage" title="Total output tokens for this chat">
                <MdiIcon path={mdiTrayArrowUp} size={14} />
                {formatTokens(usageTotal.output)}
              </span>
              {usageTotal.cached !== undefined && (
                <span
                  className="chat-statusbar-usage"
                  title="Total cached input tokens for this chat"
                >
                  <MdiIcon path={mdiTrayFull} size={14} />
                  {formatTokens(usageTotal.cached)}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {profileMenuOpen &&
        createPortal(
          <>
            <div className="chat-history-overlay" onClick={closeProfileMenu} />
            <div className="chat-profile-menu" style={profileMenuPos ?? { top: 0, right: 0 }}>
              {profiles.length === 0 && <div className="chat-profile-empty">No profiles</div>}
              {profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={
                    p.id === activeProfileId ? 'chat-profile-item active' : 'chat-profile-item'
                  }
                  onClick={() => void switchProfile(p.id)}
                >
                  <span className="chat-profile-item-name">{p.name}</span>
                  <span className="chat-profile-item-model">{p.model}</span>
                </button>
              ))}
            </div>
          </>,
          document.body
        )}

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
        {slashItems.length > 0 && (
          <div className="command-popup">
            {slashItems.map((c, i) => (
              <div
                key={c.name}
                className={`command-item ${i === slashIndex ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setSlashIndex(i)
                  acceptSlash(true, c)
                }}
                onMouseEnter={() => setSlashIndex(i)}
              >
                <span className="command-name">/{c.name}</span>
                {c.scope && (
                  <span className="command-badge">
                    {c.scope === 'builtin' ? 'Build-in' : c.scope}
                  </span>
                )}
                <span className="command-desc">{c.description}</span>
              </div>
            ))}
          </div>
        )}
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
                  <MdiIcon
                    path={
                      mention?.kind === 'todo'
                        ? TODO_LINK_ICON
                        : mention?.kind === 'file'
                          ? mdiFileOutline
                          : NOTE_LINK_ICON
                    }
                    size={16}
                  />
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
            const value = e.target.value
            setInput(value)
            setNav(null)
            setSlashDismissed(false)
            if (extractSlashToken(value) !== slashToken) setSlashIndex(0)
            updateMention(value, e.target.selectionStart ?? value.length)
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
          <span>Drop PDF, Excel or text files to add to project files</span>
        </div>
      )}
    </aside>
  )
}
