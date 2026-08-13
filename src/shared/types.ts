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
}

export interface Todo {
  id: string
  text: string
  done: boolean
}

export type Tab = 'notes' | 'todo' | 'modules'

export interface AIProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  uploadPdfEnabled?: boolean
}

export interface StorageSettings {
  rootDir: string
  disabledModules?: string[]
}

/** A registered module's availability state shown in Settings ▸ Modules. */
export interface ModuleSettings {
  id: string
  name: string
  summary: string
  enabled: boolean
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
}

// ---- Skills (named instruction documents the AI can load on demand) ----

export type SkillScope = 'global' | 'project'

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
}

export interface SkillContent extends SkillMeta {
  content: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallInfo[]
  error?: boolean
  attachments?: ChatAttachment[]
  moduleRunId?: string
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
  ok: boolean
  result?: string
}

export interface ChatStreamEvent {
  type: 'message-start' | 'content' | 'tool' | 'message-end' | 'error' | 'confirm'
  messageId?: string
  content?: string
  toolCall?: ToolCallInfo
  confirm?: ConfirmRequest
  error?: string
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

export type ModuleEventType = 'status' | 'step' | 'output' | 'error' | 'done'

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
}
