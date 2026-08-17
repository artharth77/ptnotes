# PLAN.md — Module result-return + main-chat multi-module waiting

**Version:** v0.8.0 · **Goal:** 1

Feature design for allowing module (subagent) runs to return a result payload back to the
main chat agent, and letting the main chat start several modules in parallel and wait for
all of them before continuing its own process.

Decisions (confirmed):

- **Waiting mechanism:** explicit `wait_modules` tool. The main chat starts N modules (each
  `start_module` returns its `runId` immediately), then calls `wait_modules({ runIds })`,
  which blocks until every listed run is terminal and returns their results. Fits the
  existing tool loop; keeps module starts parallel.
- **Result payload:** free-form string. `submit_result({ result })` stores whatever the main
  chat asked for (JSON, markdown, plain text); the main chat specifies the format via the
  `expect` argument of `start_module`.

## Design overview

Two additions on top of the existing module framework:

1. **Module → main-chat result channel**: a new `submit_result` tool available to module
   subagents. The main chat specifies what it wants back via a new `expect` argument on
   `start_module`, which flows into the run (`expectResult`) and the module's system prompt.
   The result is stored on `ModuleRun.result` and surfaced in the `done` event.

2. **Main-chat waiting**: a new `wait_modules` tool for the main chat. The agent starts N
   modules, then calls `wait_modules({ runIds: [...] })`, which blocks (event-driven, with
   timeout + stop-cancellation) until every listed run is terminal, and returns each run's
   `status` / `result` / `outputFiles` / `summary` / `error` as tool JSON. The chat's existing
   tool loop then continues with the results in context.

## File-by-file changes

### `src/shared/types.ts`

- `ModuleRun`: add `result?: string`, `expectResult?: string`.
- `ModuleEventType`: add `'result'`; `ModuleEvent` gets `result?: string`.
- `ChatStreamEvent`: add `'waiting'` type + `runIds?: string[]` (UX: "waiting for N module
  runs" status).

### `src/main/modules/runner.ts`

- `ModuleNotifyEvent`: add `result?: string`.
- `buildSystemPrompt(module, activeProject, expectResult?)`: when `expectResult` present, tell
  the module it MUST call `submit_result` (format per the requested result) before finishing.
- `toolList()`: add `submitResultTool(runner)`; add `applyResult()` that validates non-empty,
  stores `run.result`, notifies `{ type: 'result', result }`, returns `{ ok: true }`.
- `finish()`: include `result` in the `done` event.
- `runTurn()`: mirror the existing output-file hint — if `expectResult` is set but no result
  was submitted when the model tries to finish, push up to `MAX_FINISH_HINTS` hints to call
  `submit_result` first (instead of failing outright).

### `src/main/modules/runs.ts`

- `start(project, moduleId, title, prompt, expectResult?)`: store `run.expectResult`.
- `retry()`: also reset `run.result = undefined`.
- Add `waitForRuns(project, runIds, timeoutMs, isStopped?)`:
  - Event-driven waiter map keyed by runId (`waiters: Map<string, Set<() => void>>`).
  - Initial `list()` seeds results: already-terminal runs resolve immediately; unknown runs
    get an `{ error: 'Unknown run' }` entry.
  - After the async `list()` await, re-check the live runner snapshot for terminal state to
    close the check-then-register race.
  - `handleUpdate()` fires the waiters for a run when it reaches
    `done`/`failed`/`cancelled`.
  - Timeout (default 600s) marks still-pending entries `{ status: 'timeout' }`.
  - `isStopped` poll (≈500ms) resolves early for prompt stop-cancellation.
  - Returns entries in input order.
- `handleUpdate()`: propagate `result` into the broadcast event; fire waiters on terminal
  transitions.

### `src/main/modules/tool.ts`

- `buildStartModuleTool`: add `expect` param (description of the result the main chat wants
  back), pass through to `manager.start`, update the tool description to mention `wait_modules`.
- New `buildWaitModulesTool(manager)`: schema `{ runIds: string[], timeoutSeconds?: number }`
  (default 600, clamp 30–3600); executor calls `manager.waitForRuns(ctx.activeProject, runIds,
  timeoutMs, ctx.isStopped)` and returns `{ ok, results: [{ runId, title, module, status,
  result?, outputFiles?, summary?, error? }] }`.

### `src/main/ai/tools.ts`

- `ToolContext`: add optional `isStopped?: () => boolean`.

### `src/main/ai/chatSession.ts`

- `buildSystemPrompt`: add an orchestration guideline — start modules for results you need,
  pass `expect` to say what you want back, then call `wait_modules` with all runIds and
  continue with the results; don't wait when you don't need the output.
- `executeTool`: pass `isStopped: () => this.stopped` into the tool context; for
  `wait_modules`, emit a `'waiting'` stream event (with `runIds`) before executing.

### `src/main/index.ts`

- `toolsProvider`: return `[buildStartModuleTool(...), buildWaitModulesTool(moduleManager)]`.

### Renderer (UX polish)

- `src/renderer/src/store/useAppStore.ts`: add `chatWaitRuns: string[]` + setter; cleared when
  a send starts/finishes.
- `src/renderer/src/App.tsx`: handle `'waiting'` stream events → set `chatWaitRuns`.
- `src/renderer/src/components/ChatDrawer.tsx`: when waiting, show "Waiting for N module
  run(s)…" status instead of the generic "AI is thinking…" (module cards already update live
  via `modules:event`).

## Tests

- `scripts/test-modules.mts`:
  - Scripted run that calls `submit_result` → assert `run.result`, `'result'` event
    broadcast, persisted in the stored run JSON.
  - `waitForRuns` unit cases: already-terminal run resolves immediately; in-flight run
    resolves when it completes; timeout yields `{ status: 'timeout' }`; unknown run returns
    an error entry; `isStopped` cancels early.
- `scripts/test-chat.mts`:
  - End-to-end: toolsProvider injects `buildStartModuleTool` + `buildWaitModulesTool` over a
    real `ModuleRunManager` with a scripted module client; mock LLM streams
    `start_module` (×2) → `wait_modules` → final answer; assert the final assistant content
    incorporates the returned module results.

## Documentation updates (when finished)

Update the project docs to reflect the new behavior:

- **`AGENTS.md`**:
  - Tools table (17 → 19): document the new `submit_result` (module-side) and `wait_modules`
    (chat-side) tools, and the `expect` argument of `start_module`.
  - Modules section: note `ModuleRun.result` / `expectResult`, the `'result'` event, and the
    main-chat multi-module wait flow (start N → `wait_modules` → continue with results).
  - IPC surface / AI chat feature flow: mention the module orchestration guidance in the
    system prompt.
- **`README.md`**: add a short user-facing feature note for "AI can delegate to modules and
  wait for their results" under the chat/module capabilities.
- **`CHANGELOG.md`**: add a changelog entry for the new feature version bump.

## Invariants preserved

- `wait_modules` / `start_module` stay chat-only: module subagents never receive them
  (`runner.toolList()` uses `baseTools` + module tools + `set_plan`/`update_step`), so no
  module-nesting of module runs.
- Modules keep running independently if the chat is stopped/cancelled; only the wait returns
  early (`isStopped`).
- `result` / `expectResult` are optional fields — backward compatible with persisted runs;
  no migration needed.
- The renderer must never access the network/filesystem; all module state still flows through
  `modules:event` and the tool-result stream.