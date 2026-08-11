# PLAN — PTNotes Feature Goals

This document holds the implementation plans for the PTNotes feature roadmap. Each goal is
a self-contained plan; the current in-work goal is at the top.

---

# Goal 1 — Module chat history (read-only overlay)

## Objective

From every **module card** there is a button that opens that module run's **chat history**
in a **read-only panel overlaying the AI chat panel**. The user can read the subagent's
full conversation (prompt, assistant turns, tool calls/results, final summary) and **close
the panel to continue their current chat**. The module history is **separate** from the
main AI chat — opening/reading it never interrupts or alters the current chat session.

## Decisions (locked in)

| Decision | Choice |
| -------- | ------ |
| Trigger | History button on every `ModuleCard` (works in both the Modules sidebar tab and the inline chat card) |
| Rendering | Read-only overlay (portal to `document.body`) anchored over the right-side AI chat panel (`.chat-col`) |
| Data source | The module subagent's conversation transcript, persisted per run as `<project>/modules/<runId>.chat.json` |
| Persistence | Runner writes the transcript to disk after each model turn and at finish/fail; live runs are read from the in-memory runner snapshot |
| Display | Reuses existing bubble/tool rendering (MarkdownContent, think blocks, collapsible tool calls) |
| Interaction | View only: no input, no delete/rename/re-run inside the overlay |
| Scope | Main-chat separation guaranteed: overlay state is independent of `chatMessages` / chat session |

## Background (current state, verified)

- Module runs render via `ModuleCard` (`src/renderer/src/components/ModuleCard.tsx`) in two
  places:
  - `ModulePanel.tsx` (sidebar **Modules** tab, active + history lists).
  - `ChatDrawer.tsx` inline bubble when the assistant fires `start_module`
    (`m.moduleRunId` → `<ModuleCard ... compact defaultExpanded>`).
- The run snapshot `ModuleRun` (`src/shared/types.ts`) only holds `prompt`, `steps`,
  `summary`, `outputFile` — the subagent **conversation is NOT persisted today**.
- `ModuleRunner` (`src/main/modules/runner.ts`) keeps `this.messages` (system / user /
  assistant-with-tool_calls / tool) **in memory only**; it persists `run` snapshots via
  `ModuleRunManager.handleUpdate` → `writeModuleRun`, and the prompt via `writeModulePrompt`.
- Module files live in `<project>/modules/` (out of the `#` file picker): `<runId>.json`
  (snapshot) + `<runId>.prompt.json` (prompt). Deletion happens in
  `deleteModuleRun` / `clearModuleHistoryRuns` (`PTNotesService`), both of which must also
  clean the new chat file.
- Overlay/modal/portal patterns already exist: `chat-history-overlay` / `chat-history`
  (fixed, z-index 90/95, portal to `document.body`), `.modal-overlay` / `.modal`.

## Implementation steps

### 1. Shared types — `src/shared/types.ts`

Add a persisted transcript type (distinct from `ChatMessage`, whose role is only
user/assistant):

```ts
export interface ModuleChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  ts?: number
  name?: string            // tool name for role === 'tool' (plus merged into toolCalls)
  toolCalls?: ToolCallInfo[]  // role === 'assistant'
}
```

### 2. Service — `src/main/service/PTNotesService.ts`

- `moduleChatPath(project, runId)` → `join(modulesDir(project), \`${validateNoteId(runId)}.chat.json\`)`.
- `writeModuleChat(project, runId, messages: ModuleChatMessage[])` — mkdir + write JSON.
- `readModuleChat(project, runId): Promise<ModuleChatMessage[]>` — `[]` on missing/corrupt.
- In `deleteModuleRun` and `clearModuleHistoryRuns`: also `rm` the `\`${run.runId}.chat.json\`` file.

### 3. Runner — `src/main/modules/runner.ts`

- Add `private persistChat(): void` (best-effort; `catch` swallowed) that maps
  `this.messages` → `ModuleChatMessage[]`:
  - `system` → `{ role: 'system', content }`
  - `user` → `{ role: 'user', content }`
  - `assistant` with `tool_calls` → `{ role: 'assistant', content, toolCalls: [...] }`
    (parse `function.arguments` best-effort → `ToolCallInfo { id, name, args }`)
  - `assistant` without tool_calls → `{ role: 'assistant', content }`
  - `tool` → attach `{ ok, result }` to the matching `toolCalls` entry by `tool_call_id`;
    if unmatched, emit `{ role: 'tool', name: '', content }`.
- Add `get transcript(): ModuleChatMessage[]` (same mapping, for live reads by the manager).
- Call `persistChat()` in `start()` at the end of **each** iteration (after `runTurn`)
  and in `finish()` / `fail()`.

### 4. Manager — `src/main/modules/runs.ts`

- Add `async readChat(project, runId): Promise<ModuleChatMessage[]>`:
  - if an active runner exists for `runId` (and its `snapshot.project === project`),
    return `runner.transcript` (live);
  - else return `service.readModuleChat(project, runId)`.
- In `retry(...)`: clear the chat file (`writeModuleChat(project, runId, [])`) so a retry
  does not show the old transcript.

### 5. IPC — `src/main/ipc/modules.ts`

- Register `ipcMain.handle('modules:readChat', (_e, project, runId) => manager.readChat(project, runId))`.

### 6. Preload — `src/preload/index.ts`

- Add under the `modules` namespace:
  `readChat: (project, runId): Promise<ModuleChatMessage[]> => ipcRenderer.invoke('modules:readChat', project, runId)`.
- Import `ModuleChatMessage` into the type list. (The `PTNotesApi` type is derived from
  `typeof api`, so `index.d.ts` needs no change.)

### 7. Store — `src/renderer/src/store/useAppStore.ts`

- State: `moduleHistoryRunId: string | null` (project implied by `activeProject`).
- Action: `setModuleHistoryRunId(id: string | null)`.
- Reset it to `null` in `deleteProject` / `selectProject` if it pointed at a stale run.

### 8. Shared chat bubbles — extract helpers

Extract `splitContent`, `ThinkBox`, and `UserBubble` from `ChatDrawer.tsx` into a small
shared component module `src/renderer/src/components/chatBubbles.tsx`, and have both
`ChatDrawer` and the new overlay import them (avoids duplication, keeps XSS-safe
markdown handling identical).

### 9. Module card history button — `ModuleCard.tsx`

- Add a **History button** (`💬`, title "View module chat history") in the card header
  `status-area`, for **all** run states (live + finished):
  - `e.stopPropagation()` (unlike the click-to-toggle-actions handler).
  - Calls `useAppStore.getState().setModuleHistoryRunId(run.runId)`.
- Restructure the header slightly so the `status-area` (history + retry + delete + status)
  renders for active runs too.

### 10. Overlay — `src/renderer/src/components/ModuleHistoryOverlay.tsx` (new)

- Rendered at the App level when `moduleHistoryRunId && activeProject`, via portal to `document.body`.
- Props: none (reads store). On mount measure the `.chat-col` rect (fallback width 360) to
  position the panel exactly over the AI chat panel.
- Content:
  - Backdrop `.module-history-overlay` (fixed, inset 0, semi-transparent, clicks close).
  - Panel `.module-history-panel` (fixed right/top/bottom, width = chat-col width;
    z-index above the drawer). Esc closes it.
  - Header: module name + run title, live status badge + step progress (run fetched from
    `moduleRuns[project]` by `runId`), `✕` Close button.
  - Scrollable read-only transcript:
    - `system` → collapsed "System prompt" disclosure block.
    - `user` → user bubble (long messages collapsed via `UserBubble`), labelled "Prompt".
    - `assistant` content → `MarkdownContent` + `ThinkBox` segments.
    - `assistant.toolCalls` → collapsible tool bubbles (name, ok/fail, expandable `args`
      + `result`), mirroring ChatDrawer's `.chat-tools` rendering (read-only).
  - Live refresh: on mount fetch `modules.readChat`; subscribe to `modules.onEvent` and
    refetch when `evt.runId` matches (near-live updates for running runs). Clean up on close.
- Read-only: no textarea, no mention hints, no send/stop buttons.

### 11. Wire-up — `src/renderer/src/App.tsx` and `assets/main.css`

- In `App()` render `{activeProject && moduleHistoryRunId && <ModuleHistoryOverlay />}`.
- `main.css`: `.module-history-overlay`, `.module-history-panel`, `.module-history-header`,
  `.module-history-transcript`, reuse `.chat-msg`, `.chat-tools`, `.think-box`, `.user-bubble`.
- Small `.module-card-history-btn` style consistent with retry/delete buttons.

### 12. Tests — `scripts/test-modules.mts`

- Service: `writeModuleChat` / `readModuleChat` round-trip (content preserved; missing file → `[]`).
- Manager: after the existing scripted full pptx run, `manager.readChat(project, runId)`
  returns a transcript whose first message is the system prompt, includes the user prompt,
  and includes an assistant message whose `toolCalls` contain `create_pptx_file` with an
  `ok` result; assert the `.chat.json` file exists on disk and is deleted by
  `clearModuleHistoryRuns` / `deleteRun`.
- Retry clears the transcript: after `retry`, `readChat` no longer contains the old tool call.
- Live read: `readChat` returns in-memory transcript for an active run (optional smoke).

### 13. Docs

- `AGENTS.md`: add `modules:readChat` to the IPC surface; note the `<runId>.chat.json` file
  in the on-disk layout; describe the read-only module history overlay in the chat features
  section.
- `CHANGELOG.md`: entry for the new feature.

## Out of scope (not part of Goal 1)

- Editing/deleting/re-running from the overlay (delete/retry stay on the card).
- Showing module history inside the `chat:` session files — the run transcript is separate.
- Goal 2 (infographic shared tools + pptx integration) — see appendix.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run dev   # manual: open a run's history from Modules tab and from an inline chat card
```

---

# Goal 2 (existing, not started) — Infographic shared tools + PPTX integration + standalone module

## Objective

Create a **shared module tool** that renders infographics with the `@antv/infographic`
node package, integrate the tools into the **pptx module** (its subagent) so a rendered
infographic can be embedded on a PowerPoint slide. Additionally, ship a **standalone
`infographic` module** whose output tool saves a final `.svg` / `.png` deliverable into
`<project>/files/`.

## Decisions (locked in)

| Decision | Choice |
| -------- | ------ |
| Rendering engine | `@antv/infographic` (~7.7MB, 13 deps, MIT) |
| Rendering entry | `@antv/infographic/ssr` → `renderToString(syntax)` (Node, via `linkedom`) |
| PNG rasterization | `@resvg/resvg-js` (already a dependency, used by mermaid) |
| Isolation | Electron **utility process** worker (consistent with chart/diagram) |
| Template discovery | `list_infographic_templates` tool (model picks from ~200 built-in templates) |
| PPTX integration | Add `infographic` slide layout + shared tools to the pptx module |
| Standalone deliverable | New `infographic` module: `create_infographic_file` writes `.svg` + `.png` to `<project>/files/` |

## Key facts from research

- Module contract in `src/main/modules/types.ts`; runner merges `[...baseTools, ...module.tools, set_plan, update_step]`.
- Shared tool pattern (`createChartTools` / `createDiagramTools`): preview + render tools
  writing to `<project>/modules/temp/` via `uniqueModuleTempPath`, omitting `path`/`file`,
  cleaned by `cleanupModuleTempFiles` after the deck builds.
- `@antv/infographic` DSL: `infographic <template>` first line, then `data` / `design` /
  `theme` blocks (2-space indent). Deeps include ESM-only `lodash-es` → dynamic `import()`.
- Security invariants require heavy/native rendering isolated in utility-process workers.

## Implementation steps (summary)

1. Add `@antv/infographic` dependency.
2. `src/main/modules/shared/infographic.ts` — validate + `renderInfographicSvg` (dynamic import of
   `@antv/infographic/ssr`) + `renderInfographicPng` (Resvg) + bounds + DOM-global isolation.
3. `infographic-render-worker.ts` + `infographicRenderer.ts` — utility-process isolation,
   `PTNOTES_INFOGRAPHIC_WORKER` env override, 30s timeout, in-process fallback, `shutdownInfographicRenderer()`.
4. `src/main/modules/shared/createInfographicTools.ts` — `infographic_preview`,
   `render_infographic`, `list_infographic_templates`.
5. PPTX integration: `...createInfographicTools()` in `createPptxModule().tools`; `infographic`
   slide layout in `DESIGN_SCHEMA` + `builder.ts` (extract shared `placePicture` helper);
   `collectChartPngPaths` also collects `infographic` keys; systemPrompt guidance.
6. Standalone `src/main/modules/infographic/index.ts` — `createInfographicModule()` with
   `create_infographic_file` (writes `<project>/files/<slug>.svg` + `.png`);
   registered in `src/main/index.ts`.
7. `electron.vite.config.ts`: add `infographic-render-worker` main entry; `index.ts`: shutdown hook.
8. Tests in `scripts/test-modules.mts` (engine, tools, pptx slide, standalone module, disabled gate).
9. Docs: `AGENTS.md`, `CHANGELOG.md`.

## Risks to verify during implementation

- `renderToString` signature (string vs `{ syntax }`) and offline font/resource behavior.
- `lodash-es` ESM resolution from CJS bundles — mitigated via dynamic `import()`.