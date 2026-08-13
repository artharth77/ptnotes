import { randomUUID } from 'crypto'
import { shell } from 'electron'
import { promises as fs } from 'fs'
import OpenAI from 'openai'
import type {
  AIProviderConfig,
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
import type { ModuleNotifyEvent } from './runner'

export type ModuleEventBroadcaster = (evt: ModuleEvent) => void

export type ModuleClientFactory = (cfg: AIProviderConfig) => OpenAI

/**
 * Owns active module runs, their persistence in <project>/.data/modules/ and the
 * broadcast of progress events to the renderer.
 */
export class ModuleRunManager {
  private readonly active = new Map<string, ModuleRunner>()
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
    prompt: string
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

    const cfg: AIProviderConfig = await this.configStore.load()
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
    const moduleInfo: ModuleInfo = { id: def.id, name: def.name, description: def.summary }
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
      updatedAt: now
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
      getConfig: () => this.configStore.load(),
      createClientFn: this.clientFn,
      notify: (snapshot, evt) => this.handleUpdate(snapshot, evt)
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

  /** Re-run a previously failed module run, reusing its stored prompt. */
  async retry(project: string, runId: string): Promise<ModuleStartResult> {
    const run = (await this.list(project)).find((r) => r.runId === runId)
    if (!run) {
      return { ok: false, error: 'Module run not found.' }
    }
    if (run.status !== 'failed') {
      return { ok: false, error: 'Only failed module runs can be retried.' }
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
    const cfg: AIProviderConfig = await this.configStore.load()
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
    run.updatedAt = now

    await this.service.writeModuleRun(project, runId, run)
    this.emit({ runId, project, type: 'status', run })
    await this.service.writeModuleChat(project, runId, []).catch(() => {})

    this.active.get(runId)?.stop()
    const runner = new ModuleRunner({
      service: this.service,
      activeProject: project,
      module: def,
      run,
      getConfig: () => this.configStore.load(),
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

  private handleUpdate(run: ModuleRun, evt: ModuleNotifyEvent): void {
    void this.service.writeModuleRun(run.project, run.runId, run).catch(() => {
      // persistence is best-effort; broadcast still proceeds
    })
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
      ...(evt.summary ? { summary: evt.summary } : {})
    })
  }

  private emit(evt: ModuleEvent): void {
    this.broadcast(evt)
  }
}
