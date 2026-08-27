import OpenAI from 'openai'
import type {
  AIProviderConfig,
  AiTraceFile,
  AiTraceToolCall,
  ModuleChatMessage,
  ModuleEventType,
  ModuleRun,
  ModuleStepState,
  ToolCallInfo
} from '@shared/types'
import { tools as baseTools, type PTTool, type ToolContext } from '../ai/tools'
import { createClient } from '../ai/client'
import { isLocalEndpoint } from '../ai/chatSession'
import { AiTraceRecorder } from '../ai/trace'
import type { PTNotesService } from '../service/PTNotesService'
import type { RegisteredModule } from './types'
import { SKILLS_PREAMBLE } from '../ai/promptConstants'

const MAX_ITERATIONS = 30
const MAX_FINISH_HINTS = 2
const MAX_STREAM_RETRIES = 3
const STREAM_RETRY_DELAY_MS = 7000

function isRetryableStreamError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('stream idle timeout') || msg.includes('APIConnectionError')
}

type Role = 'system' | 'user' | 'assistant' | 'tool'

interface SessionMessage {
  role: Role
  content: string | null
  tool_calls?: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[]
  tool_call_id?: string
}

function toToolArgs(args: string | undefined): Record<string, unknown> {
  if (!args) return {}
  try {
    const parsed = JSON.parse(args) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function toolResultOk(content: string | null): boolean {
  if (!content) return false
  try {
    const parsed = JSON.parse(content) as { ok?: unknown }
    return !!(parsed && typeof parsed === 'object' && parsed.ok === true)
  } catch {
    return false
  }
}

/** Map the in-memory session messages to a persisted read-only transcript. */
function toTranscript(messages: SessionMessage[], tsStamps: number[]): ModuleChatMessage[] {
  const out: ModuleChatMessage[] = []
  const callById = new Map<string, ToolCallInfo>()
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const id = `m${i}`
    const ts = tsStamps[i] ?? Date.now()
    if (m.role === 'system') {
      out.push({ id, role: 'system', content: m.content, ts })
    } else if (m.role === 'user') {
      out.push({ id, role: 'user', content: m.content, ts })
    } else if (m.role === 'assistant') {
      const toolCalls: ToolCallInfo[] = (m.tool_calls ?? []).map((tc) => {
        const info: ToolCallInfo = {
          id: tc.id,
          name: tc.function?.name ?? '',
          args: toToolArgs(tc.function?.arguments),
          ok: false
        }
        callById.set(tc.id, info)
        return info
      })
      out.push({ id, role: 'assistant', content: m.content, toolCalls, ts })
    } else {
      const call = m.tool_call_id ? callById.get(m.tool_call_id) : undefined
      if (call) {
        call.ok = toolResultOk(m.content)
        call.result = m.content ?? undefined
      }
      out.push({ id, role: 'tool', name: call?.name ?? '', content: m.content, ts })
    }
  }
  return out
}

export interface ModuleNotifyEvent {
  type: ModuleEventType
  step?: ModuleStepState
  stepIndex?: number
  outputFile?: string
  outputFiles?: string[]
  error?: string
  summary?: string
  result?: string
  /** Full updated transcript, attached when `type === 'chat'`. */
  chat?: ModuleChatMessage[]
  /** Subagent tool-call lifecycle snapshot, attached when `type === 'tool'`. */
  toolCall?: ToolCallInfo
}

export interface ModuleRunnerOptions {
  service: PTNotesService
  activeProject: string
  module: RegisteredModule
  run: ModuleRun
  getConfig: () => Promise<AIProviderConfig>
  createClientFn?: (config: AIProviderConfig) => OpenAI
  notify: (run: ModuleRun, evt: ModuleNotifyEvent) => void
}

function buildSystemPrompt(
  module: RegisteredModule,
  activeProject: string,
  currentDate: string,
  skillsIndex?: string,
  expectResult?: string
): string {
  const skillsSection = skillsIndex ? `\nSkills:\n${SKILLS_PREAMBLE}\n${skillsIndex}\n` : ''
  const resultSection = expectResult
    ? `
RESULT REQUIREMENT:
The main chat agent is waiting for a result payload from you. Before you finish, you MUST call the submit_result tool with the exact result requested below:
${expectResult}
The result is a free-form string (JSON, markdown or plain text). Do not finish without submitting it.
`
    : ''
  return `You are the "${module.name}" module of PTNotes, a background subagent that produces a deliverable file for the user.

You operate inside a project. All tools target the current project.

Your task is described in the user message below. Work autonomously and produce the requested file.

SOURCE REFERENCES:
The task may reference sources inline — resolve them yourself with your own tools before doing the work:
- note:<notename> → call read_note
- file:<filename> → call read_file (Excel workbooks support the workspace= query)
- plan:<schedule id or name> (also written schedule:<...>) → call list_schedules to resolve the id when needed, then read_schedule
Never ask anyone for the content of a referenced source; fetch it with these tools. If a referenced source does not exist, say so in the final summary instead of inventing its content.

MANDATORY WORKFLOW:
1. Your FIRST action MUST be a call to the set_plan tool listing every step you will perform (2 to 10 steps). Do not skip this.
2. Then work through each step, calling update_step with the 1-based step index to mark it "running" when you begin and "done" when you finish. If a step fails, mark it "failed" (with a short detail) and either recover or stop with a clear explanation.
3. Use whatever tools you need — reading project notes/files, web research, and the module's own creation tools — to complete each step.
4. When every step is done, produce a short final summary. Mention the output file path. No extra commentary.
${resultSection}${skillsSection}
${module.systemPrompt ? `MODULE GUIDANCE:\n${module.systemPrompt}` : ''}
Current project: "${activeProject}".
Current date: ${currentDate}.`
}

export class ModuleRunner {
  private messages: SessionMessage[] = []
  private messageTs: number[] = []
  private readonly trace: AiTraceRecorder
  private readonly service: PTNotesService
  private readonly activeProject: string
  private readonly module: RegisteredModule
  private readonly run: ModuleRun
  private readonly getConfig: () => Promise<AIProviderConfig>
  private readonly notify: (run: ModuleRun, evt: ModuleNotifyEvent) => void
  private readonly clientFn: (config: AIProviderConfig) => OpenAI
  private config: AIProviderConfig = { baseUrl: '', apiKey: '', model: '' }
  private stopped = false
  private abortController: AbortController | undefined
  private planned = false
  private plannedHintSent = false
  private finishHintsSent = 0
  /** Assistant turn being streamed, shown live in the history overlay until pushed. */
  private partial: { id: string; content: string } | null = null

  constructor(opts: ModuleRunnerOptions) {
    this.service = opts.service
    this.activeProject = opts.activeProject
    this.module = opts.module
    this.run = opts.run
    this.getConfig = opts.getConfig
    this.notify = opts.notify
    this.clientFn = opts.createClientFn ? opts.createClientFn : createClient
    this.trace = new AiTraceRecorder({
      project: this.activeProject,
      key: this.run.runId,
      kind: 'module',
      append: (header, lines) =>
        this.service.appendModuleTrace(this.activeProject, this.run.runId, header, lines)
    })
  }

  get runId(): string {
    return this.run.runId
  }

  get snapshot(): ModuleRun {
    return this.run
  }

  /** Current conversation transcript, as exposed for the read-only history overlay. */
  get transcript(): ModuleChatMessage[] {
    return toTranscript(this.messages, this.messageTs)
  }

  /** Live raw AI trace (like `transcript`) so the overlay can show it mid-run. */
  get traceFile(): AiTraceFile {
    return this.trace.snapshot()
  }

  /** Persist the latest transcript to <project>/.data/modules/<runId>.chat.json (best-effort). */
  private persistChat(): void {
    void this.service
      .writeModuleChat(
        this.activeProject,
        this.run.runId,
        toTranscript(this.messages, this.messageTs)
      )
      .catch(() => {
        // persistence is best-effort; the in-memory transcript still serves live reads
      })
  }

  /** Append a session message, stamping its timestamp for the transcript. */
  private push(msg: SessionMessage): void {
    this.messages.push(msg)
    this.messageTs.push(Date.now())
  }

  stop(): void {
    this.stopped = true
    this.abortController?.abort()
  }

  async start(): Promise<void> {
    this.stopped = false
    this.abortController = undefined
    try {
      this.config = await this.getConfig()
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err))
      return
    }
    if (!this.config.model) {
      this.fail('AI model is not configured.')
      return
    }
    if (!this.config.apiKey && !isLocalEndpoint(this.config.baseUrl)) {
      this.fail('AI is not configured. Open AI settings to set your API key.')
      return
    }

    this.messages = []
    this.messageTs = []
    const skillsIndex = await this.service.renderSkillsIndex(this.activeProject)
    const currentDate = new Date().toISOString().slice(0, 10)
    const systemContent = buildSystemPrompt(
      this.module,
      this.activeProject,
      currentDate,
      skillsIndex,
      this.run.expectResult
    )
    this.push({ role: 'system', content: systemContent })
    this.push({ role: 'user', content: this.run.prompt })
    this.trace.append({ role: 'system', ts: Date.now(), content: systemContent })
    this.trace.append({ role: 'user', ts: Date.now(), content: this.run.prompt })
    this.touch({ type: 'status' })
    this.notifyChat()
    this.persistChat()

    const client = this.clientFn(this.config)
    try {
      const maxIterations = this.module.maxIterations ?? MAX_ITERATIONS
      for (let iter = 0; iter < maxIterations; iter++) {
        if (this.stopped) break
        const next = await this.runTurn(client)
        this.persistChat()
        await this.trace.flush()
        if (next === 'done') break
      }
    } catch (err) {
      if (!this.stopped) {
        const message = err instanceof Error ? err.message : String(err)
        this.fail(message)
      }
    }

    if (this.stopped && this.run.status !== 'done' && this.run.status !== 'failed') {
      this.run.status = 'cancelled'
      this.touch({ type: 'status' })
      this.persistChat()
    }
  }

  private toolList(): PTTool[] {
    // ask_user is chat-only (modules are background subagents — they must never pop dialogs).
    // create_skill/delete_skill are chat-only too (modules may read skills, never mutate them).
    const EXCLUDED = new Set(['ask_user', 'create_skill', 'delete_skill'])
    const base = baseTools.filter((t) => !EXCLUDED.has(t.definition.function.name))
    const framework = [setPlanTool(this), updateStepTool(this)]
    if (this.run.expectResult) framework.push(submitResultTool(this))
    return [...base, ...this.module.tools, ...framework]
  }

  /** Run one completion turn (streaming). Returns 'done' when the run produced a final answer. */
  private async runTurn(client: OpenAI): Promise<'done' | 'continue'> {
    const apiMessages = this.messages.map((m) => {
      const base = { role: m.role, content: m.content }
      if (m.role === 'assistant' && m.tool_calls) return { ...base, tool_calls: m.tool_calls }
      if (m.role === 'tool') return { ...base, tool_call_id: m.tool_call_id }
      return base
    }) as OpenAI.Chat.ChatCompletionMessageParam[]

    const tools = this.toolList()

    let content = ''
    let toolCalls: {
      index: number
      id?: string
      name?: string
      args: string
    }[] = []
    const receivingEmitted = new Set<number>()
    let finishReason: string | undefined
    let usage: unknown
    const partialId = `m${this.messages.length}`
    let startTs = Date.now()

    for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, STREAM_RETRY_DELAY_MS))
        if (this.stopped) return 'done'
        content = ''
        toolCalls = []
        receivingEmitted.clear()
        finishReason = undefined
        usage = undefined
        this.partial = null
      }

      startTs = Date.now()
      this.abortController = new AbortController()
      const signal = this.abortController.signal

      let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
      try {
        stream = await client.chat.completions.create(
          {
            model: this.config.model,
            messages: apiMessages,
            tools: tools.map((t) => t.definition),
            stream: true,
            stream_options: { include_usage: true }
          },
          { signal }
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (isRetryableStreamError(err) && attempt < MAX_STREAM_RETRIES) continue
        this.trace.append({
          role: 'assistant',
          ts: Date.now(),
          durationMs: Date.now() - startTs,
          model: this.config.model,
          baseUrl: this.config.baseUrl,
          endpoint: 'chat.completions',
          error: message
        })
        if (this.stopped) return 'done'
        throw err
      }

      try {
        for await (const chunk of stream) {
          if (this.stopped) break
          if (chunk.usage) usage = chunk.usage
          const finish = chunk.choices?.[0]?.finish_reason
          if (finish) finishReason = finish
          const delta = chunk.choices?.[0]?.delta
          if (!delta) continue
          if (delta.content) {
            content += delta.content
            this.partial = { id: partialId, content }
            this.notifyChat()
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!tc) continue
              const idx = tc.index ?? toolCalls.length
              const entry = (toolCalls[idx] ??= { index: idx, args: '' })
              if (tc.id) entry.id = tc.id
              if (tc.function?.name) entry.name = tc.function.name
              if (tc.function?.arguments) entry.args += tc.function.arguments
              if (entry.id && entry.name && !receivingEmitted.has(idx)) {
                receivingEmitted.add(idx)
                this.notifyToolEvent({
                  id: entry.id,
                  name: entry.name,
                  args: {},
                  status: 'receiving'
                })
              }
            }
          }
        }
        this.partial = null
      } catch (err) {
        this.partial = null
        const message = err instanceof Error ? err.message : String(err)
        if (isRetryableStreamError(err) && attempt < MAX_STREAM_RETRIES) continue
        this.trace.append({
          role: 'assistant',
          ts: Date.now(),
          durationMs: Date.now() - startTs,
          model: this.config.model,
          baseUrl: this.config.baseUrl,
          endpoint: 'chat.completions',
          ...(content ? { content } : {}),
          error: message
        })
        if (this.stopped) return 'done'
        throw err
      }

      break // success — exit retry loop
    }
    if (this.stopped) return 'done'

    const called = toolCalls
      .filter((tc) => tc.name)
      .map((tc): OpenAI.Chat.ChatCompletionMessageFunctionToolCall => ({
        id: tc.id ?? `call_${tc.index}`,
        type: 'function',
        function: { name: tc.name!, arguments: tc.args || '{}' }
      }))

    for (const call of called) {
      this.notifyToolEvent({
        id: call.id,
        name: call.function.name,
        args: toToolArgs(call.function.arguments),
        status: 'queued'
      })
    }
    const tracedToolCalls: AiTraceToolCall[] = called.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: toToolArgs(tc.function.arguments)
    }))

    this.trace.append({
      role: 'assistant',
      ts: Date.now(),
      durationMs: Date.now() - startTs,
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      endpoint: 'chat.completions',
      content,
      ...(tracedToolCalls.length > 0 ? { toolCalls: tracedToolCalls } : {}),
      ...(finishReason ? { finishReason } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(this.stopped ? { error: 'stopped' } : {})
    })

    if (called.length === 0) {
      // The model wants to finish with a text response.
      const planHint =
        'You must not finish yet. Your FIRST action must be the set_plan tool call listing the steps you will take for this task. Call set_plan now, then work through each step.'
      const submitHint =
        'You must not finish yet. The main chat agent is waiting for your result. Call the submit_result tool with the requested result now, then output your final summary.'
      const outputHint = `You must not finish yet. The deliverable file for this task has not been created. Call the ${this.module.outputTool} tool with the completed design now, then output your final summary.`
      if (!this.planned && !this.plannedHintSent) {
        this.plannedHintSent = true
        this.push({ role: 'assistant', content: content || '' })
        this.push({ role: 'user', content: planHint })
        this.trace.append({ role: 'user', ts: Date.now(), content: planHint })
        this.notifyChat()
        return 'continue'
      }
      if (!this.module.outputTool || this.run.outputFile) {
        // The deliverable is done (or the module has none). If the main chat asked for a
        // result payload, nudge the model to submit it before finishing.
        if (this.run.expectResult && !this.run.result && this.finishHintsSent < MAX_FINISH_HINTS) {
          this.finishHintsSent++
          this.push({ role: 'assistant', content: content || '' })
          this.push({ role: 'user', content: submitHint })
          this.trace.append({ role: 'user', ts: Date.now(), content: submitHint })
          this.notifyChat()
          return 'continue'
        }
        return this.finish(content)
      }
      // The module's deliverable file has not been created yet.
      if (this.finishHintsSent < MAX_FINISH_HINTS) {
        this.finishHintsSent++
        this.push({ role: 'assistant', content: content || '' })
        this.push({ role: 'user', content: outputHint })
        this.trace.append({ role: 'user', ts: Date.now(), content: outputHint })
        this.notifyChat()
        return 'continue'
      }
      this.fail(
        `The module finished without producing its output file. The ${this.module.outputTool} tool was never used successfully.`
      )
      return 'done'
    }

    // Planning is mandatory as the first tool call.
    if (!this.planned && !called.some((c) => c.function?.name === 'set_plan')) {
      const rejected = JSON.stringify({
        ok: false,
        error:
          'Your first tool call must be set_plan (with the 1-based steps list). Call set_plan now.'
      })
      this.push({ role: 'assistant', content: content || '', tool_calls: called })
      this.push({
        role: 'tool',
        tool_call_id: called[0]?.id ?? 'call_unplanned',
        content: rejected
      })
      for (const call of called) {
        this.notifyToolEvent({
          id: call.id,
          name: call.function.name,
          args: toToolArgs(call.function.arguments),
          ok: false,
          result: rejected,
          status: 'done'
        })
      }
      this.notifyChat()
      return 'continue'
    }

    this.push({ role: 'assistant', content: content || '', tool_calls: called })
    this.notifyChat()
    for (const call of called) {
      if (this.stopped) break
      const args = toToolArgs(call.function.arguments)
      this.notifyToolEvent({
        id: call.id,
        name: call.function.name,
        args,
        status: 'running'
      })
      const toolTs = Date.now()
      const result = await this.executeTool(call, tools)
      this.push({ role: 'tool', tool_call_id: call.id, content: result })
      this.notifyToolEvent({
        id: call.id,
        name: call.function.name,
        args,
        ok: toolResultOk(result),
        result,
        status: 'done'
      })
      this.notifyChat()
      this.trace.append({
        role: 'tool',
        ts: Date.now(),
        durationMs: Date.now() - toolTs,
        name: call.function.name,
        toolCallId: call.id,
        content: result
      })
    }
    if (this.stopped) return 'done'
    return 'continue'
  }

  private async executeTool(
    call: OpenAI.Chat.ChatCompletionMessageFunctionToolCall,
    tools: PTTool[]
  ): Promise<string> {
    let args: Record<string, unknown> = {}
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
    } catch {
      args = {}
    }
    const tool = tools.find((t) => t.definition.function.name === call.function.name)
    if (!tool) {
      return JSON.stringify({ ok: false, error: `Unknown tool: ${call.function.name}` })
    }
    const ctx: ToolContext = {
      service: this.service,
      activeProject: this.activeProject,
      confirm: async () => false
    }
    try {
      const raw = await tool.execute(args, ctx)
      this.captureOutput(raw)
      return raw
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ ok: false, error: message })
    }
  }

  /** Track every successful tool result that produced an output file path. */
  private captureOutput(result: string): void {
    try {
      const parsed = JSON.parse(result) as {
        ok?: boolean
        path?: string
        file?: string
        files?: string[]
      }
      if (!parsed.ok || typeof parsed.path !== 'string' || typeof parsed.file !== 'string') return
      const list = this.run.outputFiles ?? []
      const collected = [parsed.path]
      if (Array.isArray(parsed.files)) {
        for (const f of parsed.files) {
          if (typeof f === 'string' && f.trim() && !collected.includes(f)) collected.push(f)
        }
      }
      const merged = [...list]
      for (const p of collected) {
        if (p && !merged.includes(p)) merged.push(p)
      }
      if (merged.length === list.length) return
      this.run.outputFiles = merged
      this.run.outputFile = merged[0]
      this.run.updatedAt = Date.now()
      this.notify(this.run, {
        type: 'output',
        outputFile: merged[0],
        outputFiles: merged
      })
    } catch {
      // not a JSON tool result
    }
  }

  // ---- plan & step tracking (called by framework tools via closures) ----

  applyPlan(steps: string[]): string {
    if (this.planned) {
      return JSON.stringify({ ok: false, error: 'set_plan may only be called once.' })
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return JSON.stringify({ ok: false, error: 'set_plan requires a non-empty steps array.' })
    }
    this.planned = true
    const planTs = Date.now()
    this.run.steps = steps.map((raw, i) => {
      const name = String(raw).replace(/\s+/g, ' ').trim()
      return {
        id: `step-${i + 1}`,
        name: name || `Step ${i + 1}`,
        status: 'pending',
        updatedAt: planTs
      }
    })
    this.run.status = 'running'
    this.run.currentStep = 0
    this.run.startedAt ??= Date.now()
    this.touch({ type: 'status' })
    return JSON.stringify({
      ok: true,
      steps: this.run.steps.map(
        (s) => `${s.id} (1-based index ${Number(s.id.split('-')[1])}) : ${s.name}`
      )
    })
  }

  applyStep(indexRaw: unknown, statusRaw: unknown, detailRaw: unknown): string {
    if (!this.planned) {
      return JSON.stringify({ ok: false, error: 'Call set_plan before update_step.' })
    }
    const index = Number(indexRaw)
    if (!Number.isInteger(index) || index < 1 || index > this.run.steps.length) {
      return JSON.stringify({
        ok: false,
        error: `Invalid step index: ${indexRaw}. Use a 1-based index (1..${this.run.steps.length}).`
      })
    }
    const status = String(statusRaw || '')
    if (!['running', 'done', 'failed'].includes(status)) {
      return JSON.stringify({
        ok: false,
        error: `Invalid status: "${status}". Use running, done or failed.`
      })
    }
    const step = this.run.steps[index - 1]!
    step.status = status as ModuleStepState['status']
    step.updatedAt = Date.now()
    if (detailRaw) step.detail = String(detailRaw)
    if (status === 'running') this.run.currentStep = index - 1
    // A later step finishing implies every earlier step already completed: if a step
    // is marked done/failed while a previous step is left running/pending, promote
    // those previous steps to done so the plan stays consistent.
    if (status === 'done' || status === 'failed') {
      for (let i = 0; i < index - 1; i++) {
        const prev = this.run.steps[i]!
        if (prev.status === 'running' || prev.status === 'pending') {
          prev.status = 'done'
          prev.updatedAt = Date.now()
          this.notify(this.run, { type: 'step', step: prev, stepIndex: i })
        }
      }
    }
    this.run.updatedAt = Date.now()
    this.notify(this.run, { type: 'step', step, stepIndex: index - 1 })
    return JSON.stringify({ ok: true, index: index - 1, status })
  }

  private touch(evt: ModuleNotifyEvent): void {
    this.run.updatedAt = Date.now()
    this.notify(this.run, evt)
  }

  /** Broadcast a subagent tool-call lifecycle snapshot for the module panel (transient). */
  private notifyToolEvent(toolCall: ToolCallInfo): void {
    this.notify(this.run, { type: 'tool', toolCall })
  }

  /** Broadcast the current transcript so the history overlay can update live. */
  private notifyChat(): void {
    this.notify(this.run, { type: 'chat', chat: this.transcriptWithPartial() })
  }

  /** Transcript with an in-progress assistant turn appended so it streams live. */
  private transcriptWithPartial(): ModuleChatMessage[] {
    const chat = toTranscript(this.messages, this.messageTs)
    const partial = this.partial
    if (!partial) return chat
    const last = chat[chat.length - 1]
    // Replace the trailing placeholder (if any) with the accumulated partial content.
    if (last && last.role === 'assistant' && last.id === partial.id) {
      return [...chat.slice(0, -1), { ...last, content: partial.content }]
    }
    return [
      ...chat,
      { id: partial.id, role: 'assistant', content: partial.content, ts: Date.now() }
    ]
  }

  applyResult(resultRaw: unknown): string {
    const result = String(resultRaw ?? '').trim()
    if (!result) {
      return JSON.stringify({
        ok: false,
        error: 'submit_result requires a non-empty result string.'
      })
    }
    this.run.result = result
    this.run.updatedAt = Date.now()
    this.notify(this.run, { type: 'result', result })
    return JSON.stringify({ ok: true, submitted: true })
  }

  /** Mark the run done with the model's final summary; tidy the step plan. */
  private finish(content: string): 'done' {
    this.persistChat()
    if (content.trim()) {
      this.run.summary = content.trim()
      this.touch({ type: 'status', summary: content.trim() })
    }
    // The plan is complete: promote any steps left running/pending so the
    // status badge and the step list stay consistent.
    if (this.run.steps.length > 0) {
      const now = Date.now()
      for (const step of this.run.steps) {
        if (step.status !== 'done' && step.status !== 'failed') {
          step.status = 'done'
          step.updatedAt = now
        }
      }
      this.run.currentStep = this.run.steps.length - 1
    }
    this.run.status = 'done'
    this.run.finishedAt = Date.now()
    this.touch({
      type: 'done',
      summary: this.run.summary,
      ...(this.run.result ? { result: this.run.result } : {})
    })
    return 'done'
  }

  private fail(message: string): void {
    this.persistChat()
    this.run.status = 'failed'
    this.run.finishedAt = Date.now()
    this.run.error = message
    this.touch({ type: 'error', error: message })
  }
}

// ---- framework tools ----

function setPlanTool(runner: ModuleRunner): PTTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'set_plan',
        description:
          'MANDATORY first tool call: declare the steps you will perform for this module task, in order.',
        parameters: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              items: { type: 'string' },
              description: 'Readable name of each step (2 to 10 steps)'
            }
          },
          required: ['steps']
        }
      }
    },
    async execute(args) {
      const steps = Array.isArray(args.steps) ? args.steps.map(String).filter(Boolean) : []
      return runner.applyPlan(steps)
    }
  }
}

function updateStepTool(runner: ModuleRunner): PTTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'update_step',
        description:
          'Update the execution status of a planned step. Mark it "running" when you start it and "done" when you finish; use "failed" (with detail) if it cannot be completed.',
        parameters: {
          type: 'object',
          properties: {
            index: {
              type: 'number',
              description: '1-based index of the step in the plan'
            },
            status: {
              type: 'string',
              enum: ['running', 'done', 'failed'],
              description: 'New status for the step'
            },
            detail: { type: 'string', description: 'Optional short detail about the step' }
          },
          required: ['index', 'status']
        }
      }
    },
    async execute(args) {
      return runner.applyStep(args.index, args.status, args.detail)
    }
  }
}

function submitResultTool(runner: ModuleRunner): PTTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'submit_result',
        description:
          'Submit the result payload the main chat agent requested (the expect requirement in the system prompt). Must be called before finishing. The result is a free-form string: JSON, markdown or plain text.',
        parameters: {
          type: 'object',
          properties: {
            result: {
              type: 'string',
              description: 'The result payload in the exact format the main chat agent requested'
            }
          },
          required: ['result']
        }
      }
    },
    async execute(args) {
      return runner.applyResult(args.result)
    }
  }
}
