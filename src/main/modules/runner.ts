import OpenAI from 'openai'
import type {
  AIProviderConfig,
  ModuleChatMessage,
  ModuleEventType,
  ModuleRun,
  ModuleStepState,
  ToolCallInfo
} from '@shared/types'
import { tools as baseTools, type PTTool, type ToolContext } from '../ai/tools'
import { createClient } from '../ai/client'
import { isLocalEndpoint } from '../ai/chatSession'
import type { PTNotesService } from '../service/PTNotesService'
import type { RegisteredModule } from './types'

const MAX_ITERATIONS = 30
const MAX_FINISH_HINTS = 2

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
function toTranscript(messages: SessionMessage[]): ModuleChatMessage[] {
  const out: ModuleChatMessage[] = []
  const callById = new Map<string, ToolCallInfo>()
  const ts = Date.now()
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const id = `m${i}`
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
  expectResult?: string
): string {
  const resultSection = expectResult
    ? `
RESULT REQUIREMENT:
The main chat agent is waiting for a result payload from you. Before you finish, you MUST call the submit_result tool with the exact result requested below:
${expectResult}
The result is a free-form string (JSON, markdown or plain text). Do not finish without submitting it.
`
    : ''
  return `You are the "${module.name}" module of PTNotes, a background subagent that produces a deliverable file for the user.

You operate inside a project. The currently active project is "${activeProject}". Use it by default.

Your task is described in the user message below. Work autonomously and produce the requested file.

MANDATORY WORKFLOW:
1. Your FIRST action MUST be a call to the set_plan tool listing every step you will perform (2 to 10 steps). Do not skip this.
2. Then work through each step, calling update_step with the 1-based step index to mark it "running" when you begin and "done" when you finish. If a step fails, mark it "failed" (with a short detail) and either recover or stop with a clear explanation.
3. Use whatever tools you need — reading project notes/files, web research, and the module's own creation tools — to complete each step.
4. When every step is done, produce a short final summary. Mention the output file path. No extra commentary.
${resultSection}
${module.systemPrompt ? `MODULE GUIDANCE:\n${module.systemPrompt}` : ''}`
}

export class ModuleRunner {
  private messages: SessionMessage[] = []
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

  constructor(opts: ModuleRunnerOptions) {
    this.service = opts.service
    this.activeProject = opts.activeProject
    this.module = opts.module
    this.run = opts.run
    this.getConfig = opts.getConfig
    this.notify = opts.notify
    this.clientFn = opts.createClientFn ? opts.createClientFn : createClient
  }

  get runId(): string {
    return this.run.runId
  }

  get snapshot(): ModuleRun {
    return this.run
  }

  /** Current conversation transcript, as exposed for the read-only history overlay. */
  get transcript(): ModuleChatMessage[] {
    return toTranscript(this.messages)
  }

  /** Persist the latest transcript to <project>/.data/modules/<runId>.chat.json (best-effort). */
  private persistChat(): void {
    void this.service
      .writeModuleChat(this.activeProject, this.run.runId, toTranscript(this.messages))
      .catch(() => {
        // persistence is best-effort; the in-memory transcript still serves live reads
      })
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
    this.messages.push({
      role: 'system',
      content: buildSystemPrompt(this.module, this.activeProject, this.run.expectResult)
    })
    this.messages.push({ role: 'user', content: this.run.prompt })
    this.touch({ type: 'status' })
    this.persistChat()

    const client = this.clientFn(this.config)
    try {
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        if (this.stopped) break
        const next = await this.runTurn(client)
        this.persistChat()
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
    const base = baseTools.filter((t) => t.definition.function.name !== 'ask_user')
    const framework = [setPlanTool(this), updateStepTool(this)]
    if (this.run.expectResult) framework.push(submitResultTool(this))
    return [...base, ...this.module.tools, ...framework]
  }

  /** Run one completion turn. Returns 'done' when the run produced a final answer. */
  private async runTurn(client: OpenAI): Promise<'done' | 'continue'> {
    const apiMessages = this.messages.map((m) => {
      const base = { role: m.role, content: m.content }
      if (m.role === 'assistant' && m.tool_calls) return { ...base, tool_calls: m.tool_calls }
      if (m.role === 'tool') return { ...base, tool_call_id: m.tool_call_id }
      return base
    }) as OpenAI.Chat.ChatCompletionMessageParam[]

    const tools = this.toolList()
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    let reply: OpenAI.Chat.ChatCompletion
    try {
      reply = await client.chat.completions.create(
        {
          model: this.config.model,
          messages: apiMessages,
          tools: tools.map((t) => t.definition),
          stream: false
        },
        { signal }
      )
    } catch (err) {
      if (this.stopped) return 'done'
      throw err
    }
    if (this.stopped) return 'done'

    const message = reply.choices?.[0]?.message
    const content = message?.content ?? ''
    const called = (message?.tool_calls ?? []).filter(
      (tc): tc is OpenAI.Chat.ChatCompletionMessageFunctionToolCall =>
        'function' in tc && typeof tc.function?.name === 'string'
    )

    if (called.length === 0) {
      // The model wants to finish with a text response.
      if (!this.planned && !this.plannedHintSent) {
        this.plannedHintSent = true
        this.messages.push({ role: 'assistant', content: content || '' })
        this.messages.push({
          role: 'user',
          content:
            'You must not finish yet. Your FIRST action must be the set_plan tool call listing the steps you will take for this task. Call set_plan now, then work through each step.'
        })
        return 'continue'
      }
      if (!this.module.outputTool || this.run.outputFile) {
        // The deliverable is done (or the module has none). If the main chat asked for a
        // result payload, nudge the model to submit it before finishing.
        if (this.run.expectResult && !this.run.result && this.finishHintsSent < MAX_FINISH_HINTS) {
          this.finishHintsSent++
          this.messages.push({ role: 'assistant', content: content || '' })
          this.messages.push({
            role: 'user',
            content:
              'You must not finish yet. The main chat agent is waiting for your result. Call the submit_result tool with the requested result now, then output your final summary.'
          })
          return 'continue'
        }
        return this.finish(content)
      }
      // The module's deliverable file has not been created yet.
      if (this.finishHintsSent < MAX_FINISH_HINTS) {
        this.finishHintsSent++
        this.messages.push({ role: 'assistant', content: content || '' })
        this.messages.push({
          role: 'user',
          content: `You must not finish yet. The deliverable file for this task has not been created. Call the ${this.module.outputTool} tool with the completed design now, then output your final summary.`
        })
        return 'continue'
      }
      this.fail(
        `The module finished without producing its output file. The ${this.module.outputTool} tool was never used successfully.`
      )
      return 'done'
    }

    // Planning is mandatory as the first tool call.
    if (!this.planned && !called.some((c) => c.function?.name === 'set_plan')) {
      this.messages.push({ role: 'assistant', content: content || '', tool_calls: called })
      this.messages.push({
        role: 'tool',
        tool_call_id: called[0]?.id ?? 'call_unplanned',
        content: JSON.stringify({
          ok: false,
          error:
            'Your first tool call must be set_plan (with the 1-based steps list). Call set_plan now.'
        })
      })
      return 'continue'
    }

    this.messages.push({ role: 'assistant', content: content || '', tool_calls: called })
    for (const call of called ?? []) {
      if (this.stopped) break
      const result = await this.executeTool(call, tools)
      this.messages.push({ role: 'tool', tool_call_id: call.id, content: result })
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
