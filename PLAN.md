# PLAN.md — Module result-return + main-chat multi-module waiting

**Version:** v0.8.0 · **Goals:** 1

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

---

# Goal 2 — Full raw AI trace log (app ↔ AI request/response capture)

**Version:** v0.8.0 · **Goal:** 2

Feature design for persisting **every** app↔AI exchange for both chat sessions and module
runs — the exact request payloads the app sends to the provider and the raw/streamed
responses it receives — so all communication can be traced after the fact. Adds an in-app
read-only trace viewer plus reveal-in-Finder.

Problem: the current chat log (`<project>/.data/chat/<sessionId>.json`) and module log
(`<project>/.data/modules/<runId>.chat.json`) only keep a rendered subset:

- Chat: user text + assistant `content` (reasoning mixed in) + `toolCalls`
  (name/args/result). The system prompt, the full `messages` array actually sent, the tool
  definitions, raw stream chunks, per-turn boundaries, `usage` / `finish_reason`, timing,
  errors and stopped states are lost. The Responses-API (PDF upload) flow is not persisted
  at all.
- Module: the transcript does capture system/user/assistant/tool turns, but not the raw
  request payload, not the raw `reply` (usage/finish_reason), and all messages share one
  `ts`.

## Design overview

A **raw AI trace file** is recorded per chat session and per module run, produced in the
main process where requests are built and streams are consumed:

- Chat: `<project>/.data/chat/<sessionId>.trace.json`
- Module: `<project>/.data/modules/<runId>.trace.json`

Each trace entry captures one provider exchange end-to-end: the request (model, baseUrl,
endpoint, full body — messages array incl. system prompt / tool definitions / tool results,
never the API key or PDF base64) and the response (status, timestamps, duration, every raw
stream chunk, reconstructed content / reasoning / tool calls / finish_reason / usage, or the
error). Auxiliary AI calls (PDF upload via Responses API, background chat title generation)
are traced into the current chat's trace file too. Traces follow the existing delete /
migration paths of their chat/module files.

Confirmed decisions:

- **Viewing:** in-app read-only viewer (formatted JSON) + "Reveal in Finder" button.
- **Fidelity:** full raw capture — every raw stream chunk plus full request bodies.
- **Coverage:** all AI calls — main chat, PDF upload (Responses API), title generation, and
  module subagent runs.

## File-by-file changes

### `src/shared/types.ts`

- New `AiTraceRequest { ts, model, baseUrl, endpoint, params }` — `params` is the exact
  request body; `endpoint` is `'chat.completions' | 'responses' | 'title'`.
- New `AiTraceResponse { status: 'ok' | 'error' | 'stopped', ts, durationMs, chunks?,
  content?, reasoning?, toolCalls?, finishReason?, usage?, error? }`.
- New `AiTraceEntry { seq, turn?, request, response }` (`turn` = iteration index within a
  send).
- New `AiTraceFile { project, key, kind: 'chat' | 'module', startedAt, updatedAt, entries }`.

### `src/main/ai/trace.ts` (new)

- `AiTraceRecorder`: in-memory buffer of `AiTraceEntry[]` with `append()` and `flush()`;
  atomic write (tmp + rename, mirrors `writeChat`). Kept entirely in the main process.

### `src/main/service/PTNotesService.ts`

- Chat: `chatTracePath(project, sessionId)`, `writeChatTrace`, `readChatTrace`,
  `deleteChatTrace` — the delete is also called from `deleteChat`.
- Module: `moduleTracePath(project, runId)`, `writeModuleTrace`, `readModuleTrace`,
  `deleteModuleTrace` — removed in `deleteModuleRun` and `clearModuleHistoryRuns` (same
  blocks that remove `<runId>.chat.json`).
- No migration needed: trace files live inside `<project>/.data/`, which moves with the
  project on `changeRootDir` / project rename.

### `src/main/ai/chatSession.ts`

- Accept a per-send trace recorder (constructed in `ipc/ai.ts` from project + sessionId).
- `runTurn`: before `client.chat.completions.create`, record the request (serialized
  `apiMessages` + tool definitions + model + baseUrl). While streaming, append **every raw
  chunk** to the recorder; on completion reconstruct the response (content,
  `reasoning_content` as `reasoning`, delta tool calls, `finish_reason` / `usage` from the
  stream, duration). Record `error` and `stopped` outcomes too.
- `uploadPdf`: record the Responses-API request (prompt + filename + `file_id`, never the
  base64 payload) and the streamed response/errors.
- Flush the recorder after `send()` / `uploadPdf()` (best-effort).

### `src/main/ipc/ai.ts`

- `ai:send(project, sessionId, text, history, activeNoteId)` — new `sessionId` param so the
  main process knows which trace file to write.
- `ai:generateTitle(project, sessionId, firstMessage)` — trace the title call into the
  current chat's trace file.

### `src/preload/index.ts` + `src/preload/index.d.ts`

- Thread `sessionId` through `ai.send` / `ai.generateTitle`.
- New `chat.readTrace(project, sessionId)`, `modules.readTrace(project, runId)`
  (→ `AiTraceFile`), and reuse `files.reveal` for reveal-in-Finder.

### `src/main/ipc/index.ts` / `src/main/ipc/modules.ts`

- `chat:readTrace` handler (service disk read).
- `modules:readTrace` handler — live from the runner for active runs (like `readChat`),
  else from disk via the service.

### `src/main/modules/runner.ts`

- Add a trace recorder; `runTurn` records the request (apiMessages + tools + model) and the
  full non-streaming `reply` (message, `usage`, `finish_reason`, duration); flush after each
  turn alongside `persistChat()`.
- Fix `toTranscript` to stamp **per-message** timestamps (currently a single `Date.now()`
  reused for every message).
- Expose the live trace (like `transcript`) so the overlay can show it mid-run.

### `src/main/modules/runs.ts`

- `retry()`: also clear the run's trace file via `service.deleteModuleTrace` (next to the
  existing `.chat.json` reset).

### Renderer (trace viewer)

- New `src/renderer/src/components/TraceViewerModal.tsx`: read-only modal showing formatted
  JSON of an `AiTraceFile`, with "Reveal in Finder" (`files.reveal`) and copy-to-clipboard;
  store-driven open state.
- `src/renderer/src/components/ChatDrawer.tsx`: a "Trace" button on each chat-history item →
  `chat.readTrace` → open the modal.
- `src/renderer/src/components/ModuleHistoryOverlay.tsx` (and/or `ModuleCard`): a "Trace"
  button beside the 💬 transcript button → `modules.readTrace` → open the modal.

## Tests

- `scripts/test-chat.mts` / `scripts/test-modules.mts`:
  - Pure tests for `AiTraceRecorder` serialization (request/response reconstruction from
    mock stream chunks incl. reasoning + tool calls + usage/finish_reason).
  - End-to-end with a scripted LLM: assert the chat trace file records one entry per turn
    (request body matches the mock `messages` + tools; response reconstructs the streamed
    content) and that module runs record request + full `reply` per turn.

## Documentation updates (when finished)

- **`AGENTS.md`**:
  - On-disk layout: add `<sessionId>.trace.json` and `<runId>.trace.json`.
  - IPC surface: `chat:readTrace`, `modules:readTrace`, and the new `sessionId` params on
    `ai:send` / `ai:generateTitle`.
  - AI chat feature: a "Raw AI trace" note (what is captured, where it lives, the viewer).
- **`CHANGELOG.md`**: entry for the v0.9.0 feature bump.

## Invariants preserved

- The API key is never logged: trace entries store `baseUrl`/`model`/params, never
  `apiKey`; the PDF base64 payload is excluded (only `file_id`/filename).
- Trace files are separate from the display logs; `ChatThread` / `ModuleChatMessage`
  shapes and the renderer's markdown round-trip are untouched.
- The renderer still never touches the network/filesystem: traces are written by the main
  process and read back over IPC.
- Tracing is best-effort and non-fatal: a failed trace flush never fails a send/turn.
