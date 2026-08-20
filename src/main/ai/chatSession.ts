import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import { toFile } from 'openai/uploads'
import type {
  AIProviderConfig,
  AiTraceEntry,
  AiTraceToolCall,
  ChatMessage,
  ChatStreamEvent
} from '@shared/types'
import { tools, type PTTool, type ToolContext } from './tools'
import { createClient } from './client'
import type { AiTraceRecorder } from './trace'

type Role = 'system' | 'user' | 'assistant' | 'tool'

interface SessionMessage {
  role: Role
  content: string | null
  tool_calls?: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[]
  tool_call_id?: string
  name?: string
}

export type StreamEmitter = (event: ChatStreamEvent) => void

/** Resolve the tool list to expose to the model. Re-evaluated on every turn so
 * runtime state changes (e.g. enabled modules) take effect immediately. */
export type ToolsProvider = () => Promise<PTTool[]>

const MAX_TOOL_ITERATIONS = 12

function toToolArgs(args: string | undefined): Record<string, unknown> {
  if (!args) return {}
  try {
    const parsed = JSON.parse(args) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function buildSystemPrompt(
  activeProject: string,
  currentDate: string,
  skillsIndex?: string
): string {
  const skillsSection = skillsIndex
    ? `\nSkills:
You can load skills (named instruction documents) on demand when a task is relevant. Call the read_skill tool to load a skill's full content before applying it.
${skillsIndex}
`
    : ''
  return `You are PTNotes assistant, an automation and research assistant inside a markdown notes + todo desktop app.

You operate inside a project. The currently active project is "${activeProject}". Use it by default; you may target other projects by passing the "project" argument to a tool.

You can create and update notes (markdown), manage the todo list, and research the web.

Guidelines:
- When the user asks to create a note or add todos, do it with the tools and confirm concisely.
- When the user asks for up-to-date or factual information, use web_search (and web_fetch for detail) instead of relying only on your own knowledge.
- After researching, if the user wants it saved, write a well-structured markdown note via create_note/update_note.
- If the user references a note as \`note:<notename>\` (for example \`note:meeting-notes\`), call the read_note tool to read that specific note before responding.
- If the user references a project file as \`file:<filename>\` (for example \`file:report.pdf\`, \`file:notes.md\`, \`file:data.json\` or \`file:readme.txt\`), call the read_file tool to read that file before responding.
- If the user asks you to use a skill by name (for example \`Use the skill "name": …\`, optionally with the scope in parentheses), call the read_skill tool to load that skill before applying it.
- When the user asks you to find notes about a topic, call the search_notes tool.
- When you need user input — a choice, a detail, or confirmation — before you can proceed, call ask_user with your questions. You may ask several questions in a single call; the user answers them all at once. Only ask when genuinely needed.
- When a task can be split into parallel deliverables, delegate each part to a background module: call start_module for each (passing the \`expect\` argument to specify the result payload the module must submit back), then call wait_modules with all the returned runIds and continue with the results. Do NOT call wait_modules when you do not need the module output.
- Quote the snippet returned by search_notes exactly as given; never paraphrase, reword, or summarize it.
- Whenever you mention an existing note by name in your reply, always link to it: [note name](note:note name). The link opens the note, so never return a bare note name without a link.
- Whenever you mention an existing todo from the project's todo list by its text in your reply, always link to it: [todo text](todo:todo text). Do NOT link tasks that belong to a schedule/plan — plan tasks have no link, so just mention their text plainly.
- Whenever you mention an existing skill by name in your reply, always link to it: [skill name](skill:skill name). The link opens the skill's editor, so never return a bare skill name without a link.
- Whenever you mention an existing schedule/plan by name in your reply, always link to it: [plan name](plan:plan name) or [plan name](schedule:plan name). The link opens the schedule, so never return a bare plan name without a link.
- Keep replies short and actionable.
${skillsSection}Current date: ${currentDate}.`
}

export class ChatSession {
  private messages: SessionMessage[] = []
  private readonly getConfig: () => Promise<AIProviderConfig>
  private readonly ctx: ToolContext
  private readonly emit: StreamEmitter
  private config: AIProviderConfig
  private stopped = false
  private abortController: AbortController | undefined
  private readonly toolsProvider?: ToolsProvider
  private activeNoteId: string | null = null
  private activeScheduleId: string | null = null
  private lastActiveNoteName: string | null = null
  private lastActiveScheduleName: string | null = null
  private trace: AiTraceRecorder | undefined

  constructor(
    getConfig: () => Promise<AIProviderConfig>,
    ctx: ToolContext,
    emit: StreamEmitter,
    toolsProvider?: ToolsProvider
  ) {
    this.getConfig = getConfig
    this.ctx = ctx
    this.emit = emit
    this.toolsProvider = toolsProvider
    this.config = { baseUrl: '', apiKey: '', model: '' }
  }

  private async currentTools(): Promise<PTTool[]> {
    const extra = this.toolsProvider ? await this.toolsProvider() : []
    return extra.length > 0 ? [...tools, ...extra] : tools
  }

  async send(
    userText: string,
    history?: ChatMessage[],
    activeNoteId?: string | null,
    activeScheduleId?: string | null,
    trace?: AiTraceRecorder
  ): Promise<void> {
    this.stopped = false
    this.abortController = undefined
    this.activeNoteId = activeNoteId ?? null
    this.activeScheduleId = activeScheduleId ?? null
    this.config = await this.getConfig()
    if (!this.config.apiKey && !isLocalEndpoint(this.config.baseUrl)) {
      this.emit({
        type: 'error',
        error: 'AI is not configured. Open AI settings to set your API key.'
      })
      return
    }
    if (!this.config.model) {
      this.emit({ type: 'error', error: 'AI model is not configured.' })
      return
    }

    if (history && history.length > 0 && this.messages.length === 0) {
      this.loadContext(history)
    }

    const date = new Date().toISOString().slice(0, 10)
    this.trace = trace
    const systemContent = await this.ensureSystemPrompt(date)
    this.traceSystem(systemContent)
    const contextSuffix = await this.buildActiveContextSuffix()
    this.messages.push({ role: 'user', content: `${userText}${contextSuffix}` })
    this.traceUser(`${userText}${contextSuffix}`)

    const client = createClient(this.config)
    const messageId = randomUUID()

    try {
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        if (this.stopped) break
        const result = await this.runTurn(client, messageId)
        if (result === 'done') break
      }
    } catch (err) {
      if (this.stopped) return
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ type: 'error', error: message })
    } finally {
      await this.trace?.flush()
      this.trace = undefined
    }
  }

  /** Send a PDF as a raw file attachment via the provider's Responses API (single-turn, no tools). */
  async uploadPdf(
    prompt: string,
    filename: string,
    base64: string,
    trace?: AiTraceRecorder
  ): Promise<void> {
    this.stopped = false
    this.abortController = undefined
    this.config = await this.getConfig()
    if (!this.config.apiKey && !isLocalEndpoint(this.config.baseUrl)) {
      this.emit({
        type: 'error',
        error: 'AI is not configured. Open AI settings to set your API key.'
      })
      return
    }
    if (!this.config.model) {
      this.emit({ type: 'error', error: 'AI model is not configured.' })
      return
    }

    const cleanPrompt = prompt.trim() || 'Summarize this PDF and highlight its key points.'
    const date = new Date().toISOString().slice(0, 10)
    const skillsIndex = await this.ctx.service.renderSkillsIndex(this.ctx.activeProject)
    this.trace = trace
    this.traceSystem(buildSystemPrompt(this.ctx.activeProject, date, skillsIndex))
    this.messages.push({ role: 'user', content: cleanPrompt })

    const client = createClient(this.config)
    const messageId = randomUUID()
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    const buffer = Buffer.from(base64.replace(/^data:[^,]+;base64,/, ''), 'base64')
    let filePart: {
      type: 'input_file'
      filename: string
      file_id?: string
      file_data?: string
    } = {
      type: 'input_file',
      filename,
      file_data: `data:application/pdf;base64,${buffer.toString('base64')}`
    }
    try {
      const uploaded = await client.files.create({
        file: await toFile(buffer, filename),
        purpose: 'assistants'
      })
      filePart = { type: 'input_file', filename, file_id: uploaded.id }
    } catch {
      // provider without a Files API: fall back to inline base64 in file_data
    }

    const startTs = Date.now()
    const instructions = buildSystemPrompt(this.ctx.activeProject, date, skillsIndex)
    // The raw PDF base64 is never traced — only the resolved file id / filename.
    this.traceUser(cleanPrompt, { filename, file_id: filePart.file_id })

    try {
      const stream = await client.responses.create(
        {
          model: this.config.model,
          instructions,
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: cleanPrompt }, filePart]
            }
          ],
          stream: true
        },
        { signal }
      )

      let content = ''
      let started = false
      let failedMessage: string | null = null
      let usage: unknown
      for await (const evt of stream) {
        if (this.stopped) break
        if (evt.type === 'response.output_text.delta') {
          if (!started) {
            started = true
            this.emit({ type: 'message-start', messageId })
          }
          content += evt.delta
          this.emit({ type: 'content', messageId, content: evt.delta })
        }
        if (evt.type === 'response.failed') {
          const msg = evt.response.error?.message
          failedMessage = msg || 'The provider rejected the PDF upload.'
          this.emit({
            type: 'error',
            error: `${failedMessage} — try Extract text mode instead.`
          })
          break
        }
        if (evt.type === 'response.completed') {
          usage = evt.response?.usage
          break
        }
      }
      this.trace?.append({
        role: 'assistant',
        ts: Date.now(),
        durationMs: Date.now() - startTs,
        model: this.config.model,
        baseUrl: this.config.baseUrl,
        endpoint: 'responses',
        file: { filename, file_id: filePart.file_id },
        ...(content ? { content } : {}),
        ...(failedMessage ? { error: failedMessage } : {}),
        ...(this.stopped && !failedMessage ? { error: 'stopped' } : {}),
        ...(usage !== undefined ? { usage } : {})
      })
      if (this.stopped || failedMessage) return
      this.messages.push({ role: 'assistant', content: content || '…' })
      this.emit({ type: 'message-end', messageId, ...(usage !== undefined ? { usage } : {}) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.trace?.append({
        role: 'assistant',
        ts: Date.now(),
        durationMs: Date.now() - startTs,
        model: this.config.model,
        baseUrl: this.config.baseUrl,
        endpoint: 'responses',
        file: { filename, file_id: filePart.file_id },
        error: message
      })
      if (this.stopped) return
      this.emit({
        type: 'error',
        error: `${message} — try Extract text mode instead.`
      })
    } finally {
      await this.trace?.flush()
      this.trace = undefined
    }
  }

  stop(): void {
    this.stopped = true
    this.abortController?.abort()
  }

  clear(): void {
    this.messages.length = 0
  }

  /**
   * Seed the conversation from the renderer's displayed thread (e.g. after opening a
   * historical session). Rebuilds the internal message list from persisted ChatMessages,
   * preserving assistant tool calls and their results so context continues correctly.
   */
  loadContext(history: ChatMessage[]): void {
    this.messages = ChatSession.fromPersisted(history)
  }

  private static fromPersisted(history: ChatMessage[]): SessionMessage[] {
    const out: SessionMessage[] = []
    for (const m of history) {
      if (m.role === 'user') {
        out.push({ role: 'user', content: m.content })
        continue
      }
      if (m.role !== 'assistant') continue
      const toolCalls = (m.toolCalls ?? [])
        .filter((tc) => tc.id)
        .map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.args && Object.keys(tc.args).length > 0 ? JSON.stringify(tc.args) : '{}'
          }
        }))
      const hasContent = m.content && m.content.trim().length > 0
      if (!hasContent && toolCalls.length === 0) continue
      out.push({
        role: 'assistant',
        content: hasContent ? m.content : '',
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
      })
      for (const tc of m.toolCalls ?? []) {
        if (tc.id && tc.result != null) {
          out.push({ role: 'tool', tool_call_id: tc.id, content: tc.result })
        }
      }
    }
    return out
  }

  /** (Re)build the system message on every send so mid-session changes (e.g. skills) apply. */
  private async ensureSystemPrompt(date: string): Promise<string> {
    const skillsIndex = await this.ctx.service.renderSkillsIndex(this.ctx.activeProject)
    const content = buildSystemPrompt(this.ctx.activeProject, date, skillsIndex)
    const idx = this.messages.findIndex((m) => m.role === 'system')
    if (idx === -1) {
      this.messages.unshift({ role: 'system', content })
    } else {
      this.messages[idx] = { role: 'system', content }
    }
    return content
  }

  /** Build a context suffix for the user message with the active note/schedule only when it changed since the last send. */
  private async buildActiveContextSuffix(): Promise<string> {
    const notes = this.activeNoteId ? await this.ctx.service.listNotes(this.ctx.activeProject) : []
    const activeNoteName =
      (this.activeNoteId && notes.find((n) => n.id === this.activeNoteId)?.name) ?? null
    const schedules = this.activeScheduleId
      ? await this.ctx.service.listSchedules(this.ctx.activeProject)
      : []
    const activeScheduleName =
      (this.activeScheduleId && schedules.find((s) => s.id === this.activeScheduleId)?.name) ?? null

    const parts: string[] = []
    if (activeNoteName && activeNoteName !== this.lastActiveNoteName) {
      parts.push(`[Context] Active note: "${activeNoteName}".`)
    }
    if (activeScheduleName && activeScheduleName !== this.lastActiveScheduleName) {
      parts.push(`[Context] Active schedule: "${activeScheduleName}".`)
    }

    this.lastActiveNoteName = activeNoteName
    this.lastActiveScheduleName = activeScheduleName

    return parts.length > 0 ? ` ${parts.join(' ')}` : ''
  }

  /** Run one streaming turn. Returns 'done' when the model produced a final answer. */
  private async runTurn(client: OpenAI, messageId: string): Promise<'done' | 'continue'> {
    const apiMessages = this.messages.map((m) => {
      const base = { role: m.role, content: m.content }
      if (m.role === 'assistant' && m.tool_calls) return { ...base, tool_calls: m.tool_calls }
      if (m.role === 'tool') return { ...base, tool_call_id: m.tool_call_id }
      return base
    }) as OpenAI.Chat.ChatCompletionMessageParam[]

    const toolList = await this.currentTools()
    const startTs = Date.now()

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
    try {
      stream = await client.chat.completions.create(
        {
          model: this.config.model,
          messages: apiMessages,
          tools: toolList.map((t) => t.definition),
          stream: true,
          stream_options: { include_usage: true }
        },
        { signal }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.traceAssistant({
        durationMs: Date.now() - startTs,
        error: message
      })
      if (this.stopped) return 'done'
      throw err
    }

    let content = ''
    const toolCalls: {
      index: number
      id?: string
      name?: string
      args: string
    }[] = []
    let finishReason: string | undefined
    let usage: unknown

    let firstChunk = true
    let reasoningOpen = false
    let reasoning = ''
    try {
      for await (const chunk of stream) {
        if (chunk.usage) usage = chunk.usage
        const finish = chunk.choices?.[0]?.finish_reason
        if (finish) finishReason = finish
        if (this.stopped) break
        const delta = chunk.choices?.[0]?.delta as
          | (OpenAI.Chat.ChatCompletionChunk.Choice.Delta & { reasoning_content?: string })
          | undefined
        if (!delta) continue
        if (firstChunk) {
          firstChunk = false
          this.emit({ type: 'message-start', messageId })
        }
        if (delta.reasoning_content) {
          if (!reasoningOpen) {
            reasoningOpen = true
            this.emit({ type: 'content', messageId, content: '<think>' })
          }
          reasoning += delta.reasoning_content
          this.emit({ type: 'content', messageId, content: delta.reasoning_content })
        }
        if (delta.content) {
          if (reasoningOpen) {
            reasoningOpen = false
            this.emit({ type: 'content', messageId, content: '</think>\n\n' })
          }
          content += delta.content
          this.emit({ type: 'content', messageId, content: delta.content })
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!tc) continue
            const idx = tc.index ?? toolCalls.length
            const entry = (toolCalls[idx] ??= { index: idx, args: '' })
            if (tc.id) entry.id = tc.id
            if (tc.function?.name) entry.name = tc.function.name
            if (tc.function?.arguments) entry.args += tc.function.arguments
          }
        }
      }
      if (reasoningOpen) {
        reasoningOpen = false
        this.emit({ type: 'content', messageId, content: '</think>' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.traceAssistant({
        durationMs: Date.now() - startTs,
        ...(content ? { content } : {}),
        ...(reasoning ? { reasoning } : {}),
        error: message
      })
      if (this.stopped) return 'done'
      throw err
    }

    const tracedToolCalls: AiTraceToolCall[] = toolCalls
      .filter((tc) => tc.name)
      .map((tc) => ({
        id: tc.id ?? `call_${tc.index}`,
        name: tc.name!,
        args: toToolArgs(tc.args)
      }))

    this.traceAssistant({
      durationMs: Date.now() - startTs,
      ...(content ? { content } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(tracedToolCalls.length > 0 ? { toolCalls: tracedToolCalls } : {}),
      ...(finishReason ? { finishReason } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(this.stopped ? { error: 'stopped' } : {})
    })

    if (toolCalls.length > 0) {
      const completed: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] = toolCalls.map(
        (tc) => ({
          id: tc.id ?? `call_${tc.index}`,
          type: 'function' as const,
          function: { name: tc.name ?? '', arguments: tc.args || '{}' }
        })
      )

      this.messages.push({ role: 'assistant', content: content || '', tool_calls: completed })
      this.emit({ type: 'message-end', messageId, ...(usage !== undefined ? { usage } : {}) })

      for (const call of completed) {
        if (this.stopped) break
        const toolTs = Date.now()
        const result = await this.executeTool(call)
        this.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result
        })
        this.traceTool(call.function.name, call.id, result, Date.now() - toolTs)
      }
      if (this.stopped) return 'done'
      return 'continue'
    }

    this.messages.push({ role: 'assistant', content: content || '…' })
    this.emit({ type: 'message-end', messageId, ...(usage !== undefined ? { usage } : {}) })
    return 'done'
  }

  private async executeTool(
    call: OpenAI.Chat.ChatCompletionMessageFunctionToolCall
  ): Promise<string> {
    let args: Record<string, unknown> = {}
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
    } catch {
      args = {}
    }

    const tool = (await this.currentTools()).find(
      (t) => t.definition.function.name === call.function.name
    )
    if (!tool) {
      const result = JSON.stringify({ ok: false, error: `Unknown tool: ${call.function.name}` })
      this.emitTool(call.function.name, args, false, result)
      return result
    }

    try {
      if (call.function.name === 'wait_modules') {
        const runIds = Array.isArray(args.runIds) ? args.runIds.map(String) : []
        this.emit({ type: 'waiting', runIds })
      }
      const result = await tool.execute(args, {
        ...this.ctx,
        activeNoteId: this.activeNoteId,
        isStopped: () => this.stopped
      })
      this.emitTool(call.function.name, args, true, result)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const result = JSON.stringify({ ok: false, error: message })
      this.emitTool(call.function.name, args, false, result)
      return result
    }
  }

  private emitTool(name: string, args: Record<string, unknown>, ok: boolean, result: string): void {
    this.emit({
      type: 'tool',
      toolCall: { id: randomUUID(), name, args, ok, result }
    })
  }

  // ---- raw trace recording (readable conversation log: system/user/assistant/tool) ----

  private traceSystem(content: string): void {
    this.trace?.appendSystem(content)
  }

  private traceUser(content: string, file?: { filename: string; file_id?: string }): void {
    this.trace?.append({ role: 'user', ts: Date.now(), content, ...(file ? { file } : {}) })
  }

  private traceAssistant(
    partial: Omit<AiTraceEntry, 'seq' | 'role' | 'ts'>
  ): AiTraceEntry | undefined {
    if (!this.trace) return undefined
    return this.trace.append({
      role: 'assistant',
      ts: Date.now(),
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      endpoint: 'chat.completions',
      ...partial
    })
  }

  private traceTool(name: string, toolCallId: string, content: string, durationMs: number): void {
    this.trace?.append({ role: 'tool', ts: Date.now(), name, toolCallId, content, durationMs })
  }
}

export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}
