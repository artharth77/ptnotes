// ---- Bots group chat (shared between main, renderer and tests) ----

/** A bot identity. Global (app-wide); memories are scoped per project. */
export interface BotProfile {
  /** Slug id used in @mentions (unique across the bot library). */
  id: string
  name: string
  /** Role shown as a badge, e.g. "Project Manager". */
  role: string
  /** Persona / standing instructions injected into the bot's system prompt. */
  persona: string
  /** Optional AI provider profile override (falls back to the active profile). */
  profileId?: string
  /** Optional model override (falls back to the chosen profile's model). */
  model?: string
  createdAt: number
  updatedAt: number
}

export type GroupSenderKind = 'user' | 'bot' | 'system'

/** How many group messages the UI loads per page (latest page first, then older on scroll-up). */
export const GROUP_CHAT_PAGE_SIZE = 50

/** One message in a group chat. */
export interface GroupMessage {
  id: string
  /** Monotonic per-group sequence (1-based). */
  seq: number
  senderKind: GroupSenderKind
  botId?: string
  senderName: string
  /** Bot role at send time (display badge). */
  role?: string
  isLeader?: boolean
  content: string
  ts: number
  error?: boolean
  /** Background task run this message refers to (task start/queued/report messages). */
  taskId?: string
}

export interface GroupChatMeta {
  groupId: string
  project: string
  title: string
  botIds: string[]
  leaderBotId: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface GroupChatData extends GroupChatMeta {
  messages: GroupMessage[]
  /** Rolling summary of older messages, injected into the group system prompt (never rendered in the chat box). */
  summary?: string
  /** All messages with seq <= this are represented by the summary. */
  summarizedUpToSeq?: number
  /** Set only when reading a page: whether older messages remain above the returned window. */
  hasMore?: boolean
  /** Set only when reading a page: seq of the oldest message in the returned window (cursor for loading older). */
  oldestSeq?: number
}

/** Optional paging for reading a group's messages (cursor on the monotonic per-group `seq`). */
export interface GroupMessagePageOpts {
  /** Max messages to return (latest page, or older than `beforeSeq`). */
  limit?: number
  /** Only return messages with `seq < beforeSeq` (load a page of older messages). */
  beforeSeq?: number
}

/** A durable fact a bot remembers across group chats, scoped to one project. */
export interface BotMemoryEntry {
  id: string
  botId: string
  content: string
  createdAt: number
}

/** A queued or running background assignment for one bot (single-flight per bot). */
export interface BotTaskQueueItem {
  queueId: string
  groupId: string
  botId: string
  /** Set once the background run started. */
  runId?: string | null
  title: string
  task: string
  /** Display name of who requested it ('You' or a bot name). */
  requestedBy: string
  status: 'queued' | 'running'
  createdAt: number
}

export type BotGroupEvent =
  | { type: 'message'; project: string; groupId: string; message: GroupMessage }
  | { type: 'turn-start'; project: string; groupId: string; botId: string; botName: string }
  | { type: 'turn-end'; project: string; groupId: string; botId: string }
  | { type: 'group-updated'; project: string; group: GroupChatMeta }
  | { type: 'summary'; project: string; groupId: string }
  | { type: 'error'; project: string; groupId: string; error: string }

/** Create-or-update input for the bot library (id set → update). */
export interface BotUpsertInput {
  id?: string
  name: string
  role?: string
  persona?: string
  profileId?: string | null
  model?: string | null
}

export interface NewGroupInput {
  title: string
  botIds: string[]
  leaderBotId: string
}

export interface GroupPatch {
  title?: string
  botIds?: string[]
  leaderBotId?: string
}

// ---- Tunables (exported so tests and the orchestrator agree) ----

/** Max bot turns (AI completions) triggered by a single user message — hard loop guard. */
export const MAX_BOT_TURNS_PER_MESSAGE = 16
/** Bot turns deeper than this depth can never trigger further bots. */
export const MAX_RELAY_DEPTH = 3
/** When the un-summarized context exceeds this many chars, the leader summarizes. */
export const SUMMARY_THRESHOLD_CHARS = 8_000
/** Messages kept out of the summary (recent tail always sent verbatim). */
export const SUMMARY_KEEP_RECENT = 6
/** Max memory entries kept per bot per project. */
export const MAX_MEMORY_ENTRIES = 50

/**
 * Tag policy of a bot turn, used by `planTagTriggers`:
 * - `free`  — leader or a user-tagged bot: its tags always trigger the tagged bots (assignments).
 * - `relay` — a bot tagged by another bot: answers without tagging back, unless the tagger
 *             explicitly requested a relay — then its tags may consume the one relay budget.
 * - `none`  — deeper turns: tags are display-only.
 */
export type TagPolicy = 'free' | 'relay' | 'none'

export interface PlannedTrigger {
  botId: string
  tagPolicy: TagPolicy
}

/**
 * Decide which `@bot` tags in a reply actually trigger new bot turns.
 * Pure so the routing rules are unit-testable: depth-1 (`free`) turns always trigger;
 * a `relay` turn may trigger once per user message (one explicit bot→bot→bot chain);
 * `none` turns never trigger. Never exceeds `remainingTurns`. `capped` is true when the
 * per-message turn cap prevented at least one tag from triggering.
 */
export function planTagTriggers(
  tags: string[],
  tagPolicy: TagPolicy,
  relaysLeft: number,
  remainingTurns: number
): { triggers: PlannedTrigger[]; relaysLeft: number; capped: boolean } {
  if (tags.length === 0 || tagPolicy === 'none') return { triggers: [], relaysLeft, capped: false }
  if (tagPolicy === 'relay' && relaysLeft <= 0) return { triggers: [], relaysLeft, capped: false }
  if (remainingTurns <= 0) return { triggers: [], relaysLeft, capped: true }
  const capped = tags.length > remainingTurns
  if (tagPolicy === 'relay') {
    const triggers = tags
      .slice(0, remainingTurns)
      .map((botId) => ({ botId, tagPolicy: 'none' as const }))
    return { triggers, relaysLeft: relaysLeft - 1, capped }
  }
  const triggers = tags
    .slice(0, remainingTurns)
    .map((botId) => ({ botId, tagPolicy: 'relay' as const }))
  return { triggers, relaysLeft, capped }
}

/** Extract `@bot-id` mentions that match known bot ids, unique, in order of appearance. */
export function extractBotTags(text: string, knownBotIds: string[]): string[] {
  if (!text || knownBotIds.length === 0) return []
  const found: string[] = []
  const re = /(?<![a-zA-Z0-9_-])@([a-zA-Z0-9][a-zA-Z0-9_-]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[1]
    const id = knownBotIds.find((b) => b.toLowerCase() === raw.toLowerCase())
    if (id && !found.includes(id)) found.push(id)
  }
  return found
}

export interface AssignDirective {
  title: string
  task: string
}

export interface ParsedBotReply {
  /** Reply with think blocks, assign blocks and ASSIGN: lines stripped. */
  content: string
  /** Background tasks the bot declared for itself (```assign blocks / ASSIGN: lines). */
  assigns: AssignDirective[]
  /** @bot mentions found in the visible content. */
  tags: string[]
}

function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '')
}

function parseAssignBody(raw: string): AssignDirective | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as { title?: unknown; task?: unknown }
    const task = typeof parsed.task === 'string' ? parsed.task.trim() : ''
    if (task) {
      const title =
        typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim()
          : task.split(/\s+/).slice(0, 8).join(' ')
      return { title, task }
    }
    if (typeof parsed.title === 'string' && parsed.title.trim()) {
      return { title: parsed.title.trim(), task: parsed.title.trim() }
    }
  } catch {
    // not JSON — treat the body as plain task text
  }
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length === 0) return null
  const title = lines[0].trim().split(/\s+/).slice(0, 8).join(' ')
  const task = lines.length > 1 ? lines.slice(1).join('\n').trim() : lines[0].trim()
  return { title, task }
}

/**
 * Parse a bot reply: strips `<think>` reasoning (never rendered), extracts
 * ```assign fenced blocks and `ASSIGN:` line directives into background tasks,
 * and collects @bot mentions from the remaining visible content.
 */
export function parseBotReply(text: string, knownBotIds: string[]): ParsedBotReply {
  let body = stripThinkBlocks(text ?? '')
  const assigns: AssignDirective[] = []

  body = body.replace(/```[ \t]*assign[ \t]*\r?\n([\s\S]*?)```/gi, (_all, inner: string) => {
    const parsed = parseAssignBody(inner)
    if (parsed) assigns.push(parsed)
    return ''
  })
  body = body.replace(/^[ \t]*ASSIGN:[ \t]*(.+)$/gim, (_all, rest: string) => {
    const task = rest.trim()
    if (task) assigns.push({ title: task.split(/\s+/).slice(0, 8).join(' '), task })
    return ''
  })

  const content = body.replace(/\n{3,}/g, '\n\n').trim()
  return { content, assigns, tags: extractBotTags(content, knownBotIds) }
}

/** Format a message timestamp: HH:MM for today, "MMM D, HH:MM" otherwise. */
export function formatGroupTimestamp(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return time
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${date}, ${time}`
}

/** Date separator label: Today / Yesterday / "Mmm D" (this year) / "Mmm D YYYY". */
export function formatGroupDateLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000
  )
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return d.getFullYear() === today.getFullYear() ? date : `${date} ${d.getFullYear()}`
}

/** Merge extracted memory facts with existing entries, keeping the newest `cap`. */
export function mergeMemoryEntries(
  existing: string[],
  fresh: string[],
  cap = MAX_MEMORY_ENTRIES
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of [...existing, ...fresh]) {
    const key = entry.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(entry.trim())
  }
  return out.slice(-cap)
}

// ---- @mention rendering (group chat display) ----

export type MentionSegment =
  { type: 'text'; text: string } | { type: 'mention'; botId: string; name: string }

/** Split content into text / @mention segments (only known bot ids become mentions). */
export function splitMentionSegments(
  content: string,
  bots: { id: string; name: string }[]
): MentionSegment[] {
  if (!content || bots.length === 0 || !content.includes('@')) {
    return [{ type: 'text', text: content }]
  }
  const out: MentionSegment[] = []
  const re = /(?<![a-zA-Z0-9_-])@([a-zA-Z0-9][a-zA-Z0-9_-]*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const bot = bots.find((b) => b.id.toLowerCase() === m![1].toLowerCase())
    if (!bot) continue
    if (m.index > last) out.push({ type: 'text', text: content.slice(last, m.index) })
    out.push({ type: 'mention', botId: bot.id, name: bot.name })
    last = m.index + m[0].length
  }
  if (last < content.length) out.push({ type: 'text', text: content.slice(last) })
  return out
}

function escapeLinkLabel(name: string): string {
  return name.replace(/([\\\][])/g, '\\$1')
}

/**
 * Rewrite `@bot-id` mentions into `[@Name](mention:bot-id)` markdown links so they
 * render as highlighted chips. Fenced code blocks are left untouched.
 */
export function linkifyBotMentions(content: string, bots: { id: string; name: string }[]): string {
  if (!content || !content.includes('@') || bots.length === 0) return content
  return content
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : splitMentionSegments(part, bots)
            .map((seg) =>
              seg.type === 'text'
                ? seg.text
                : `[@${escapeLinkLabel(seg.name)}](mention:${seg.botId})`
            )
            .join('')
    )
    .join('')
}

/**
 * Replace `kanban:<card id>` tokens with `kanban:<card title>` for display (the
 * mention popup inserts card ids). Unknown ids and non-token text stay as-is.
 */
export function resolveKanbanCardNames(
  content: string,
  cards: { id: string; title: string }[]
): string {
  if (!content || !content.includes('kanban:') || cards.length === 0) return content
  const byId = new Map(cards.map((c) => [c.id.toLowerCase(), c.title]))
  return content.replace(/(^|[\s(])kanban:(\S+)/g, (m, pre: string, raw: string) => {
    const title = byId.get(raw.toLowerCase())
    return title ? `${pre}kanban:${title}` : m
  })
}
