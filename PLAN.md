# PTNotes — Technical Plan

This file tracks planned/ongoing work. Completed work lives in `AGENTS.md` (preserved technical design) and `CHANGELOG.md` (version log).

---

## Goal 1 — Modules: background subagent framework (first module: PPTX)

### Concept

A **Module** is a self-registering plugin that spawns a background "subagent" LLM session (a second, independent LLM loop) to perform long-running generation jobs (first one: PPTX). The main chat agent only does one thing: it writes a **full, self-contained prompt** to a file in `<project>/files/temp/`, calls a single generic `start_module` tool, gets back a `runId`, and returns to the user immediately. The subagent then runs in the background, plans its own steps, reports per-step status, and writes the final output — all trackable in a new **Modules** sidebar tab and via a live card in the chat.

New modules (docx, xlsx, …) later = drop a new folder into `src/main/modules/<id>/` and register it. **Zero core changes.**

### Architecture

```
main agent (existing ChatSession)           Module framework (NEW)
──────────────────────────────              ──────────────────────────
create/update note …                start_module tool (dynamic desc)
  …  user asks "make a pptx"  ───────▶  ModuleRegistry (id → def)
                                          │ prompt → temp/<run>.json
                                          │ fire-and-forget
                                ┌─────────▼─────────┐
renderer ◀── modules:event ◀──  │  ModuleRunner     │  (same base tools +
   Modules tab / chat card      │  plan→loop→final  │   module tools +
   store/project runs           └───────────────────┘   set_plan/update_step)
                                                │ run.json snapshots
                                                ▼
                                             <project>/files/<title>.pptx  (via pptxgenjs)
```

- **`start_module`** is the only change to the main agent tool set. JSON schema stays `{ idModule, title, prompt }`; the *description* is generated from the registry so the agent learns about every registered module without code changes.
- The subagent gets **all 13 base tools + module-specific tools + 2 framework tools** (`set_plan`, `update_step`), sharing the same `ToolContext`. `confirm` (used by `delete_note`) resolves to `false` automatically in background runs.
- All filesystem work stays in the **main process**; the renderer never touches disk.

### Shared types (`src/shared/types.ts` additions)

```ts
export type ModuleStatus = 'queued' | 'planning' | 'running' | 'done' | 'failed' | 'cancelled'
export interface ModuleStepState { id: string; name: string; status: 'pending'|'running'|'done'|'failed' }
export interface ModuleInfo { id: string; name: string; description: string }
export interface ModuleRun {
  runId: string; module: ModuleInfo; project: string; title: string
  prompt: string; status: ModuleStatus; steps: ModuleStepState[]
  createdAt: number; updatedAt: number; startedAt?: number; finishedAt?: number
  outputFile?: string; summary?: string; error?: string
}
export interface ModuleEvent {
  runId: string; project: string
  type: 'status'|'step'|'output'|'error'|'done'
  status?: ModuleStatus; step?: ModuleStepState; stepIndex?: number
  outputFile?: string; error?: string; summary?: string
}
```

`Tab` becomes `'notes' | 'todo' | 'modules'`.

### Module framework (main process)

**`src/main/modules/types.ts`** — the generic contract every module implements:

```ts
interface RegisteredModule {
  id: string
  name: string
  description: string            // description = shown to main agent
  systemPrompt?: string          // extra subagent instructions
  tools: PTTool[]                // module-specific tool schemas + executors
}
```

**`src/main/modules/registry.ts`** — `ModuleRegistry` with `register(def)`, `list()`, `get(id)`. Used by `start_module` to enumerate modules and by the runner to resolve `moduleId`.

**`src/main/modules/runner.ts`** — `ModuleRunner`: the background subagent loop, structurally a sibling of `ChatSession`:

1. On start, writes the prompt file `<project>/files/temp/<runId>.json` (prompt authored by the main agent) and the initial run state, then emits events.
2. Streaming LLM loop (shared `AbortController`/`stop()` like `ChatSession`); tool list = base `tools` + module `tools` + framework tools.
3. **Enforces planning first**: the first tool call must be `set_plan` (else a tool error is returned so the model self-corrects); then `update_step(index, 'running' | 'done' | 'failed')` drives per-step UI status.
4. Tool execution dispatches to base tools (auto-false confirm) or module tools; tool errors flow back to the model for self-correction (same pattern as `executeTool`).
5. On final reply: persist `run.json` (status done + `outputFile` captured from module tool results or runner path), emit `done`.
6. Catch → persisted `failed` + error event; `stop()` aborts.

**`src/main/modules/runs.ts`** — `ModuleRunManager`: in-memory map of active runs per project, `start()/stop()/get()`, persistence helpers (load/list all `*.run.json` under `files/temp/`), and a broadcaster that pushes `ModuleEvent`s to all windows on the `modules:event` channel.

### First module: PPTX (`src/main/modules/pptx/`)

- `index.ts` — `RegisteredModule` for `id: 'pptx'`:
  - `description` (consumed by `start_module`): *"Generate a PowerPoint deck… provide a detailed outline/spec; the subagent plans steps, designs slides as JSON, and produces a real .pptx in the project files folder."*
  - `systemPrompt`: instructs the subagent to read any `file:<…>` / `note:<…>` inputs, design slides via supported layouts (title / bullets / section / two-column / table), then call `create_pptx_file`.
  - `tools`: `create_pptx_file({ design: <JSON string>, filename? })`
- `builder.ts` — `buildPptx(design, outPath)`: JSON → `.pptx` via **`pptxgenjs`**, writing to `<project>/files/<slug>.pptx` (filename validated via existing `slugify` + a `files/`-safe dedupe helper; reuses `uniqueOutputPath`), returns `{ ok, path, pptxOutSize }` or `{ ok: false, error }`.

### Main-agent integration (minimal)

- `src/main/ai/tools.ts` — add one `start_module` tool (description built from `ModuleRegistry.list()`; args `{ id, title, prompt }`). Executor asks the module manager to `start(project, id, title, prompt)` and returns `{ ok: true, runId, module, title }` immediately (fire-and-forget).
- `src/main/service/PTNotesService.ts` — add `files/temp` + output helpers: `moduleTempPath(project, runId)`, `writeModulePrompt`, `writeModuleRun`, `listModuleRuns`, `uniqueOutputPath(project, name)` (dedupe like `copyFileToProject`).
- `src/main/index.ts` — build `ModuleRegistry`, register the pptx module, create `ModuleRunManager`, pass into `registerModulesIpc`.

### IPC + preload

`src/main/ipc/modules.ts` + `registerModulesIpc(manager, service)`:

- `modules:list(project)` → `ModuleRun[]` (in-memory active + persisted `*.run.json` under `files/temp/`)
- `modules:stop(project, runId)`
- `modules:reveal(project, runId)` → `shell.showItemInFolder(outputFile)`
- `modules:onEvent` (channel `modules:event`) → pushed by the manager

Preload: add `window.ptnotes.modules.{ list, stop, reveal, onEvent }` (pattern matches the existing `files` api).

### Renderer

- **Store** (`useAppStore`): `moduleRuns: Record<string, ModuleRun[]>`, `loadModules(project)`, `applyModuleEvent(evt)` (upsert run by runId), new `modules` tab handoff. `App.tsx` registers the `Modules:Event` listener next to the existing `onStreamEvent`.
- **Tabs** in `App.tsx`: `Notes | Todo | Modules`.
- **`src/renderer/src/components/ModulePanel.tsx`**: lists runs (active on top, done below). Each card: module icon/name, title, status badge, step list with checkboxes (pending / running spinner / done / failed), current-step indicator, output file with **Open** (reveal) button, error text, **Cancel** for running runs, run start time.
- **Chat summary card** (per "Both" UI choice): when `start_module` returns, store a `moduleRunId` on that assistant message; `ChatDrawer` renders a live card inside the assistant bubble (reuses the same module store data) plus a clickable pill in the tool-row like the existing note pill.
- CSS classes follow existing conventions (`assets/main.css`), e.g. `.module-card`, `.module-step`; reuse `.note-list` / `.todo-panel` patterns.

### Persistence & temp layout

```
<project>/files/temp/
  <runId>.json          # full ModuleRun snapshot (persist history)
  <runId>.prompt.json   # prompt authored by the main agent (requirement)
<project>/files/<title>.pptx   # final output (visible in # picker, read_file, reveal)
```

`files/temp/*.run.json` are read on list, so completed runs are reviewable across restarts (like chat history).

### Testing (`scripts/test-modules.mts`, wired into `npm run test`)

- `test-pptx`: build a PPTX from a JSON design deterministically; assert file exists, size > 0, path in project `files/`; assert invalid design → `ok: false`.
- `test-runner`: construct `ModuleRunner` with a fake "model" (injected completions returning `set_plan` then `update_step` then `create_pptx_file`), drive the loop, assert `run.status === 'done'`, step statuses, run.json written, events emitted in order.
- `test-start-module`: `start_module` with a test module returns `{ ok, runId }`, prompt file written under `files/temp/`.
- Registry test: register + list shows a new module without core changes.

### Dependencies

- add `pptxgenjs` (runtime dep; ships its own TS types).
- No other new runtime deps; framework reuses the existing `openai` client + tool execution path.

### Files touched (summary)

**New main:** `src/main/modules/types.ts`, `registry.ts`, `runner.ts`, `runs.ts`, `pptx/index.ts`, `pptx/builder.ts`, `src/main/ipc/modules.ts`
**Modified main:** `src/main/ai/tools.ts` (add `start_module`), `src/main/service/PTNotesService.ts` (temp/output helpers), `src/main/index.ts` (wire-up)
**Shared:** `src/shared/types.ts`
**Preload:** `src/preload/index.ts` (modules api)
**Renderer:** `useAppStore.ts`, `App.tsx` (tab + event listener), `ModulePanel.tsx`, `ChatDrawer.tsx` (module card)
**Tests/docs:** `scripts/test-modules.mts`, `package.json` (script + dep), `AGENTS.md` + `CHANGELOG.md` (design + notes)

### Constraints / decisions

- Tool count goes 13 → 14; the existing ~10 guideline is already exceeded; acceptable for this feature.
- Subagent loop budget: maximum iterations cap (e.g. 30) to prevent runaway.
- Module tools can mark the run done early via the final message only; a dedicated tool is out of scope.
- Modules never prompt for confirmation (`confirm` auto-false); destructive base tools are usable but effectively disabled via auto-deny.