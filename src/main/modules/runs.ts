import { randomUUID } from 'crypto'
import { shell } from 'electron'
import { promises as fs } from 'fs'
import OpenAI from 'openai'
import type { AIProviderConfig, ModuleEvent, ModuleInfo, ModuleRun } from '@shared/types'
import type { PTNotesService } from '../service/PTNotesService'
import type { AIConfigStore } from '../ai/config'
import { isLocalEndpoint } from '../ai/chatSession'
import { ModuleRegistry } from './registry'
import { ModuleRunner } from './runner'
import type { ModuleNotifyEvent } from './runner'

export type ModuleEventBroadcaster = (evt: ModuleEvent) => void

export type ModuleStartResult =
  { ok: true; runId: string; module: ModuleInfo; title: string } | { ok: false; error: string }

export type ModuleClientFactory = (cfg: AIProviderConfig) => OpenAI

/**
 * Owns active module runs, their persistence in <project>/modules/ and the
 * broadcast of progress events to the renderer.
 */
export class ModuleRunManager {
  private readonly active = new Map<string, ModuleRunner>()
  private readonly service: PTNotesService
  private readonly configStore: AIConfigStore
  private readonly registry: ModuleRegistry
  private readonly broadcast: ModuleEventBroadcaster
  private readonly clientFn?: ModuleClientFactory

  constructor(
    service: PTNotesService,
    configStore: AIConfigStore,
    registry: ModuleRegistry,
    broadcast: ModuleEventBroadcaster = () => {},
    clientFn?: ModuleClientFactory
  ) {
    this.service = service
    this.configStore = configStore
    this.registry = registry
    this.broadcast = broadcast
    this.clientFn = clientFn
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

  async reveal(project: string, runId: string): Promise<{ ok: boolean; error?: string }> {
    const run = (await this.list(project)).find((r) => r.runId === runId)
    if (!run?.outputFile) {
      return { ok: false, error: 'No output file recorded for this run.' }
    }
    try {
      await fs.access(run.outputFile)
    } catch {
      return {
        ok: false,
        error: `File not found: ${run.outputFile.split(/[\\/]/).pop()} (${run.outputFile})`
      }
    }
    shell.showItemInFolder(run.outputFile)
    return { ok: true }
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
      ...(evt.error ? { error: evt.error } : {}),
      ...(evt.summary ? { summary: evt.summary } : {})
    })
  }

  private emit(evt: ModuleEvent): void {
    this.broadcast(evt)
  }
}
