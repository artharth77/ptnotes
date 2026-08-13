import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import { toFile } from 'openai/uploads'
import type { AIProviderConfig, ChatMessage, ChatStreamEvent } from '@shared/types'
import { tools, type PTTool, type ToolContext } from './tools'
import { createClient } from './client'

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

export function buildSystemPrompt(
  activeProject: string,
  currentDate: string,
  skillsIndex?: string,
  activeNote?: string | null
): string {
  const skillsSection = skillsIndex
    ? `\nSkills:
You can load skills (named instruction documents) on demand when a task is relevant. Call the read_skill tool to load a skill's full content before applying it.
${skillsIndex}
`
    : ''
  const activeNoteSection = activeNote
    ? `- The note the user is currently viewing is "${activeNote}". When the user says "this note", "the current note", "the active note" or "check this note", read it with the read_note tool (omit the title argument to read the active note).
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
${activeNoteSection}- If the user references a project file as \`file:<filename>\` (for example \`file:report.pdf\`, \`file:notes.md\`, \`file:data.json\` or \`file:readme.txt\`), call the read_file tool to read that file before responding.
- If the user asks you to use a skill by name (for example \`Use the skill "name": …\`, optionally with the scope in parentheses), call the read_skill tool to load that skill before applying it.
- When the user asks you to find notes about a topic, call the search_notes tool.
- Quote the snippet returned by search_notes exactly as given; never paraphrase, reword, or summarize it.
- Whenever you mention an existing note by name in your reply, always link to it: [note name](note:note name). The link opens the note, so never return a bare note name without a link.
- Whenever you mention an existing todo by its text in your reply, always link to it: [todo text](todo:todo text).
- Whenever you mention an existing skill by name in your reply, always link to it: [skill name](skill:skill name). The link opens the skill's editor, so never return a bare skill name without a link.
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
    activeNoteId?: string | null
  ): Promise<void> {
    this.stopped = false
    this.abortController = undefined
    this.activeNoteId = activeNoteId ?? null
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

    if (history && history.length > 0) this.loadContext(history)

    const date = new Date().toISOString().slice(0, 10)
    await this.ensureSystemPrompt(date)
    this.messages.push({ role: 'user', content: userText })

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
    }
  }

  /** Send a PDF as a raw file attachment via the provider's Responses API (single-turn, no tools). */
  async uploadPdf(prompt: string, filename: string, base64: string): Promise<void> {
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

    try {
      const stream = await client.responses.create(
        {
          model: this.config.model,
          instructions: buildSystemPrompt(this.ctx.activeProject, date, skillsIndex),
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
      for await (const evt of stream) {
        if (this.stopped) return
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
          this.emit({
            type: 'error',
            error: `${msg || 'The provider rejected the PDF upload.'} — try Extract text mode instead.`
          })
          return
        }
        if (evt.type === 'response.completed') {
          break
        }
      }
      if (this.stopped) return
      this.messages.push({ role: 'assistant', content: content || '…' })
      this.emit({ type: 'message-end', messageId })
    } catch (err) {
      if (this.stopped) return
      const message = err instanceof Error ? err.message : String(err)
      this.emit({
        type: 'error',
        error: `${message} — try Extract text mode instead.`
      })
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
  private async ensureSystemPrompt(date: string): Promise<void> {
    const skillsIndex = await this.ctx.service.renderSkillsIndex(this.ctx.activeProject)
    let activeNote: string | null = null
    if (this.activeNoteId) {
      const notes = await this.ctx.service.listNotes(this.ctx.activeProject)
      activeNote = notes.find((n) => n.id === this.activeNoteId)?.name ?? null
    }
    const content = buildSystemPrompt(this.ctx.activeProject, date, skillsIndex, activeNote)
    const idx = this.messages.findIndex((m) => m.role === 'system')
    if (idx === -1) {
      this.messages.unshift({ role: 'system', content })
    } else {
      this.messages[idx] = { role: 'system', content }
    }
  }

  /** Run one streaming turn. Returns 'done' when the model produced a final answer. */
  private async runTurn(client: OpenAI, messageId: string): Promise<'done' | 'continue'> {
    const apiMessages = this.messages.map((m) => {
      const base = { role: m.role, content: m.content }
      if (m.role === 'assistant' && m.tool_calls) return { ...base, tool_calls: m.tool_calls }
      if (m.role === 'tool') return { ...base, tool_call_id: m.tool_call_id }
      return base
    }) as OpenAI.Chat.ChatCompletionMessageParam[]

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
    try {
      const toolList = await this.currentTools()
      stream = await client.chat.completions.create(
        {
          model: this.config.model,
          messages: apiMessages,
          tools: toolList.map((t) => t.definition),
          stream: true
        },
        { signal }
      )
    } catch (err) {
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

    let firstChunk = true
    let reasoningOpen = false
    try {
      for await (const chunk of stream) {
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
      if (this.stopped) return 'done'
      throw err
    }

    if (this.stopped) return 'done'

    if (toolCalls.length > 0) {
      const completed: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] = toolCalls.map(
        (tc) => ({
          id: tc.id ?? `call_${tc.index}`,
          type: 'function' as const,
          function: { name: tc.name ?? '', arguments: tc.args || '{}' }
        })
      )

      this.messages.push({ role: 'assistant', content: content || '', tool_calls: completed })
      this.emit({ type: 'message-end', messageId })

      for (const call of completed) {
        if (this.stopped) break
        const result = await this.executeTool(call)
        this.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result
        })
      }
      if (this.stopped) return 'done'
      return 'continue'
    }

    this.messages.push({ role: 'assistant', content: content || '…' })
    this.emit({ type: 'message-end', messageId })
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
      const result = await tool.execute(args, {
        ...this.ctx,
        activeNoteId: this.activeNoteId
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
}

export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}
