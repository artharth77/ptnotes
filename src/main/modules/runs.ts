import { randomUUID } from 'crypto'
import { shell } from 'electron'
import { promises as fs } from 'fs'
import OpenAI from 'openai'
import type {
  AIProviderConfig,
  AiTraceFile,
  ModuleChatMessage,
  ModuleEvent,
  ModuleInfo,
  ModuleRun,
  ModuleStartResult
} from '@shared/types'
import type { PTNotesService } from '../service/PTNotesService'
import type { AIConfigStore } from '../ai/config'
import type { SettingsStore } from '../settings'
import { isLocalEndpoint } from '../ai/chatSession'
import { ModuleRegistry } from './registry'
import { ModuleRunner } from './runner'
import type { BotAskHandler, ModuleNotifyEvent } from './runner'

export type ModuleEventBroadcaster = (evt: ModuleEvent) => void

export type ModuleClientFactory = (cfg: AIProviderConfig) => OpenAI

export interface ModuleWaitResult {
  runId: string
  title?: string
  module?: string
  status: 'done' | 'failed' | 'cancelled' | 'timeout' | 'stopped' | 'unknown'
  result?: string
  outputFiles?: string[]
  summary?: string
  error?: string
}

const DEFAULT_WAIT_TIMEOUT_MS = 600_000

/**
 * Owns active module runs, their persistence in <project>/.data/modules/ and the
 * broadcast of progress events to the renderer.
 */
export class ModuleRunManager {
  private readonly active = new Map<string, ModuleRunner>()
  private readonly waiters = new Map<string, Set<() => void>>()
  private readonly service: PTNotesService
  private readonly configStore: AIConfigStore
  private readonly registry: ModuleRegistry
  private readonly broadcast: ModuleEventBroadcaster
  private readonly clientFn?: ModuleClientFactory
  private readonly settingsStore?: SettingsStore

  constructor(
    service: PTNotesService,
    configStore: AIConfigStore,
    registry: ModuleRegistry,
    broadcast: ModuleEventBroadcaster = () => {},
    clientFn?: ModuleClientFactory,
    settingsStore?: SettingsStore
  ) {
    this.service = service
    this.configStore = configStore
    this.registry = registry
    this.broadcast = broadcast
    this.clientFn = clientFn
    this.settingsStore = settingsStore
  }

  /** Start a background module run (fire-and-forget) for the given project. */
  async start(
    project: string,
    moduleId: string,
    title: string,
    prompt: string,
    expectResult?: string,
    botOpts?: {
      botId?: string
      groupId?: string
      profileId?: string
      modelOverride?: string
      displayName?: string
      /** ask_user bridge for bot-task runs (a function only — never persisted/broadcast). */
      ask?: BotAskHandler
    }
  ): Promise<ModuleStartResult> {
    const def = this.registry.get(moduleId)
    if (!def) {
      return { ok: false, error: `Unknown module: "${moduleId}".` }
    }
    if (this.settingsStore) {
      const settings = await this.settingsStore.load()
      if (settings.disabledModules?.includes(moduleId)) {
        return {
          ok: false,
          error: `Module "${def.name}" is disabled. Enable it in Settings ▸ Modules and try again.`
        }
      }
    }
    const cleanTitle = String(title || '').trim()
    const cleanPrompt = String(prompt || '').trim()
    if (!cleanTitle || !cleanPrompt) {
      return {
        ok: false,
        error: 'Both a title and a detailed prompt are required to start a module.'
      }
    }
    const cleanExpect = String(expectResult ?? '').trim()

    // Bot tasks may run with a per-bot profile/model override; the key never leaves the store.
    const cfg: AIProviderConfig =
      botOpts?.profileId || botOpts?.modelOverride
        ? await this.configStore.loadResolved(botOpts.profileId, botOpts.modelOverride)
        : await this.configStore.load()
    if (!cfg.model) {
      return {
        ok: false,
        error: 'AI model is not configured. Open AI settings and choose a model.'
      }
    }
    if (!cfg.apiKey && !isLocalEndpoint(cfg.baseUrl)) {
      return { ok: false, error: 'AI is not configured. Open AI settings to set your API key.' }
    }

    const runId = randomUUID()
    const moduleInfo: ModuleInfo = {
      id: def.id,
      name: botOpts?.displayName?.trim() || def.name,
      description: def.summary
    }
    const now = Date.now()
    const run: ModuleRun = {
      runId,
      module: moduleInfo,
      project,
      title: cleanTitle,
      prompt: cleanPrompt,
      status: 'planning',
      steps: [],
      createdAt: now,
      updatedAt: now,
      ...(cleanExpect ? { expectResult: cleanExpect } : {}),
      ...(botOpts?.botId ? { botId: botOpts.botId } : {}),
      ...(botOpts?.groupId ? { groupId: botOpts.groupId } : {}),
      ...(botOpts?.profileId ? { profileId: botOpts.profileId } : {}),
      ...(botOpts?.modelOverride ? { modelOverride: botOpts.modelOverride } : {})
    }

    await this.service.writeModulePrompt(project, runId, {
      runId,
      module: moduleInfo,
      title: cleanTitle,
      prompt: cleanPrompt
    })
    await this.service.writeModuleRun(project, runId, run)
    this.emit({ runId, project, type: 'status', run })

    const runner = new ModuleRunner({
      service: this.service,
      activeProject: project,
      module: def,
      run,
      getConfig:
        botOpts?.profileId || botOpts?.modelOverride
          ? () => Promise.resolve(cfg)
          : () => this.configStore.load(),
      createClientFn: this.clientFn,
      notify: (snapshot, evt) => this.handleUpdate(snapshot, evt),
      ...(botOpts?.ask ? { ask: botOpts.ask } : {})
    })
    this.active.set(runId, runner)

    void runner.start().finally(() => {
      // Keep the runner in the map (its last snapshot is authoritative).
    })

    return { ok: true, runId, module: moduleInfo, title: cleanTitle }
  }

  stop(runId: string): void {
    this.active.get(runId)?.stop()
  }

  /**
   * Stop and mark every live non-terminal run as cancelled, persisting the final
   * snapshot. Used on app shutdown so runs are not left as stale `running` entries.
   */
  async cancelActive(project?: string): Promise<void> {
    for (const runner of [...this.active.values()]) {
      const run = runner.snapshot
      if (!run) continue
      if (project && run.project !== project) continue
      if (ModuleRunManager.terminalStatuses.has(run.status)) continue
      runner.stop()
      run.status = 'cancelled'
      run.finishedAt = Date.now()
      run.updatedAt = Date.now()
      await this.service.writeModuleRun(run.project, run.runId, run).catch(() => {})
      await this.service.writeModuleChat(run.project, run.runId, runner.transcript).catch(() => {})
      this.emit({ runId: run.runId, project: run.project, type: 'status', run })
    }
  }

  /** Re-run a previously failed or cancelled module run, reusing its stored prompt. */
  async retry(project: string, runId: string): Promise<ModuleStartResult> {
    const run = (await this.list(project)).find((r) => r.runId === runId)
    if (!run) {
      return { ok: false, error: 'Module run not found.' }
    }
    if (!['failed', 'cancelled'].includes(run.status)) {
      return { ok: false, error: 'Only failed or cancelled module runs can be retried.' }
    }
    const def = this.registry.get(run.module.id)
    if (!def) {
      return { ok: false, error: `Unknown module: "${run.module.id}".` }
    }
    if (this.settingsStore) {
      const settings = await this.settingsStore.load()
      if (settings.disabledModules?.includes(def.id)) {
        return {
          ok: false,
          error: `Module "${def.name}" is disabled. Enable it in Settings ▸ Modules and try again.`
        }
      }
    }
    const cfg: AIProviderConfig = await this.configStore.loadResolved(
      run.profileId,
      run.modelOverride
    )
    if (!cfg.model) {
      return {
        ok: false,
        error: 'AI model is not configured. Open AI settings and choose a model.'
      }
    }
    if (!cfg.apiKey && !isLocalEndpoint(cfg.baseUrl)) {
      return { ok: false, error: 'AI is not configured. Open AI settings to set your API key.' }
    }

    const now = Date.now()
    run.status = 'planning'
    run.steps = []
    run.currentStep = undefined
    run.startedAt = undefined
    run.finishedAt = undefined
    run.outputFile = undefined
    run.outputFiles = undefined
    run.summary = undefined
    run.error = undefined
    run.result = undefined
    run.updatedAt = now

    await this.service.writeModuleRun(project, runId, run)
    this.emit({ runId, project, type: 'status', run })
    await this.service.writeModuleChat(project, runId, []).catch(() => {})
    await this.service.deleteModuleTrace(project, runId).catch(() => {})

    this.active.get(runId)?.stop()
    const runner = new ModuleRunner({
      service: this.service,
      activeProject: project,
      module: def,
      run,
      getConfig: () => Promise.resolve(cfg),
      createClientFn: this.clientFn,
      notify: (snapshot, evt) => this.handleUpdate(snapshot, evt)
    })
    this.active.set(runId, runner)
    void runner.start()

    return {
      ok: true,
      runId,
      module: { id: def.id, name: def.name, description: def.summary },
      title: run.title
    }
  }

  /** Delete persisted terminal runs for a project, keeping active runs. Returns count removed. */
  async clearHistory(project: string, deleteOutputFiles = false): Promise<number> {
    const terminal = new Set<ModuleRun['status']>(['done', 'failed', 'cancelled'])
    const running = new Set<string>()
    for (const runner of this.active.values()) {
      const run = runner.snapshot
      if (run.project !== project) continue
      if (terminal.has(run.status)) {
        // finished this session: drop so it may be deleted from the map too
        this.active.delete(run.runId)
      } else {
        running.add(run.runId)
      }
    }
    // Hidden bot-task runs are managed by the Bot Tasks panel — never deleted here.
    for (const stored of await this.service.listStoredModuleRuns(project)) {
      if (stored.module.id === 'bot-task') running.add(stored.runId)
    }
    return this.service.clearModuleHistoryRuns(project, [...running], deleteOutputFiles)
  }

  /** Delete a single module run (history) and optionally its output file. */
  async deleteRun(project: string, runId: string, deleteOutputFiles = false): Promise<boolean> {
    const runner = this.active.get(runId)
    if (runner) {
      const status = runner.snapshot?.status
      if (status && !['done', 'failed', 'cancelled'].includes(status)) {
        return false
      }
      this.active.delete(runId)
    }
    return this.service.deleteModuleRun(project, runId, deleteOutputFiles)
  }

  /** Combine live runs with persisted history for a project. */
  async list(project: string): Promise<ModuleRun[]> {
    const byId = new Map<string, ModuleRun>()
    for (const stored of await this.service.listStoredModuleRuns(project)) {
      byId.set(stored.runId, stored)
    }
    for (const runner of this.active.values()) {
      const run = runner.snapshot
      if (run && run.project === project) byId.set(run.runId, run)
    }
    // A persisted non-terminal run with no live runner was interrupted (crash or quit);
    // mark it cancelled so it is not left as a phantom "running" entry in history.
    for (const [id, run] of [...byId]) {
      if (run.project !== project) continue
      if (['queued', 'planning', 'running'].includes(run.status) && !this.active.has(id)) {
        run.status = 'cancelled'
        run.finishedAt = Date.now()
        run.updatedAt = Date.now()
        await this.service.writeModuleRun(project, id, run).catch(() => {})
      }
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Reveal a module run's output file in the OS file manager. Pass `filePath`
   * to reveal a specific file from the run's outputFiles; otherwise the
   * primary output file is revealed.
   */
  async reveal(
    project: string,
    runId: string,
    filePath?: string
  ): Promise<{ ok: boolean; error?: string }> {
    const run = (await this.list(project)).find((r) => r.runId === runId)
    const outputs = run?.outputFiles?.length
      ? run.outputFiles
      : run?.outputFile
        ? [run.outputFile]
        : []
    if (outputs.length === 0) {
      return { ok: false, error: 'No output file recorded for this run.' }
    }
    const target = filePath && outputs.includes(filePath) ? filePath : outputs[0]
    try {
      await fs.access(target)
    } catch {
      return {
        ok: false,
        error: `File not found: ${target.split(/[\\/]/).pop()} (${target})`
      }
    }
    shell.showItemInFolder(target)
    return { ok: true }
  }

  /** Read a module run's conversation transcript: live from the runner, else disk. */
  async readChat(project: string, runId: string): Promise<ModuleChatMessage[]> {
    const runner = this.active.get(runId)
    if (runner && runner.snapshot?.project === project) {
      return runner.transcript
    }
    return this.service.readModuleChat(project, runId)
  }

  /** Read a module run's raw AI trace: live from the runner, else disk. */
  async readTrace(project: string, runId: string): Promise<AiTraceFile | null> {
    const runner = this.active.get(runId)
    if (runner && runner.snapshot?.project === project) {
      const trace = runner.traceFile
      if (trace.entries.length > 0) {
        trace.path = this.service.moduleTracePath(project, runId)
        return trace
      }
    }
    return this.service.readModuleTrace(project, runId)
  }

  private static terminalStatuses = new Set<ModuleRun['status']>(['done', 'failed', 'cancelled'])

  private static toWaitResult(run: ModuleRun | undefined): ModuleWaitResult | undefined {
    if (!run || !ModuleRunManager.terminalStatuses.has(run.status)) return undefined
    return {
      runId: run.runId,
      title: run.title,
      module: run.module.name,
      status: run.status as ModuleWaitResult['status'],
      ...(run.result ? { result: run.result } : {}),
      ...(run.outputFiles && run.outputFiles.length > 0
        ? { outputFiles: [...run.outputFiles] }
        : {}),
      ...(run.summary ? { summary: run.summary } : {}),
      ...(run.error ? { error: run.error } : {})
    }
  }

  /**
   * Wait until every listed run is terminal (event-driven), then return each run's
   * status/result/outputFiles/summary/error in input order. Already-terminal runs resolve
   * immediately; unknown run ids get an error entry; a timeout (default 600s, clamped
   * 30–3600s) marks still-pending entries `status: 'timeout'`; an `isStopped` poll
   * (~500ms) resolves early with `status: 'stopped'` for prompt stop-cancellation.
   */
  async waitForRuns(
    project: string,
    runIds: string[],
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
    isStopped?: () => boolean
  ): Promise<ModuleWaitResult[]> {
    const ids = [...new Set(runIds.map((r) => String(r ?? '').trim()).filter(Boolean))]
    const results = new Map<string, ModuleWaitResult>()

    for (const id of ids) {
      results.set(id, { runId: id, status: 'unknown', error: 'Unknown run' })
    }
    for (const run of await this.list(project)) {
      const entry = ModuleRunManager.toWaitResult(run)
      if (entry) results.set(run.runId, entry)
    }

    const pending = new Set<string>()
    for (const id of ids) {
      const entry = results.get(id)!
      if (ModuleRunManager.terminalStatuses.has(entry.status as ModuleRun['status'])) continue
      const live = this.active.get(id)?.snapshot
      const liveEntry = ModuleRunManager.toWaitResult(live)
      if (liveEntry) {
        results.set(id, liveEntry)
        continue
      }
      // Unknown ids never resolve via events; keep their error entry. Real non-terminal
      // runs are waited on.
      if (live) pending.add(id)
    }

    if (pending.size === 0) {
      return ids.map(
        (id) => results.get(id) ?? { runId: id, status: 'unknown', error: 'Unknown run' }
      )
    }

    return new Promise<ModuleWaitResult[]>((resolve) => {
      const timers: ReturnType<typeof setTimeout>[] = []
      const fires = new Map<string, () => void>()
      let done = false

      const finish = (): void => {
        if (done) return
        done = true
        for (const t of timers) clearTimeout(t)
        for (const [id, fire] of fires) {
          const set = this.waiters.get(id)
          if (set) {
            set.delete(fire)
            if (set.size === 0) this.waiters.delete(id)
          }
        }
        resolve(
          ids.map((id) => results.get(id) ?? { runId: id, status: 'unknown', error: 'Unknown run' })
        )
      }

      const check = (): void => {
        if (pending.size === 0) finish()
      }

      for (const id of pending) {
        const fire = (): void => {
          if (done) return
          const entry = ModuleRunManager.toWaitResult(this.active.get(id)?.snapshot)
          if (entry) results.set(id, entry)
          pending.delete(id)
          check()
        }
        fires.set(id, fire)
        const set = this.waiters.get(id) ?? new Set<() => void>()
        set.add(fire)
        this.waiters.set(id, set)
      }

      timers.push(
        setTimeout(() => {
          for (const id of pending) {
            results.set(id, { ...(results.get(id) ?? { runId: id }), status: 'timeout' })
          }
          pending.clear()
          check()
        }, timeoutMs)
      )

      if (isStopped) {
        timers.push(
          setInterval(() => {
            if (isStopped()) {
              for (const id of pending) {
                results.set(id, { ...(results.get(id) ?? { runId: id }), status: 'stopped' })
              }
              pending.clear()
              check()
            }
          }, 500) as unknown as ReturnType<typeof setTimeout>
        )
      }
    })
  }

  private fireWaiters(runId: string): void {
    const set = this.waiters.get(runId)
    if (!set) return
    for (const fire of [...set]) fire()
  }

  private handleUpdate(run: ModuleRun, evt: ModuleNotifyEvent): void {
    if (evt.type !== 'tool') {
      // Tool lifecycle events carry no run changes; skip the redundant disk write.
      void this.service.writeModuleRun(run.project, run.runId, run).catch(() => {
        // persistence is best-effort; broadcast still proceeds
      })
    }
    this.emit({
      runId: run.runId,
      project: run.project,
      type: evt.type,
      run,
      ...(evt.step ? { step: evt.step } : {}),
      ...(evt.stepIndex !== undefined ? { stepIndex: evt.stepIndex } : {}),
      ...(evt.outputFile ? { outputFile: evt.outputFile } : {}),
      ...(evt.outputFiles ? { outputFiles: evt.outputFiles } : {}),
      ...(evt.error ? { error: evt.error } : {}),
      ...(evt.summary ? { summary: evt.summary } : {}),
      ...(evt.result ? { result: evt.result } : {}),
      ...(evt.chat ? { chat: evt.chat } : {}),
      ...(evt.toolCall ? { toolCall: evt.toolCall } : {})
    })
    if (ModuleRunManager.terminalStatuses.has(run.status)) {
      this.fireWaiters(run.runId)
    }
  }

  private emit(evt: ModuleEvent): void {
    this.broadcast(evt)
  }
}
