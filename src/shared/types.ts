export interface Project {
  name: string
  path: string
  noteCount: number
  pathExists: boolean
}

export type CreateProjectResult = Project & { welcomeCreated: boolean }

export interface NoteMeta {
  id: string
  name: string
  updatedAt: number
  createdAt: number
  starred: boolean
}

export interface NoteSearchMatch {
  noteId: string
  name: string
  snippet: string
  line: number
  matchStart: number
  matchEnd: number
}

export type Tab = 'notes' | 'kanban' | 'modules' | 'planner'

export interface AIProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  uploadPdfEnabled?: boolean
}

/** A named AI provider profile: one endpoint/apiKey/model combination. */
export interface AIProfile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

/** The full AI config: a set of profiles plus the active one and the global PDF toggle. */
export interface AIConfig {
  profiles: AIProfile[]
  activeProfileId: string
  uploadPdfEnabled: boolean
}

export interface StorageSettings {
  rootDir: string
  disabledModules?: string[]
  disabledToolsets?: string[]
  browserHeadless?: boolean
  browserMaximize?: boolean
  browserIgnoreHttpsErrors?: boolean
  theme?: 'light' | 'dark' | 'system'
  fontSize?: 'small' | 'default' | 'large' | 'xlarge'
  uiDensity?: 'compact' | 'cozy'
  editorFontFamily?: 'sans' | 'serif' | 'mono'
  /** User enable/disable choices for builtin (app-shipped, read-only) skills, keyed by skill name. */
  builtinSkillOverrides?: Record<string, boolean>
}

export interface AppearanceSettings {
  theme: 'light' | 'dark' | 'system'
  fontSize: 'small' | 'default' | 'large' | 'xlarge'
  uiDensity: 'compact' | 'cozy'
  editorFontFamily: 'sans' | 'serif' | 'mono'
}

/** Persisted main-window geometry restored on next launch. */
export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized?: boolean
}

/** A registered module's availability state shown in Settings ▸ Modules. */
export interface ModuleSettings {
  id: string
  name: string
  summary: string
  enabled: boolean
  /** Optional external link shown under the module row (e.g. a template gallery). */
  link?: { label: string; url: string }
}

/** A registered toolset's availability state shown in Settings ▸ Toolsets. */
export interface ToolsetSettings {
  id: string
  name: string
  summary: string
  enabled: boolean
  toolCount: number
  headless?: boolean
  maximize?: boolean
  ignoreHttpsErrors?: boolean
}

export interface AppSettings {
  storage: StorageSettings
  ai: AIProviderConfig
}

/** App + runtime version info shown in Settings ▸ About (populated by the main process). */
export interface AboutInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  /** Production dependencies as `name@version` lines, one per entry. */
  dependencies: string[]
}

// ---- Skills (named instruction documents the AI can load on demand) ----

export type SkillScope = 'global' | 'project' | 'builtin'

export interface SkillMeta {
  scope: SkillScope
  name: string
  description: string
  /** Whether the skill is offered to the AI. Disabled skills are excluded from the system-prompt index and refused by `read_skill`. */
  enabled: boolean
}

export interface SkillList {
  global: SkillMeta[]
  project: SkillMeta[]
  builtin: SkillMeta[]
}

export interface SkillContent extends SkillMeta {
  content: string
}

export interface TokenUsage {
  input: number
  output: number
  cached?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallInfo[]
  error?: boolean
  attachments?: ChatAttachment[]
  usage?: TokenUsage
}

export type PdfAttachmentKind = 'extract' | 'upload'

export interface ChatAttachment {
  id: string
  kind: 'pdf' | 'text'
  name: string
  savedPath: string
  mode: PdfAttachmentKind
  pageCount?: number
  charCount?: number
  truncated?: boolean
}

export interface PdfExtractResult {
  text: string
  pageCount: number
  charCount: number
  truncated: boolean
  page?: number
  totalPages?: number
}

/** One entry in a project files folder (the `#` file-mention picker). */
export interface FileEntry {
  name: string
  isDir: boolean
}

export interface ChatSessionMeta {
  sessionId: string
  project: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface ChatThread {
  sessionId: string
  title?: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface ToolCallInfo {
  id: string
  name: string
  args: Record<string, unknown>
  /** Defined once the tool finished executing; absent while receiving/queued/running. */
  ok?: boolean
  result?: string
  /** Transient lifecycle while the chat is live: receiving (streaming from the model) → queued → running → done. Absent on persisted/historical tool calls. */
  status?: 'receiving' | 'queued' | 'running' | 'done'
}

export interface ChatStreamEvent {
  type:
    'message-start' | 'content' | 'tool' | 'message-end' | 'error' | 'confirm' | 'ask' | 'waiting'
  messageId?: string
  content?: string
  toolCall?: ToolCallInfo
  confirm?: ConfirmRequest
  ask?: AskRequest
  error?: string
  /** Module run ids the main chat is currently waiting on (`wait_modules`). */
  runIds?: string[]
  /** Raw provider usage on `message-end` (chat.completions or Responses shape). */
  usage?: unknown
}

// ---- Human-in-the-loop (`ask_user` tool) ----

export interface AskQuestion {
  id: string
  question: string
  /** Empty/omitted → free-text input. Present → single-select radio (or checkbox multi-select when `multiple`). */
  options?: string[]
  multiple?: boolean
  /** Sensitive free-text answer (password, API key). Masked input; the model receives a `${SECRET:<id>}` token, never the value. */
  secret?: boolean
}

export interface AskRequest {
  id: string
  project: string
  questions: AskQuestion[]
  /** Bot-task delete confirmations reuse the ask pipeline; hosts use it to pick the message prefix. */
  kind?: 'confirm'
}

export interface AskAnswer {
  id: string
  /** Selected option text, joined multi-select, or typed free text. */
  answer: string
  /** Full selection list when `multiple`. */
  selections?: string[]
}

export interface AskResponse {
  id: string
  answers: AskAnswer[]
  cancelled?: boolean
}

export interface ConfirmRequest {
  id: string
  project: string
  message: string
  items: string[]
}

export interface ConfirmResponse {
  id: string
  approved: boolean
}

// ---- Modules (background subagent framework) ----

export type ModuleStatus = 'queued' | 'planning' | 'running' | 'done' | 'failed' | 'cancelled'

export type ModuleStepStatus = 'pending' | 'running' | 'done' | 'failed'

export interface ModuleStepState {
  id: string
  name: string
  status: ModuleStepStatus
  detail?: string
  updatedAt?: number
}

export interface ModuleInfo {
  id: string
  name: string
  description: string
}

export interface ModuleRun {
  runId: string
  module: ModuleInfo
  project: string
  title: string
  prompt: string
  status: ModuleStatus
  steps: ModuleStepState[]
  currentStep?: number
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
  /** Primary output file (first produced). Kept for backwards compatibility. */
  outputFile?: string
  /** Every deliverable file the run produced (in order). */
  outputFiles?: string[]
  summary?: string
  error?: string
  /** Result payload submitted by the module subagent via `submit_result` (free-form string). */
  result?: string
  /** What the main chat asked the module to return, set via the `expect` argument of `start_module`. */
  expectResult?: string
  /** Set on hidden `bot-task` runs: the group-chat bot that owns this background task. */
  botId?: string
  /** Display name of that bot — used to attribute kanban comments the task writes. */
  botName?: string
  /** Group chat the task was assigned from (hidden `bot-task` runs only). */
  groupId?: string
  /** AI provider profile id the task runs with (resolved per-bot override; never the API key). */
  profileId?: string
  /** Per-bot model override applied on top of the profile (empty → profile model). */
  modelOverride?: string
}

/** A message in a module run's subagent conversation transcript (read-only history). */
export interface ModuleChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  ts?: number
  /** Tool name for role === 'tool' (also merged into toolCalls for rendering). */
  name?: string
  /** Tool calls made by an assistant turn. */
  toolCalls?: ToolCallInfo[]
}

export type ModuleEventType =
  'status' | 'step' | 'output' | 'error' | 'done' | 'result' | 'chat' | 'tool'

export type ModuleStartResult =
  { ok: true; runId: string; module: ModuleInfo; title: string } | { ok: false; error: string }

export interface ModuleEvent {
  runId: string
  project: string
  type: ModuleEventType
  run: ModuleRun
  step?: ModuleStepState
  stepIndex?: number
  outputFile?: string
  outputFiles?: string[]
  error?: string
  summary?: string
  result?: string
  /** Full updated transcript, attached when `type === 'chat'`. */
  chat?: ModuleChatMessage[]
  /** Subagent tool-call lifecycle snapshot, attached when `type === 'tool'` (transient, not persisted). */
  toolCall?: ToolCallInfo
}

// ---- Raw AI trace (readable app ↔ provider conversation log, JSONL) ----

export type AiTraceEndpoint = 'chat.completions' | 'responses' | 'title'

export type AiTraceRole = 'system' | 'user' | 'assistant' | 'tool'

/** A tool call issued by the assistant, with its payload (`args`). */
export interface AiTraceToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** First record of a trace file: the chat/module header info. */
export interface AiTraceHeader {
  type: 'header'
  project: string
  /** Session id (chat) or run id (module). */
  key: string
  kind: 'chat' | 'module'
  startedAt: number
}

/** One readable record of the conversation — a system/user prompt, an assistant (AI)
 *  reply, or a tool response — with timing metadata. Serialized as one JSONL line. */
export interface AiTraceEntry {
  seq: number
  role: AiTraceRole
  ts: number
  /** Processing time: assistant reply latency or tool execution time. */
  durationMs?: number
  /** The message content / prompt / reply / tool result. */
  content?: string
  /** Assistant reasoning (thinking) before the reply, if any. */
  reasoning?: string
  /** Assistant: tool calls it issued (payload only; results appear as `tool` records). */
  toolCalls?: AiTraceToolCall[]
  finishReason?: string
  usage?: unknown
  error?: string
  /** Tool record: the tool name and the call id it answers. */
  name?: string
  toolCallId?: string
  /** Assistant: provider + endpoint used for this reply. */
  model?: string
  baseUrl?: string
  endpoint?: AiTraceEndpoint
  /** Responses (PDF upload) — the attachment reference, never the base64 payload. */
  file?: { filename: string; file_id?: string }
}

/** The raw trace of one chat session or module run, as read back (parsed from the
 *  JSONL file: header record first, then one record per line). */
export interface AiTraceFile {
  project: string
  /** Session id (chat) or run id (module). */
  key: string
  kind: 'chat' | 'module'
  startedAt: number
  updatedAt: number
  entries: AiTraceEntry[]
  /** Absolute path on disk (populated when read back via IPC). */
  path?: string
}

// ---- Planner (project schedules + calendar) ----

export type {
  ProjectCalendar,
  RolledUpTask,
  Schedule,
  ScheduleMeta,
  ScheduleStatus,
  ScheduleTask
} from './planner'

export type {
  BotGroupEvent,
  BotMemoryEntry,
  BotProfile,
  BotTaskQueueItem,
  BotUpsertInput,
  GroupChatData,
  GroupChatMeta,
  GroupMessage,
  GroupMessagePageOpts,
  GroupPatch,
  GroupSenderKind,
  NewGroupInput,
  TagPolicy
} from './bots'

export type {
  KanbanArchive,
  KanbanArchiveMove,
  KanbanBoard,
  KanbanCard,
  KanbanCardComment,
  KanbanCardPatch,
  KanbanColumn,
  KanbanColumnPatch,
  KanbanCommentInput,
  KanbanPriority,
  NewKanbanCardInput,
  NewKanbanColumnInput
} from './kanban'
