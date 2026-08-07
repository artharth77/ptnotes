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

export type Tab = 'notes' | 'todo'

export interface AIProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  uploadPdfEnabled?: boolean
}

export interface StorageSettings {
  rootDir: string
}

export interface AppSettings {
  storage: StorageSettings
  ai: AIProviderConfig
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallInfo[]
  error?: boolean
  attachments?: ChatAttachment[]
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
