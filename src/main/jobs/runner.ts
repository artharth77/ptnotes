import type OpenAI from 'openai'
import type { AIConfigStore } from '../ai/config'
import { createClient } from '../ai/client'
import { AiTraceRecorder } from '../ai/trace'
import type { PTTool, ToolContext } from '../ai/tools'
import { buildStartModuleTool, buildWaitModulesTool } from '../modules/tool'
import type { ModuleRunManager } from '../modules/runs'
import type { ModuleRegistry as Registry } from '../modules/registry'
import type { JobsStore } from './db'
import type { PTNotesService } from '../service/PTNotesService'
import type { ScheduleJob } from '@shared/scheduleJobs'
import { ALL_DAYS, isNoResponse } from '@shared/scheduleJobs'
import type { ScheduleJobRun, ScheduleJobRunStatus } from '@shared/scheduleJobs'

const MAX_TOOL_TURNS = 8

export interface JobRunnerDeps {
  project: string
  service: PTNotesService
  configStore: AIConfigStore
  moduleManager: ModuleRunManager
  moduleRegistry: Registry
  disabledModules: string[]
  db: JobsStore
  /** Abort signal shared with the app shutdown path. */
  signal: AbortSignal
  /** DB key under which this run's trace file is stored (defaults to `project`).
   * Global fan-out children trace into the root-level jobs DB. */
  traceProject?: string
}

export interface JobRunResult {
  run: ScheduleJobRun
  /** Final AI answer; `notice` is the text worth notifying (already trimmed). */
  status: ScheduleJobRunStatus
  statusNotice?: string
  statusError?: string
  notify: boolean
  /** Raw final answer (trimmed) when the run reached a final text, regardless of
   * the NO RESPONSE suppression. */
  finalText?: string
}

export class ScheduleJobRunner {
  constructor(private readonly deps: JobRunnerDeps) {}

  private get project(): string {
    return this.deps.project
  }

  async run(job: ScheduleJob, run: ScheduleJobRun): Promise<JobRunResult> {
    const cfg = await this.deps.configStore.load()
    if (!cfg.model) {
      return this.fail(run, 'AI model is not configured. Open AI settings and choose a model.')
    }
    if (!cfg.apiKey && !isLocalEndpoint(cfg.baseUrl)) {
      return this.fail(run, 'AI is not configured. Open AI settings to set your API key.')
    }

    const traceKey = this.deps.traceProject ?? this.project
    const trace = new AiTraceRecorder({
      project: this.project,
      key: run.runId,
      kind: 'module',
      append: (header, lines) => this.deps.db.appendRunTrace(traceKey, run.runId, header, lines)
    })

    const ctx: ToolContext = {
      service: this.deps.service,
      activeProject: this.project,
      confirm: async () => true,
      isStopped: () => this.deps.signal.aborted
    }
    const tools: PTTool[] = [
      buildStartModuleTool(
        this.deps.moduleManager,
        this.deps.moduleRegistry,
        this.deps.disabledModules
      ),
      buildWaitModulesTool(this.deps.moduleManager)
    ]

    const sys = this.buildSystemPrompt(job)
    interface RunMsg {
      role: 'system' | 'user' | 'assistant' | 'tool'
      content: string
      toolCalls?: OpenAI.Chat.ChatCompletionMessageToolCall[]
      toolCallId?: string
    }
    const messages: RunMsg[] = [
      { role: 'system', content: sys },
      { role: 'user', content: job.prompt }
    ]
    trace.appendSystem(sys)
    trace.append({ role: 'user', ts: Date.now(), content: job.prompt })

    const client = createClient(cfg)
    let finalText = ''
    try {
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const started = Date.now()
        const apiMessages = messages.map((m) => {
          const base = { role: m.role, content: m.content }
          if (m.role === 'assistant' && m.toolCalls) {
            return { ...base, tool_calls: m.toolCalls }
          }
          if (m.role === 'tool' && m.toolCallId) {
            return { ...base, tool_call_id: m.toolCallId }
          }
          return base
        }) as OpenAI.Chat.Completions.ChatCompletionMessageParam[]
        const completion = await client.chat.completions.create(
          {
            model: cfg.model,
            messages: apiMessages,
            stream: false,
            tools: tools.map((t) => t.definition)
          },
          { signal: this.deps.signal }
        )
        const msg = completion.choices[0]?.message
        rawTrace(msg, trace, started, cfg.model)
        const raw = msg?.content ?? ''
        const toolCalls = (msg?.tool_calls ?? []).filter(
          (c): c is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => 'function' in c
        )
        if (toolCalls.length > 0) {
          messages.push({ role: 'assistant', content: msg?.content ?? '', toolCalls })
          for (const call of toolCalls) {
            if (this.deps.signal.aborted) break
            const tool = tools.find((t) => t.definition.function.name === call.function?.name)
            let result = JSON.stringify({ ok: false, error: 'Unknown tool.' })
            if (tool && call.function?.arguments) {
              try {
                const args = JSON.parse(call.function.arguments) as Record<string, unknown>
                result = await tool.execute(args, ctx)
              } catch (err) {
                result = JSON.stringify({ ok: false, error: String(err) })
              }
            }
            trace.append({
              role: 'tool',
              ts: Date.now(),
              content: result,
              name: call.function?.name ?? ''
            })
            messages.push({ role: 'tool', content: result, toolCallId: call.id })
          }
          continue
        }
        finalText = raw.trim()
        break
      }
    } catch (err) {
      if (this.deps.signal.aborted) {
        return {
          run,
          status: 'cancelled',
          statusError: 'cancelled',
          notify: false
        }
      }
      return this.fail(run, String(err))
    }
    await trace.flush()

    const notify = finalText.trim() !== '' && !isNoResponse(finalText)
    return {
      run,
      status: 'done',
      statusNotice: notify ? finalText : undefined,
      notify,
      finalText: finalText.trim()
    }
  }

  private async fail(run: ScheduleJobRun, error: string): Promise<JobRunResult> {
    return { run, status: 'failed', statusError: error, notify: false }
  }

  private buildSystemPrompt(job: ScheduleJob): string {
    const lang = job.language?.trim() || 'English'
    const days = (job.days.length === 7 ? ALL_DAYS : job.days)
      .map((d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d])
      .join(', ')
    return [
      'You are the executor of a scheduled background job inside the PTNotes desktop app.',
      'This is NOT a chat: there is no interactive user on the other end.',
      `Project: ${this.project}.`,
      `Current local date/time: ${new Date().toLocaleString()}.`,
      `Job schedule: ${days} (informational).`,
      '',
      'Write your final answer in the user-preferred response language: ' + lang + '.',
      'The final answer will be shown to the user as a notification when it is useful. If this job produced nothing worth notifying (no notable result, nothing to report), reply with exactly **NO RESPONSE** and nothing else.',
      'Do not ask questions — there is no one to answer them.'
    ].join('\n')
  }
}

function isLocalEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(baseUrl)
}

function rawTrace(
  msg: OpenAI.Chat.Completions.ChatCompletionMessage | undefined | null,
  trace: AiTraceRecorder,
  started: number,
  model: string
): void {
  trace.append({
    role: 'assistant',
    ts: Date.now(),
    durationMs: Date.now() - started,
    content: msg?.content ?? '',
    ...(msg?.tool_calls
      ? {
          toolCalls: msg.tool_calls.map((c) => ({
            id: c.id ?? '',
            name: c.type === 'function' ? (c.function?.name ?? '') : '',
            args: (() => {
              if (c.type !== 'function') return {}
              try {
                return JSON.parse(c.function?.arguments ?? '{}') as Record<string, unknown>
              } catch {
                return { raw: c.function?.arguments ?? '' }
              }
            })()
          }))
        }
      : {}),
    model
  })
}
