# PLAN — v0.7.0

**Version:** 0.7.0

## Goals

- **Goal 1 — Human-in-the-Loop (`ask_user`)** — see below.
- Goal 2 — *(to be defined)*
- Goal 3 — *(to be defined)*

---

## Goal 1: Human-in-the-Loop — `ask_user` tool

Add HITL support to the AI chat: the LLM can call a new `ask_user` tool to pose
one or more choice questions, which the user answers in a wizard dialog and
confirms. The answers are fed back to the model as the tool result so the
conversation loop continues with the user's input.

### Scope decisions (locked in)

| Area                | Decision                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Answer input types  | Each question supports **predefined choices** (radio, single-select), **multi-select** (`multiple: true` → checkboxes), or **free-text** (no `options`) |
| Availability        | **Chat only** — `ask_user` is filtered out of background module subagent tool lists (modules can't pop dialogs)                              |
| Unanswered handling | **Require all answered** — the Confirm button / Enter stays disabled until every question has an answer; the confirm pane flags missing ones |
| UX                  | Wizard-style two-pane dialog: left question list (1,2,3… + Confirm), right full question + options, Previous/Next at bottom-right           |
| Keyboard            | `↑`/`↓` change choice; radio `Enter`/`Tab` commits + next; checkbox `Space`/`Enter` toggles + `Tab` next; `Shift+Tab` previous; Confirm pane `Enter` confirms |

### Files to change

- `src/shared/types.ts`
- `src/shared/ask.ts` (new — pure, testable flow logic)
- `src/main/ai/tools.ts`
- `src/main/ai/chatSession.ts`
- `src/main/ai/config.ts` (no change)
- `src/main/ipc/ai.ts`
- `src/main/modules/runner.ts`
- `src/preload/index.ts`
- `src/renderer/src/store/useAppStore.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/AskUserDialog.tsx` (new)
- `src/renderer/src/components/ChatDrawer.tsx`
- `src/renderer/src/assets/main.css`
- `scripts/test-ask.mts` (new) + `package.json` test chain
- `AGENTS.md`, `CHANGELOG.md`

### 1. Shared types — `src/shared/types.ts`

```ts
export interface AskQuestion {
  id: string
  question: string
  options?: string[] // empty/omitted → free-text input
  multiple?: boolean // true → checkbox multi-select (default single radio)
}
export interface AskRequest {
  id: string
  project: string
  questions: AskQuestion[]
}
export interface AskAnswer {
  id: string
  answer: string // selected option text, joined multi-select, or typed free text
  selections?: string[] // full selection list when multiple
}
export interface AskResponse {
  id: string
  answers: AskAnswer[]
  cancelled?: boolean
}
```

`ChatStreamEvent` gains event type `'ask'` and `ask?: AskRequest`. This mirrors
the existing `confirm` mechanism.

### 2. Main — `src/main/ai/tools.ts`

- `ToolContext` gains an optional `ask`:
  `ask?: (req: Omit<AskRequest, 'id'>) => Promise<{ answers: AskAnswer[]; cancelled?: boolean }>`
  (optional because module subagents never provide it; `confirm` stays required).
- New tool **`ask_user`** (17th tool):
  - params: `questions: [{ id, question, options?, multiple? }]`, required `questions`.
  - validation: 1–8 questions; each has non-empty `id` + `question`; `options`
    is 2–6 strings when present, or absent/empty for free-text.
  - guard `if (!ctx.ask) return { ok:false, error:'ask_user requires the interactive chat' }`.
  - `const res = await ctx.ask({ project: ctx.activeProject, questions })`
  - returns `JSON.stringify({ ok: !res.cancelled, cancelled: !!res.cancelled, answers: res.answers })`.

### 3. Main — `src/main/ipc/ai.ts`

- New `pendingAsks` map + `ASK_TIMEOUT_MS = 120_000` (longer than confirm's 60s;
  on timeout resolves `{ answers: [], cancelled: true }`).
- `getSession` ctx provides `ask()`: generate `id`, send
  `{ type: 'ask', ask: { id, ...req } }`, await resolution.
- `SessionRegistry` gains `askResponse(resp: AskResponse): void`.
- New `ai:askResponse` handler.
- Timeout + resolve logic mirrors `pendingConfirms`.

### 4. Main — `src/main/ai/chatSession.ts`

- `buildSystemPrompt`: add guideline:
  "When you need user input — a choice, a detail, or confirmation — before you
  can proceed, call `ask_user` with your questions. You may ask several questions
  in a single call; the user answers them all at once. Only ask when genuinely
  needed."
- No loop changes; `ask_user` runs through the existing tool loop and blocks
  until the user answers.

### 5. Main — `src/main/modules/runner.ts`

- `toolList()` filters `ask_user` out of `baseTools` so background subagents
  never see it.

### 6. Preload — `src/preload/index.ts`

- Add `ai.askResponse(resp: AskResponse): Promise<void>` → `ipcRenderer.invoke('ai:askResponse', resp)`.
- Import `AskResponse` type.

### 7. Renderer — store + wiring

- `useAppStore.ts`: add `askRequest: AskRequest | null` + `setAskRequest(req)`.
- `App.tsx` stream listener: `case 'ask': if (evt.ask) state.setAskRequest(evt.ask)`.
- Render `<AskUserDialog />` alongside `<ConfirmDeleteDialog />`.

### 8. Renderer — `src/shared/ask.ts` (pure flow logic)

No DOM deps, testable (mirrors `@shared/slash.ts` pattern):

- `initFlow(questions)` → initial state:
  `{ pane: 0, cursor: number[], selections: (string[]|null)[], freeText: string[], answered: boolean[] }`
  (`pane` 0..N-1 = questions, N = confirm pane).
- `reduce(state, event, questions)` → `{ state, action?: 'next' | 'prev' | 'submit' }`
  handling `ArrowUp`/`ArrowDown` (move cursor), `Enter`/`Tab` (commit radio /
  advance), `Space` (toggle checkbox), `Shift+Tab` (previous pane), `Enter` on
  confirm pane (`submit`), `Escape` (cancel signal for the component).
- `isAllAnswered(state)` used to gate the confirm action.

### 9. Renderer — `AskUserDialog.tsx`

Modal (reuses `Modal`, wider ~660px) with a two-pane layout:

**Left pane** (`.ask-nav`): numbered `1. 2. 3. …` question rows + a final
**Confirm** row. Active row highlighted; long question text truncated with an
ellipsis (`white-space:nowrap; overflow:hidden; text-overflow:ellipsis`).
Clicking a row jumps to that pane.

**Right pane** (`.ask-pane`):
- *Question pane:* full question text (wraps), then a focusable options list —
  radio group (single) / checkbox group (`multiple`) / single-line text input
  (no options). Arrow-key cursor highlight persists per question; click
  selects/toggles.
- *Confirm pane:* summary `Q1 → answer` per question; missing ones flagged
  "Not answered".

**Bottom-right buttons** on every pane: `[Previous] [Next]` (question panes),
`[Previous] [Confirm]` (confirm pane). Previous disabled on pane 0; Confirm
disabled until all answered.

**Keyboard (exact spec):**
- `↑`/`↓`: move cursor highlight within the current question's options
  (free-text: default input behavior).
- Radio: `Enter` or `Tab` → commit highlighted option and go to next question.
- Checkbox: `Space` or `Enter` → check/uncheck highlighted option;
  `Tab` → go to next question.
- Free-text: `Enter` or `Tab` → go to next question.
- `Shift+Tab`: previous pane (all panes; on the confirm pane returns to the
  last question).
- Confirm pane: `Enter` → submit (requires all answered; otherwise jumps to the
  first unanswered question).
- `Escape` → cancel.
- Submit → `window.ptnotes.ai.askResponse({ id, answers, cancelled:false })`;
  Cancel/Escape → `cancelled:true`. Clears `askRequest` in store.

### 10. Renderer — `ChatDrawer.tsx` polish

`ask_user` tool bubbles show a compact Q&A summary (question → answer lines)
instead of raw JSON in the expanded result.

### 11. CSS — `main.css`

Add `.ask-dialog`, `.ask-layout`, `.ask-nav`, `.ask-nav-item(.active)`,
`.ask-pane`, `.ask-question-full`, `.ask-options`, `.ask-option(.checked .cursor)`,
`.ask-free-text`, `.ask-confirm-summary`, `.ask-nav-actions`.

### 12. Tests & docs

- New `scripts/test-ask.mts`:
  - `ask_user` tool validation + result JSON via mocked `ctx.ask` (answered + cancelled paths).
  - `shared/ask.ts` flow reducer: arrows, Enter/Tab commit + advance, Space
    toggle, Shift+Tab previous, confirm gate with unanswered questions.
  - Appended to the `test` script in `package.json`.
- Update `AGENTS.md` (tool table + count → 17, IPC surface `ai:askResponse`,
  chat UI section, security note that `ask_user` is chat-only) and `CHANGELOG.md`.

### Data flow

```
LLM calls ask_user(N questions)
  → ChatSession tool loop → tool.execute → ctx.ask(...)
    → ipc/ai.ts: emit { type:'ask', ask:{id, project, questions} }
      → renderer opens AskUserDialog (wizard)
        → user answers all + Confirm
      → renderer: ai.askResponse({ id, answers, cancelled })
    → ipc/ai.ts resolves the pending promise
  → tool returns { ok, cancelled, answers } → fed back as a `tool` message
  → loop continues with the user's answers in context
```

### Verification

```bash
npm run test         # includes scripts/test-ask.mts
npm run typecheck
npm run lint
```
