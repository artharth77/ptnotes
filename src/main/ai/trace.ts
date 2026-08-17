import type { AiTraceEntry, AiTraceFile, AiTraceHeader } from '@shared/types'

export interface AiTraceRecorderOptions {
  project: string
  /** Session id (chat) or run id (module) that owns this trace. */
  key: string
  kind: 'chat' | 'module'
  /** Seq offset so `seq` stays monotonic when appending to an existing trace file. */
  initialSeq?: number
  /** True when the trace file already contains a `system` entry — the system prompt is
   * traced only once per file, so `appendSystem` is a no-op in that case. */
  hasSystem?: boolean
  /** Append JSONL lines to the trace file (the header record is written first when the
   * file is new). Best-effort and non-fatal. */
  append: (header: AiTraceHeader, lines: string[]) => Promise<void>
}

/**
 * In-memory buffer of the readable AI trace log (system/user/assistant/tool records)
 * for one chat session or module run. Kept entirely in the main process; the renderer
 * only reads it back via IPC. Records are appended to the trace file as JSONL — one
 * record per line, the header record first — and the file is never rewritten.
 * `append()` is best-effort and non-fatal.
 */
export class AiTraceRecorder {
  private entries: AiTraceEntry[] = []
  private pending: AiTraceEntry[] = []
  private seq: number
  private readonly startedAt = Date.now()

  constructor(private readonly opts: AiTraceRecorderOptions) {
    this.seq = opts.initialSeq ?? 0
  }

  /** Record one readable entry (system/user/assistant/tool) and return it. */
  append(entry: Omit<AiTraceEntry, 'seq'>): AiTraceEntry {
    const stored: AiTraceEntry = { ...entry, seq: this.seq++ }
    this.entries.push(stored)
    this.pending.push(stored)
    return stored
  }

  /** Record the system prompt, but only when the file has no system entry yet. */
  appendSystem(content: string): AiTraceEntry | undefined {
    if (this.opts.hasSystem) return undefined
    return this.append({ role: 'system', ts: Date.now(), content })
  }

  header(): AiTraceHeader {
    return {
      type: 'header',
      project: this.opts.project,
      key: this.opts.key,
      kind: this.opts.kind,
      startedAt: this.startedAt
    }
  }

  snapshot(): AiTraceFile {
    const last = this.entries[this.entries.length - 1]
    return {
      project: this.opts.project,
      key: this.opts.key,
      kind: this.opts.kind,
      startedAt: this.startedAt,
      updatedAt: last ? last.ts : this.startedAt,
      entries: this.entries
    }
  }

  get entryCount(): number {
    return this.entries.length
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return
    const lines = this.pending.map((e) => JSON.stringify(e))
    try {
      await this.opts.append(this.header(), lines)
      this.pending = []
    } catch {
      // tracing is best-effort — never fail a send/turn because of it
    }
  }
}
