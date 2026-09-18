import type OpenAI from 'openai'
import type { AIConfigStore } from '../ai/config'
import { createClient } from '../ai/client'
import { AiTraceRecorder } from '../ai/trace'
import type { ModuleRunManager } from '../modules/runs'
import type { ModuleRegistry as Registry } from '../modules/registry'
import type { JobsStore } from './db'
import type { PTNotesService } from '../service/PTNotesService'
import { ScheduleJobRunner, type JobRunResult } from './runner'
import type { ScheduleJob, ScheduleJobRun, ScheduleJobRunStatus } from '@shared/scheduleJobs'
import { GLOBAL_PROJECT_KEY, isNoResponse } from '@shared/scheduleJobs'

/** Max per-project runs in flight at once during a global fan-out. */
const FANOUT_CONCURRENCY = 3
/** Per-project text size cap fed into the summarizer prompt. */
const SECTION_CHAR_CAP = 4000

export interface GlobalJobRunnerDeps {
  listProjects: () => Promise<string[]>
  service: PTNotesService
  configStore: AIConfigStore
  moduleManager: ModuleRunManager
  moduleRegistry: Registry
  disabledModules: string[]
  db: JobsStore
  /** Abort signal shared with the app shutdown path. */
  signal: AbortSignal
}

interface ProjectOutcome {
  project: string
  status: ScheduleJobRunStatus
  text: string
  error?: string
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n…[truncated]` : text
}

/**
 * Runs a global-scope job: fans the job prompt out to every project (reusing
 * `ScheduleJobRunner` per project, capped concurrency), then summarizes all
 * per-project answers into one notification with a single non-streamed call.
 * Each per-project execution is recorded as its own run row + trace in the
 * root-level jobs DB; the parent run's trace records the orchestration.
 */
export class GlobalJobRunner {
  constructor(private readonly deps: GlobalJobRunnerDeps) {}

  async run(job: ScheduleJob, run: ScheduleJobRun): Promise<JobRunResult> {
    const cfg = await this.deps.configStore.load()
    if (!cfg.model) {
      return this.fail(run, 'AI model is not configured. Open AI settings and choose a model.')
    }
    if (!cfg.apiKey && !isLocalEndpoint(cfg.baseUrl)) {
      return this.fail(run, 'AI is not configured. Open AI settings to set your API key.')
    }

    const trace = new AiTraceRecorder({
      project: GLOBAL_PROJECT_KEY,
      key: run.runId,
      kind: 'module',
      append: (header, lines) =>
        this.deps.db.appendRunTrace(GLOBAL_PROJECT_KEY, run.runId, header, lines)
    })
    const sys = [
      'Scheduled global job (runs the same prompt in every project, results summarized into one answer).',
      `Job: ${job.title}`,
      `Current local date/time: ${new Date().toLocaleString()}.`
    ].join('\n')
    trace.appendSystem(sys)
    trace.append({ role: 'user', ts: Date.now(), content: job.prompt })

    let projects: string[] = []
    try {
      projects = await this.deps.listProjects()
    } catch {
      return this.fail(run, 'Could not list projects.')
    }
    if (projects.length === 0) {
      await trace.flush()
      return { run, status: 'done', notify: false, finalText: '' }
    }

    const outcomes = await this.fanOut(job, projects, trace)

    if (this.deps.signal.aborted) {
      await trace.flush()
      return { run, status: 'cancelled', statusError: 'cancelled', notify: false }
    }

    const done = outcomes.filter((o) => o.status === 'done')
    if (done.length === 0) {
      const detail = outcomes.map((o) => `${o.project}: ${o.error ?? o.status}`).join('; ')
      return this.fail(
        run,
        `All ${projects.length} project run(s) failed. ${truncate(detail, 1000)}`
      )
    }

    let finalText: string
    if (projects.length === 1 && done.length === 1) {
      finalText = done[0].text
    } else {
      const client = createClient(cfg)
      const lang = job.language?.trim() || 'English'
      const sumSys = [
        'You are summarizing the results of a scheduled job that ran in every project of the PTNotes desktop app.',
        'Below are the per-project results of that job. Write ONE consolidated summary for the user.',
        'Keep it concise. Cover each project that has something worth reporting; mention failures briefly.',
        `Write your final answer in the user-preferred response language: ${lang}.`,
        'If every project produced nothing worth reporting, reply with exactly **NO RESPONSE** and nothing else.'
      ].join('\n')
      const sumUser = outcomes
        .map((o) => {
          const body =
            o.status === 'done'
              ? o.text || '(no response)'
              : `(run ${o.status}${o.error ? `: ${o.error}` : ''})`
          return `## Project: ${o.project}\n${truncate(body, SECTION_CHAR_CAP)}`
        })
        .join('\n\n')
      trace.append({ role: 'system', ts: Date.now(), content: sumSys })
      trace.append({ role: 'user', ts: Date.now(), content: sumUser })
      const started = Date.now()
      let completion: OpenAI.Chat.ChatCompletion
      try {
        completion = await client.chat.completions.create(
          {
            model: cfg.model,
            messages: [
              { role: 'system', content: sumSys },
              { role: 'user', content: sumUser }
            ],
            stream: false
          },
          { signal: this.deps.signal }
        )
      } catch (err) {
        if (this.deps.signal.aborted) {
          await trace.flush()
          return { run, status: 'cancelled', statusError: 'cancelled', notify: false }
        }
        await trace.flush()
        return this.fail(run, String(err))
      }
      finalText = (completion.choices[0]?.message?.content ?? '').trim()
      trace.append({
        role: 'assistant',
        ts: Date.now(),
        durationMs: Date.now() - started,
        content: finalText,
        model: cfg.model
      })
    }
    await trace.flush()

    const notify = finalText !== '' && !isNoResponse(finalText)
    return {
      run,
      status: 'done',
      statusNotice: notify ? finalText : undefined,
      notify,
      finalText
    }
  }

  private async fanOut(
    job: ScheduleJob,
    projects: string[],
    trace: AiTraceRecorder
  ): Promise<ProjectOutcome[]> {
    const outcomes: ProjectOutcome[] = new Array(projects.length)
    let next = 0
    const workers = Array.from(
      { length: Math.min(FANOUT_CONCURRENCY, projects.length) },
      async () => {
        for (;;) {
          const i = next++
          if (i >= projects.length) return
          const project = projects[i]
          if (this.deps.signal.aborted) {
            outcomes[i] = { project, status: 'cancelled', text: '' }
            continue
          }
          const childRun = this.deps.db.startRun(
            GLOBAL_PROJECT_KEY,
            job.id,
            `${job.title} · ${project}`,
            Date.now()
          )
          let res: JobRunResult
          try {
            const child = new ScheduleJobRunner({
              project,
              service: this.deps.service,
              configStore: this.deps.configStore,
              moduleManager: this.deps.moduleManager,
              moduleRegistry: this.deps.moduleRegistry,
              disabledModules: this.deps.disabledModules,
              db: this.deps.db,
              signal: this.deps.signal,
              traceProject: GLOBAL_PROJECT_KEY
            })
            res = await child.run(job, childRun)
          } catch (err) {
            res = { run: childRun, status: 'failed', statusError: String(err), notify: false }
          }
          this.deps.db.finishRun(GLOBAL_PROJECT_KEY, childRun.runId, res.status, {
            ...(res.statusNotice ? { notice: res.statusNotice } : {}),
            ...(res.statusError ? { error: res.statusError } : {})
          })
          outcomes[i] = {
            project,
            status: res.status,
            text: res.finalText ?? '',
            ...(res.statusError ? { error: res.statusError } : {})
          }
          trace.append({
            role: 'tool',
            ts: Date.now(),
            name: 'run-project',
            content: JSON.stringify({
              project,
              status: res.status,
              ...(res.statusError ? { error: res.statusError } : {}),
              text: truncate(res.finalText ?? '', SECTION_CHAR_CAP)
            })
          })
        }
      }
    )
    await Promise.all(workers)
    return outcomes
  }

  private async fail(run: ScheduleJobRun, error: string): Promise<JobRunResult> {
    return { run, status: 'failed', statusError: error, notify: false }
  }
}

function isLocalEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(baseUrl)
}
