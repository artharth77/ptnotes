import type { AIProviderConfig, ModuleEvent, ModuleRun } from '@shared/types'
import type { BotGroupEvent, BotProfile, GroupChatData, GroupMessage } from '@shared/bots'
import {
  MAX_BOT_TURNS_PER_MESSAGE,
  SUMMARY_KEEP_RECENT,
  SUMMARY_THRESHOLD_CHARS,
  parseBotReply,
  planTagTriggers,
  type TagPolicy
} from '@shared/bots'
import { createClient } from '../ai/client'
import { AiTraceRecorder } from '../ai/trace'
import type { AIConfigStore } from '../ai/config'
import type { ModuleRunManager } from '../modules/runs'
import type { BotsStore } from './db'
import type OpenAI from 'openai'

export type BotGroupBroadcaster = (evt: BotGroupEvent) => void

const BOT_TASK_EXPECT =
  'A concise report: what you did, the outcome, and the paths of any notes/files/cards you created.'

const LINK_RULE = `- Whenever you mention an existing note, project file, plan/schedule or kanban card in your reply, always link to it: [note name](note:note name), [file name](file:file name), [plan name](plan:plan name), [card title](kanban:card title). The link opens the item in the app. Only link items that actually exist in this project (from the conversation or your task results) — never invent names.`

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled'])

interface TurnState {
  /** Remaining bot turns for the current user message (hard cap). */
  turnsLeft: number
  /** Bot→bot→bot relay budget (one explicit chain per user message). */
  relaysLeft: number
  involved: Set<string>
}

interface TurnOpts {
  tagPolicy: TagPolicy
  /** Display name of whoever triggered this turn ('You' or a bot name). */
  triggerLabel: string
  /** True when the user addressed this bot directly with an @mention. */
  leaderDirected?: boolean
}

interface Job {
  kind: 'user' | 'task-report'
  text?: string
  run?: ModuleRun
  resolve: () => void
}

interface SessionDeps {
  store: BotsStore
  configStore: AIConfigStore
  moduleManager: ModuleRunManager
  broadcast: BotGroupBroadcaster
  /** Injectable OpenAI-compatible client factory (tests); defaults to the real one. */
  clientFactory?: (cfg: AIProviderConfig) => OpenAI
}

export class GroupChatManager {
  private readonly sessions = new Map<string, GroupSession>()
  private readonly reportedRuns = new Set<string>()

  constructor(private readonly deps: SessionDeps) {}

  static key(project: string, groupId: string): string {
    return `${project}::${groupId}`
  }

  /** Send a user message; resolves when the whole orchestration for it has settled. */
  async send(project: string, groupId: string, text: string): Promise<void> {
    const session = this.sessionFor(project, groupId)
    await session.enqueueUserMessage(text)
  }

  stop(project: string, groupId: string): void {
    this.sessions.get(GroupChatManager.key(project, groupId))?.stop()
  }

  /** Drop cached sessions (e.g. after the project root changed). */
  closeAll(): void {
    for (const s of this.sessions.values()) s.stop()
    this.sessions.clear()
  }

  /**
   * Observe module events: when a bot-task run reaches a terminal status, schedule
   * the owner bot's completion report and the next queued task.
   */
  handleModuleEvent(evt: ModuleEvent): void {
    const run = evt.run
    if (!run.botId || !run.groupId) return
    if (!TERMINAL_STATUSES.has(run.status)) return
    if (evt.type !== 'done' && evt.type !== 'error' && evt.type !== 'status') return
    if (this.reportedRuns.has(run.runId)) return
    this.reportedRuns.add(run.runId)
    if (this.reportedRuns.size > 1000) this.reportedRuns.clear()
    const session = this.sessionFor(run.project, run.groupId)
    session.enqueueTaskReport(run)
  }

  private sessionFor(project: string, groupId: string): GroupSession {
    const key = GroupChatManager.key(project, groupId)
    let session = this.sessions.get(key)
    if (!session) {
      session = new GroupSession(this.deps, project, groupId)
      this.sessions.set(key, session)
    }
    return session
  }
}

class GroupSession {
  private jobs: Job[] = []
  private processing = false
  private currentAbort: AbortController | null = null
  private stopped = false
  private trace: AiTraceRecorder | null = null

  constructor(
    private readonly deps: SessionDeps,
    readonly project: string,
    readonly groupId: string
  ) {}

  private emit(evt: BotGroupEvent): void {
    this.deps.broadcast(evt)
  }

  private system(content: string, opts?: { taskId?: string; error?: boolean }): void {
    const msg = this.deps.store.appendMessage(this.project, this.groupId, {
      senderKind: 'system',
      senderName: 'System',
      content,
      ts: Date.now(),
      ...(opts?.taskId ? { taskId: opts.taskId } : {}),
      ...(opts?.error ? { error: true } : {})
    })
    this.emit({ type: 'message', project: this.project, groupId: this.groupId, message: msg })
  }

  stop(): void {
    this.stopped = true
    this.currentAbort?.abort()
    for (const job of this.jobs.splice(0)) {
      job.resolve()
    }
  }

  enqueueUserMessage(text: string): Promise<void> {
    const msg = this.deps.store.appendMessage(this.project, this.groupId, {
      senderKind: 'user',
      senderName: 'You',
      content: text,
      ts: Date.now()
    })
    this.emit({ type: 'message', project: this.project, groupId: this.groupId, message: msg })
    this.stopped = false
    return new Promise<void>((resolve) => {
      this.jobs.push({ kind: 'user', text, resolve })
      void this.pump()
    })
  }

  enqueueTaskReport(run: ModuleRun): void {
    this.stopped = false
    this.jobs.push({ kind: 'task-report', run, resolve: () => {} })
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      while (this.jobs.length > 0) {
        const job = this.jobs.shift()!
        try {
          if (job.kind === 'user') await this.processUserJob(job)
          else await this.processTaskReportJob(job)
        } catch (err) {
          if (!this.stopped) {
            const message = err instanceof Error ? err.message : String(err)
            this.system(`⚠️ ${message}`, { error: true })
          }
        } finally {
          job.resolve()
        }
      }
    } finally {
      this.processing = false
    }
  }

  // ---- orchestration of one user message ----

  private async processUserJob(job: Job): Promise<void> {
    const group = this.group()
    const { leader, members } = this.resolveBots(group)
    if (members.length === 0) {
      this.system('⚠️ This group has no valid bots. Assign bots in the group settings.', {
        error: true
      })
      return
    }
    const state: TurnState = {
      turnsLeft: MAX_BOT_TURNS_PER_MESSAGE,
      relaysLeft: 1,
      involved: new Set()
    }

    const memberIds = members.map((m) => m.id)
    const tags = parseBotReply(job.text ?? '', memberIds).tags
    if (tags.length > 0) {
      for (const tag of tags) {
        if (state.turnsLeft <= 0) break
        const bot = members.find((m) => m.id === tag)
        if (!bot) continue
        state.turnsLeft--
        await this.runBotTurn(
          bot,
          { tagPolicy: 'relay', triggerLabel: 'You', leaderDirected: true },
          state
        )
      }
    } else if (leader) {
      state.turnsLeft--
      await this.runBotTurn(leader, { tagPolicy: 'free', triggerLabel: 'You' }, state)
    } else {
      this.system('⚠️ The group leader bot is missing. Reassign a leader in the group settings.', {
        error: true
      })
    }

    await this.maybeSummarizeAndRemember([...state.involved])
  }

  private async runBotTurn(bot: BotProfile, opts: TurnOpts, state: TurnState): Promise<void> {
    if (this.stopped) return
    state.involved.add(bot.id)
    this.emit({
      type: 'turn-start',
      project: this.project,
      groupId: this.groupId,
      botId: bot.id,
      botName: bot.name
    })
    try {
      const group = this.group()
      const { leader, members } = this.resolveBots(group)
      const memberIds = members.map((m) => m.id)
      const cfg = await this.configFor(bot)
      const client = this.deps.clientFactory ? this.deps.clientFactory(cfg) : createClient(cfg)

      const sys = this.buildSystemPrompt(bot, group, leader, members)
      const transcript = this.buildTranscript()
      const turnNote = opts.leaderDirected
        ? `The user addressed this message to you directly (@${bot.id}).`
        : opts.tagPolicy === 'free'
          ? `You are the group leader; the user's message was addressed to you. Assign work to members by @mentioning them when appropriate.`
          : `${opts.triggerLabel} asked you to respond / take this on.`
      const userContent = `${transcript}\n\n---\nRespond now as @${bot.id} (${bot.name}). ${turnNote}`

      const trace = await this.traceRecorder()
      trace.append({ role: 'user', ts: Date.now(), content: `(turn for @${bot.id}) ${turnNote}` })
      const started = Date.now()
      const completion = await client.chat.completions.create(
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userContent }
          ],
          stream: false
        },
        { signal: this.abort().signal }
      )
      const raw = completion.choices[0]?.message?.content ?? ''
      trace.append({
        role: 'assistant',
        ts: Date.now(),
        durationMs: Date.now() - started,
        content: raw,
        model: cfg.model
      })
      await trace.flush()
      if (this.stopped) return

      const parsed = parseBotReply(raw, memberIds)
      if (parsed.content) {
        this.appendBotMessage(bot, parsed.content, group)
      }
      for (const assign of parsed.assigns) {
        await this.handleAssignment(bot, assign, opts.triggerLabel)
      }

      const plan = planTagTriggers(parsed.tags, opts.tagPolicy, state.relaysLeft, state.turnsLeft)
      state.relaysLeft = plan.relaysLeft
      for (const trigger of plan.triggers) {
        if (this.stopped) break
        const target = members.find((m) => m.id === trigger.botId)
        if (!target) continue
        state.turnsLeft--
        await this.runBotTurn(
          target,
          { tagPolicy: trigger.tagPolicy, triggerLabel: bot.name },
          state
        )
      }
    } finally {
      this.emit({ type: 'turn-end', project: this.project, groupId: this.groupId, botId: bot.id })
    }
  }

  // ---- background task handling ----

  private async handleAssignment(
    bot: BotProfile,
    assign: { title: string; task: string },
    requestedBy: string
  ): Promise<void> {
    const queue = this.deps.store.listQueue(this.project)
    const running = queue.find((q) => q.botId === bot.id && q.status === 'running')
    if (running) {
      this.deps.store.enqueueTask(this.project, {
        groupId: this.groupId,
        botId: bot.id,
        title: assign.title,
        task: assign.task,
        requestedBy
      })
      const position = queue.filter((q) => q.botId === bot.id && q.status === 'queued').length + 1
      this.system(`⏳ ${bot.name} queued task “${assign.title}” (position ${position})`)
      return
    }
    await this.startTask(bot, assign, requestedBy)
  }

  private async startTask(
    bot: BotProfile,
    assign: { title: string; task: string },
    requestedBy: string
  ): Promise<void> {
    const item = this.deps.store.enqueueTask(this.project, {
      groupId: this.groupId,
      botId: bot.id,
      title: assign.title,
      task: assign.task,
      requestedBy
    })
    const res = await this.deps.moduleManager.start(
      this.project,
      'bot-task',
      assign.title,
      assign.task,
      BOT_TASK_EXPECT,
      {
        botId: bot.id,
        groupId: this.groupId,
        displayName: `${bot.name} Task`,
        ...(bot.profileId ? { profileId: bot.profileId } : {}),
        ...(bot.model ? { modelOverride: bot.model } : {})
      }
    )
    if (res.ok) {
      this.deps.store.setTaskRunning(this.project, item.queueId, res.runId)
      this.system(`▶️ ${bot.name} started background task “${assign.title}”`, { taskId: res.runId })
    } else {
      this.deps.store.finishTask(this.project, item.queueId)
      this.system(`⚠️ ${bot.name}: failed to start “${assign.title}” — ${res.error}`, {
        error: true
      })
    }
  }

  private async startNextQueued(bot: BotProfile): Promise<void> {
    const next = this.deps.store.nextQueuedTask(this.project, bot.id)
    if (!next) return
    await this.startTask(bot, { title: next.title, task: next.task }, next.requestedBy)
  }

  private async processTaskReportJob(job: Job): Promise<void> {
    const run = job.run!
    const item = this.deps.store.listQueue(this.project).find((q) => q.runId === run.runId)
    if (item) this.deps.store.finishTask(this.project, item.queueId)
    const bot = run.botId ? this.deps.store.getBot(run.botId) : null

    if (bot) await this.startNextQueued(bot)

    const statusText =
      run.status === 'done'
        ? 'finished successfully'
        : run.status === 'failed'
          ? 'FAILED'
          : 'was cancelled'
    const resultText = run.result || run.summary || run.error || '(no details)'

    if (!bot) {
      this.system(`📋 Task “${run.title}” ${statusText}: ${resultText}`, { taskId: run.runId })
      return
    }

    this.emit({
      type: 'turn-start',
      project: this.project,
      groupId: this.groupId,
      botId: bot.id,
      botName: bot.name
    })
    try {
      const group = this.group()
      const { members } = this.resolveBots(group)
      const cfg = await this.configFor(bot)
      const client = this.deps.clientFactory ? this.deps.clientFactory(cfg) : createClient(cfg)
      const roster = members
        .map((m) => `- @${m.id} — ${m.name}${m.id === group.leaderBotId ? ' (leader)' : ''}`)
        .join('\n')
      const sys = `You are ${bot.name} (@${bot.id}), ${bot.role || 'a bot member'} in the group chat "${group.title}" (project "${this.project}").
Group members:
${roster}
The user appears as "You".

You have no tools. Your background task just completed and you are posting the result report to the group. Do NOT declare new work, do NOT use \`\`\`assign blocks, do NOT mention other bots. Keep it concise (a few sentences or a short list).
${LINK_RULE}`
      const user = `Your background task "${run.title}" ${statusText}.
Requested by: ${item?.requestedBy ?? 'the group'}
Result:
${resultText}

Post your result report to the group now.`
      const completion = await client.chat.completions.create(
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user }
          ],
          stream: false
        },
        { signal: this.abort().signal }
      )
      const raw = completion.choices[0]?.message?.content ?? ''
      const parsed = parseBotReply(
        raw,
        members.map((m) => m.id)
      )
      if (parsed.content) {
        this.appendBotMessage(bot, parsed.content, group, run.runId)
      }
    } catch {
      this.appendBotMessage(
        bot,
        `Task “${run.title}” ${statusText}.\n\n${resultText}`,
        this.group(),
        run.runId
      )
    } finally {
      this.emit({ type: 'turn-end', project: this.project, groupId: this.groupId, botId: bot.id })
    }
  }

  // ---- summarization + memory ----

  private async maybeSummarizeAndRemember(involvedBotIds: string[]): Promise<void> {
    const group = this.group()
    const messages = this.deps.store.listMessages(this.project, this.groupId)
    const upTo = group.summarizedUpToSeq ?? 0
    const unsummarized = messages.filter((m) => m.seq > upTo)
    const chars = unsummarized.reduce((sum, m) => sum + m.content.length, 0)
    if (chars < SUMMARY_THRESHOLD_CHARS) return
    const toSummarize = unsummarized.slice(
      0,
      Math.max(0, unsummarized.length - SUMMARY_KEEP_RECENT)
    )
    if (toSummarize.length === 0) return

    const { leader, members } = this.resolveBots(group)
    if (!leader) return

    try {
      const cfg = await this.configFor(leader)
      const client = this.deps.clientFactory ? this.deps.clientFactory(cfg) : createClient(cfg)
      const previous = group.summary ? `Previous summary:\n${group.summary}\n\n` : ''
      const transcript = toSummarize.map((m) => formatTranscriptLine(m)).join('\n')
      const completion = await client.chat.completions.create(
        {
          model: cfg.model,
          messages: [
            {
              role: 'system',
              content:
                'You maintain the running summary of a group chat between a user and several bots. Produce an updated, self-contained summary (plain text) that preserves: goals and decisions, facts established, task assignments and their status, and open questions. Keep it as short as possible while complete. Output only the summary.'
            },
            { role: 'user', content: `${previous}New messages to fold in:\n${transcript}` }
          ],
          stream: false
        },
        { signal: this.abort().signal }
      )
      const summary = (completion.choices[0]?.message?.content ?? '').trim()
      if (summary) {
        this.deps.store.setSummary(
          this.project,
          this.groupId,
          summary,
          toSummarize[toSummarize.length - 1].seq
        )
        this.emit({ type: 'summary', project: this.project, groupId: this.groupId })
      }
    } catch {
      // summarization is best-effort; never fail the orchestration for it
    }

    for (const botId of involvedBotIds) {
      const bot = members.find((m) => m.id === botId)
      if (!bot) continue
      await this.extractMemory(bot)
    }
  }

  private async extractMemory(bot: BotProfile): Promise<void> {
    try {
      const cfg = await this.configFor(bot)
      const client = this.deps.clientFactory ? this.deps.clientFactory(cfg) : createClient(cfg)
      const existing = this.deps.store.listMemories(this.project, bot.id)
      const messages = this.deps.store.listMessages(this.project, this.groupId)
      const recent = messages
        .slice(-40)
        .map((m) => formatTranscriptLine(m))
        .join('\n')
      const sys = `You maintain the private memory of "${bot.name}" (@${bot.id}), ${bot.role || 'a bot'}, in project "${this.project}". From the conversation, extract durable facts worth remembering for FUTURE conversations in this project: decisions, preferences, project facts, standing commitments. Ignore small talk and one-off details. Output ONLY a JSON array of short strings (max 10). Output [] if there is nothing new.`
      const user = `Existing memory:\n${existing.map((m) => `- ${m.content}`).join('\n') || '(empty)'}\n\nRecent conversation:\n${recent}`
      const completion = await client.chat.completions.create(
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user }
          ],
          stream: false
        },
        { signal: this.abort().signal }
      )
      const raw = completion.choices[0]?.message?.content ?? '[]'
      const fresh = parseJsonArray(raw)
      if (fresh.length > 0) {
        this.deps.store.saveMemories(this.project, bot.id, fresh)
      }
    } catch {
      // memory extraction is best-effort
    }
  }

  // ---- helpers ----

  private group(): GroupChatData {
    const group = this.deps.store.readGroup(this.project, this.groupId)
    if (!group) throw new Error('Group chat not found.')
    return group
  }

  private resolveBots(group: GroupChatData): { leader: BotProfile | null; members: BotProfile[] } {
    const members = group.botIds
      .map((id) => this.deps.store.getBot(id))
      .filter((b): b is BotProfile => !!b)
    const leader = members.find((m) => m.id === group.leaderBotId) ?? members[0] ?? null
    return { leader, members }
  }

  private configFor(bot: BotProfile): Promise<AIProviderConfig> {
    return this.deps.configStore.loadResolved(bot.profileId, bot.model)
  }

  private abort(): AbortController {
    if (!this.currentAbort || this.currentAbort.signal.aborted) {
      this.currentAbort = new AbortController()
    }
    return this.currentAbort
  }

  private appendBotMessage(
    bot: BotProfile,
    content: string,
    group: GroupChatData,
    taskId?: string
  ): void {
    const msg = this.deps.store.appendMessage(this.project, this.groupId, {
      senderKind: 'bot',
      botId: bot.id,
      senderName: bot.name,
      role: bot.role,
      isLeader: bot.id === group.leaderBotId,
      content,
      ts: Date.now(),
      ...(taskId ? { taskId } : {})
    })
    this.emit({ type: 'message', project: this.project, groupId: this.groupId, message: msg })
  }

  private buildTranscript(): string {
    const group = this.group()
    const upTo = group.summarizedUpToSeq ?? 0
    const messages = this.deps.store.listMessages(this.project, this.groupId)
    const lines = messages.filter((m) => m.seq > upTo).map((m) => formatTranscriptLine(m))
    return lines.length > 0 ? lines.join('\n') : '(the conversation starts now)'
  }

  private buildSystemPrompt(
    bot: BotProfile,
    group: GroupChatData,
    leader: BotProfile | null,
    members: BotProfile[]
  ): string {
    const leaderId = leader?.id ?? group.leaderBotId
    const isLeader = bot.id === leaderId
    const roster = members
      .map(
        (m) =>
          `- @${m.id} — ${m.name}${m.role ? ` (${m.role})` : ''}${m.id === leaderId ? ' [GROUP LEADER]' : ''}${m.id === bot.id ? ' ← you' : ''}`
      )
      .join('\n')
    const memories = this.deps.store.listMemories(this.project, bot.id)
    const memorySection =
      memories.length > 0
        ? `YOUR MEMORY (durable facts from earlier in this project):\n${memories.map((m) => `- ${m.content}`).join('\n')}`
        : 'YOUR MEMORY: (empty)'
    const summarySection = group.summary
      ? `EARLIER CONVERSATION (summary of older messages):\n${group.summary}`
      : ''

    return `You are ${bot.name} (@${bot.id})${bot.role ? `, the ${bot.role}` : ''}, a member of the group chat "${group.title}" (project "${this.project}").
${isLeader ? 'You are the GROUP LEADER: messages from the user that do not @mention anyone are addressed to you — decide what to do, answer directly, and/or assign work to members by @mentioning them.' : ''}
${bot.persona ? `\nYOUR PERSONA / STANDING INSTRUCTIONS:\n${bot.persona}\n` : ''}
GROUP MEMBERS (only these exist; mention them with @id):
${roster}
The user participates as "You".

RULES:
- You have NO tools in this chat. All real work (files, notes, kanban, schedules, research, documents) happens through background tasks.
- When work is assigned to you (or you take it on) and it requires real work: reply briefly in chat AND end your reply with a fenced block:
\`\`\`assign
{"title": "<short task title>", "task": "<full standalone instructions, including source references like note:<name>, file:<name>, plan:<schedule id>>"}
\`\`\`
The block is removed from the chat; a background run starts for you. If a task is already running for you, the new one is queued automatically — say it is queued in your reply.
- To ask another member a question or hand them a task, @mention them. Members you @mention will respond.
- If you were brought in by another bot, answer directly WITHOUT mentioning other bots, unless the person who tagged you explicitly asked you to involve someone else. Never mention the bot who tagged you back.
${LINK_RULE}
- Keep replies concise and match the user's language.

${memorySection}
${summarySection}
Current date: ${new Date().toISOString().slice(0, 10)}.`
  }

  private async traceRecorder(): Promise<AiTraceRecorder> {
    if (!this.trace) {
      const meta = await this.deps.store.groupTraceMeta(this.project, this.groupId)
      this.trace = new AiTraceRecorder({
        project: this.project,
        key: this.groupId,
        kind: 'chat',
        initialSeq: meta.count,
        hasSystem: meta.hasSystem,
        append: (header, lines) =>
          this.deps.store.appendGroupTrace(this.project, this.groupId, header, lines)
      })
    }
    return this.trace
  }
}

function formatTranscriptLine(m: GroupMessage): string {
  if (m.senderKind === 'user') return `You: ${m.content}`
  if (m.senderKind === 'system') return `[system] ${m.content}`
  return `[${m.senderName}${m.role ? ` (${m.role})` : ''}]: ${m.content}`
}

function parseJsonArray(raw: string): string[] {
  const text = raw.trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  } catch {
    return []
  }
}
