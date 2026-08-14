# PLAN — v0.7.0

**Version:** 0.7.0

## Goals

- **Goal 1 — Human-in-the-Loop (`ask_user`)** — see below.
- **Goal 2 — Chat keyboard shortcuts** — see below.
- **Goal 3 — Markdown editor table bug** — see below.
- **Goal 4 — Markdown editor QoL** — see below.

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

---

## Goal 2: Chat keyboard shortcuts

Keyboard-driven chat: with the cursor in the chat input box, `Cmd/Ctrl+Shift+N`
starts a new chat and `Cmd/Ctrl+Shift+H` opens the chat history popup. The
history popup itself is navigable with the keyboard (`↑`/`↓` move the selector,
`Enter` opens the selected session). While the chat input is focused,
`Ctrl+Home`/`Ctrl+End` scroll the chat message list to the top/bottom and
`Ctrl+PageUp`/`Ctrl+PageDown` scroll it by one page. Globally,
`Cmd/Ctrl+Shift+C` toggles the chat panel (mirrors the top-bar Chat button).

### Scope decisions (locked in)

| Area                   | Decision                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modifier key           | `Cmd` on macOS, `Ctrl` on Windows/Linux (detected via `window.electron.process.platform === 'darwin'`)                                                     |
| Conflict avoidance     | `Shift`-modified shortcuts (`Cmd/Ctrl+Shift+N` / `Cmd/Ctrl+Shift+H` / `Cmd/Ctrl+Shift+C`) so the default Electron menu accelerators (`Cmd+N` New Window, `Cmd+H` Hide) never fire first — **no main-process menu changes needed** |
| Activation scope       | `N`/`H` + chat-list scroll keys only active while the chat textarea is focused; history nav keys only active while the popup is open; `C` toggle is global (ChatDrawer is always mounted) |
| Chat-list scroll keys  | `Ctrl` (not `Cmd`) on all platforms, per spec; instant (`behavior: 'auto'`) scrolling                                                                    |
| History popup nav      | `↑`/`↓` move selector (clamped, active item auto-scrolled into view), `Enter` opens the selected session, `Escape` closes + refocuses the input; skipped while a session is being renamed (the rename input owns its keys) |
| Selector sync          | Mouse **move** (`onMouseMove`) re-syncs the selector to the pointer only while the mouse is moving; a stationary pointer never steals it                  |

### Files to change

- `src/renderer/src/components/ChatDrawer.tsx`
- `src/renderer/src/assets/main.css`
- `AGENTS.md`, `CHANGELOG.md`

### 1. Renderer — `ChatDrawer.tsx` shortcuts in the textarea `onKeyDown`

Add a module-level `const IS_MAC = window.electron.process.platform === 'darwin'`
(available via `window.electron.process.platform` from `@electron-toolkit/preload`
— no preload/IPC changes).

At the **top** of `onKeyDown` (line 540), before all existing branches:

- `const mod = (IS_MAC ? e.metaKey : e.ctrlKey) && e.shiftKey`
- if `mod && !e.altKey`:
  - `n` → `e.preventDefault()`, `closeHistory()`, and if `!chatBusy && activeProject`
    mirror the "+ New Chat" button (`await newChat(activeProject); focusInput()`).
  - `h` → `e.preventDefault()`, toggle `historyOpen ? closeHistory() : openHistory()`;
    opening **blurs** the textarea (so the popup takes keyboard focus), closing
    refocuses it.
- Then `if (historyOpen) return` so plain keys defer to the history popup.

**Chat-list scrolling** (after the history early-return): if
`e.ctrlKey && !e.metaKey && !e.altKey` and the key is `Home`/`End`/`PageUp`/`PageDown`,
`e.preventDefault()` and scroll `scrollRef.current` (`.chat-scroll`):

- `Home` → `scrollTo({ top: 0, behavior: 'auto' })`
- `End` → `scrollTo({ top: el.scrollHeight, behavior: 'auto' })`
- `PageUp` → `el.scrollTop - el.clientHeight * 0.8`
- `PageDown` → `el.scrollTop + el.clientHeight * 0.8`

The existing `onScroll` handler already updates the jump-down button state after
these scrolls.

### 2. Renderer — history popup keyboard navigation

Extend the existing `historyOpen` window `keydown` effect (lines 169–176) with
`e.preventDefault()` on handled keys:

- `Escape` → `closeHistory()` + `focusInput()`.
- `ArrowDown` / `ArrowUp` → move `historyIndex` clamped to `[0, sessions.length - 1]`.
- `Enter` → open `sessions[Math.min(historyIndex, sessions.length - 1)]` via
  `openChat(activeProject, s.sessionId)`, then `closeHistory(); focusInput()`.
- Skip Arrow/Enter handling when `renamingId !== null` (rename input owns its keys).

Because this is a window-level listener it works whether the popup was opened by
mouse or by `Cmd/Ctrl+Shift+H`; the textarea early-returns while the popup is open
so only the window listener acts.

### 3. Renderer — history selector state + highlight

- Add `const [historyIndex, setHistoryIndex] = useState(0)`; reset to `0` in `openHistory()`.
- Render: add `active` class to `.chat-history-item` when
  `index === Math.min(historyIndex, sessions.length - 1)`.
- Mouse **move** over a history item (`onMouseMove`) re-syncs `historyIndex` to the
  pointer index — a stationary pointer does not move the selection.
- A `useEffect` calls `scrollIntoView({ block: 'nearest' })` on the active item
  whenever `historyIndex` changes, keeping the selector visible while navigating.

### 4. Renderer — global chat-panel toggle

`ChatDrawer` is always mounted (renders inside the collapsed `.chat-col` in
`App.tsx`), so a window-level `keydown` listener there is always active:

- Match `(IS_MAC ? e.metaKey : e.ctrlKey) && e.shiftKey && !e.altKey &&
  e.key.toLowerCase() === 'c'`; `e.preventDefault()`; `setChatOpen(!chatOpen)`
  — identical to the top-bar Chat button (`TopBar.tsx`). Works globally so the
  panel can be re-opened from anywhere. **Suppressed while a dialog/modal is
  open**: skipped when any `.modal-overlay` (shared `Modal`) or
  `.module-history-backdrop` (`ModuleHistoryOverlay`) exists in the DOM.

### 5. CSS — `main.css`

Add `.chat-history-item.active { background: var(--bg-hover); }` (mirrors the
existing `.chat-history-item:hover` rule).

### 6. Docs

Update `AGENTS.md` (chat UI section: shortcut summary) and `CHANGELOG.md`.

### Verification

No renderer test harness exists; verify via:

```bash
npm run typecheck
npm run lint
npm run build
```

plus manual QA: new chat + history toggle from the focused input, history
`↑`/`↓`/`Enter`, chat-list `Ctrl+Home`/`Ctrl+End`/`Ctrl+PageUp`/`Ctrl+PageDown`,
and the global `Cmd/Ctrl+Shift+C` panel toggle.

---

## Goal 3: Markdown editor table bug

The TipTap editor does not show markdown tables in notes — the whole table is
silently dropped on parse (and would serialize to `''`). Fix rendering +
round-trip and add an Insert Table toolbar button.

### Root cause (confirmed)

`StarterKit` does **not** include table extensions in TipTap v3, and no table
extensions are registered in `MarkdownEditor.tsx`. `@tiptap/markdown` lexes a
GFM table into a `table` marked token (via the `Table` extension's custom
`markdownTokenizer`); with no registered handler, `MarkdownManager.parseToken`
falls through to `parseFallbackToken` → `null`, dropping the entire table.
Serialization returns `''` for node types with no `renderMarkdown` handler.

Verified by probing the current setup:
`NODE TYPES: ["heading"]` (table content vanished).
`@tiptap/extension-table@3.29.2` ships full markdown integration
(`parseMarkdown` / `renderMarkdown` / `markdownTokenizer`); a throwaway install
round-trips idempotently:

```
| Name  | Age | City    |
| ----- | --- | ------- |
| Alice | 30  | Paris   |
| Bob   | 25  | Bangkok |
```

### Scope decisions (locked in)

| Area              | Decision                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table extensions  | `TableKit` from `@tiptap/extension-table@^3.29.2` (bundles `Table` / `TableRow` / `TableCell` / `TableHeader`); default `resizable: false` — no extra plugins |
| Markdown round-trip | Parse + serialize both work out of the box (extension ships `parseMarkdown`/`renderMarkdown`); serialization normalizes cell padding (cosmetic, idempotent) |
| Toolbar button    | **Insert Table** button added next to Horizontal rule → `insertTable({ rows: 3, cols: 3, withHeaderRow: true })`; active state when cursor is inside a table |
| Row/column controls | Contextual toolbar group (approach A), shown only while the cursor is inside a table (`isTable`): insert/delete column before+after, insert/delete row before+after, **Delete Table** (no merge/split — plain markdown tables can't represent merged cells). Built-in keymap already handles `Tab`/`Shift+Tab` cell navigation |
| Scope             | Editor-only fix; chat already renders tables via `react-markdown` GFM. No main-process/IPC changes                                                       |

### Files to change

- `package.json` (add `@tiptap/extension-table`)
- `src/renderer/src/components/MarkdownEditor.tsx`
- `src/renderer/src/assets/main.css`
- `scripts/test-markdown.mts`
- `CHANGELOG.md`

### 1. Dependency — `package.json`

```bash
npm install -D @tiptap/extension-table@^3.29.2
```

(devDependency, matching the other `@tiptap/*` packages.)

### 2. Renderer — `MarkdownEditor.tsx`

- Import `TableKit` from `@tiptap/extension-table` and `mdiTablePlus` from `@mdi/js`.
- Add `TableKit` to the `extensions` array in `useEditor` (the `Markdown`
  extension already present handles the markdown in/out integration).
- Add `isTable: ed.isActive('table')` to the `useEditorState` selector.
- New toolbar button (after Horizontal rule):
  `editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()`,
  `active={state.isTable}`.

### 3. CSS — `main.css`

Add `.ProseMirror` table styles (dark-mode aware via existing CSS vars,
mirroring the chat `.markdown-body` look at editor scale):

- `table { border-collapse: collapse; width: 100%; margin: 0 0 10px; }`
- `th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; vertical-align: top; }`
- `th { background: var(--bg-hover); font-weight: 600; }`
- `th.selectedCell, td.selectedCell { background: var(--accent-soft); }`

### 4. Tests — `scripts/test-markdown.mts`

Add `TableKit` to the extension list and assert:
- parse a GFM table → JSON contains `table` / `tableRow` / `tableHeader` / `tableCell`.
- serialize → re-parse produces the same table (round-trip idempotent).

### 5. Docs — `CHANGELOG.md`

Add a v0.7.0 **Fixed** entry (editor renders markdown tables) + **Added** note
for the Insert Table toolbar button.

### 6. Table row/column toolbar controls (approved follow-up)

The `@tiptap/extension-table` `Table` extension already exposes the commands
(`addColumnBefore/After`, `deleteColumn`, `addRowBefore/After`, `deleteRow`,
`deleteTable`) plus a built-in keymap (`Tab` next cell with
auto-append row at table end, `Shift+Tab` previous cell, `Delete`/`Backspace` on
a fully-selected table deletes it) — there is just no UI. Add a **contextual
toolbar group** shown only while the cursor is inside a table:

- `src/renderer/src/components/MarkdownEditor.tsx`:
  - Imports: MDI icons `mdiTableColumnPlusBefore/After`, `mdiTableColumnRemove`,
    `mdiTableRowPlusBefore/After`, `mdiTableRowRemove`, `mdiTableRemove`.
  - `useEditorState` selector additions:
    `canDeleteColumn: ed.can().deleteColumn()` (false at 1 column),
    `canDeleteRow: ed.can().deleteRow()` (false at 1 row).
  - When `state.isTable`, render after the Insert Table button a `tb-sep` +
    6 buttons mapping to the commands above; Delete column/row disabled via the
    can-states. The group auto-mounts/unmounts with `isTable`.
  - **No merge/split** — plain markdown tables can't represent merged cells, so
    `mergeOrSplit` is intentionally not exposed.
- No CSS changes (reuses `.tb-btn`/`.tb-sep`). No new dependencies.
- `CHANGELOG.md`: extend the "Tables in the markdown editor" Added entry with the
  row/column/delete controls.

### 7. Table cell right-click context menu (approved follow-up)

Right-clicking any table cell opens a `.note-menu` (same pattern as TodoPanel /
NoteList / SettingsDialog — `.menu-overlay` + `.note-menu` + `.note-menu-item`)
at the cursor with the **same actions as the toolbar** (insert/delete column and
row, delete table).

- `src/renderer/src/components/MarkdownEditor.tsx`:
  - State `tableMenu: { x, y } | null`; `useEffect` clears it when
    `!state.isTable` and on `Escape` (app convention: Escape closes popups).
  - `onContextMenu` on `<EditorContent>` (EditorContentProps forwards DOM props):
    - `e.target.closest('table')` gates the menu; otherwise close + default menu.
    - `e.preventDefault()`; place the caret in the clicked cell via
      `editor.view.posAtCoords({ left: e.clientX, top: e.clientY })` +
      `setTextSelection(pos)` so commands act on that cell even when the editor
      wasn't focused.
    - Clamp `x/y` to the viewport (menu is fixed-position).
  - Render `menu-overlay` (click / right-click closes) + `.note-menu` with the
    7 `note-menu-item` buttons (16px icons), grouped by two `.note-menu-sep`
    dividers (column | row | delete table); disabled states mirror the toolbar
    (`canDeleteColumn`/`canDeleteRow`), Delete table `.danger`.
- `main.css`: add `.note-menu-sep { height: 1px; background: var(--border); margin: 4px 6px; }`.
  Everything else reuses existing `note-menu` styles.
- `CHANGELOG.md`: extend the "Tables in the markdown editor" entry with the
  right-click context menu.

### Verification

```bash
npm run test         # includes scripts/test-markdown.mts
npm run typecheck
npm run lint
```

plus manual QA: open a note containing a markdown table → renders as a table;
edit a cell → auto-save keeps valid markdown; Insert Table creates a 3×3 table.

---

## Goal 4: Markdown editor QoL — underline, format helper, context menu

Markdown-editor quality-of-life: an **underline** toolbar button, a **format
helper** bubble popup that appears over a text selection with icon-only buttons
(Bold / Italic / Underline / Strikethrough / Inline code), a **right-click
format context menu** with the same actions, a **status-bar toggle** (right
side) that turns the bubble popup on/off, and a **Show Raw** toggle that swaps
the WYSIWYG editor for a plain markdown `<textarea>`.

### Scope decisions (locked in)

| Area                  | Decision                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Underline             | StarterKit **v3 already registers `Underline`** (verified in `starter-kit` source) — no new dependency. `@tiptap/markdown` round-trips it as GitLab-style `++text++` (verified empirically); toolbar button added after Italic → `toggleUnderline()` |
| Bubble popup          | `BubbleMenu` from `@tiptap/react/menus` (ships with `@tiptap/react`, pulls in `@tiptap/extension-bubble-menu` + floating-ui) — no new dependency. Icon-only buttons, shown when there is a **non-empty selection**, the editor has focus, and the cursor is **not inside a table** |
| Toggle scope          | Status-bar toggle controls **only the bubble popup**; the right-click format menu is **always available**                                                                                                                                                           |
| Context menu          | **Always shown** on right-click outside a table: keeps the selection when the click falls inside it, otherwise moves the cursor to the click point (`posAtCoords` + `setTextSelection`). Reuses the `.note-menu` pattern (icon + label items); table right-click menu unchanged |
| Bubble/context interplay | Opening the context menu hides the bubble (`setMeta(bubbleMenuKey, 'hide')`); closing the menu does **not** re-show it — the bubble only returns on a fresh selection change. No re-show logic |
| Persistence           | `ptnotes:formatHelper` in `localStorage`, **default ON**; read at store init, written on toggle (same pattern as `ptnotes:activeProject`)                                                                                                                            |
| Bubble close button   | `mdiCloseCircle` X button overlapping the bubble's top-right corner; clicking it closes the popup **and turns the feature off** (`setFormatHelperEnabled(false)`). `appendTo={() => document.body}` so the button isn't clipped by the editor's scroll container |
| Status-bar toggle     | Right side of the status bar, **icon + label** (`mdiFormatText` + "Format helper"), highlighted while enabled; tooltip "Format helper"                                                                                                                               |
| Show Raw toggle       | Second status-bar button, **left of the format-helper button**, label **"RAW"** (no icon). Swaps the toolbar + TipTap view for a `<textarea>` editing the raw markdown (monospace, `spellCheck={false}`, `autoFocus`). **Not persisted** and **not saved** — it's component-local state that resets to off on every note change (the editor remounts via `key={activeNoteId}`) |
| Raw autosave          | Debounced ~800ms auto-save (reuses `saveTimer`), same as the WYSIWYG editor. Leaving raw mode re-syncs the TipTap doc from the raw text via `setContent(rawText, { contentType: 'markdown', emitUpdate: false })` |

### Files to change

- `src/renderer/src/components/MarkdownEditor.tsx`
- `src/renderer/src/store/useAppStore.ts`
- `src/renderer/src/assets/main.css`
- `scripts/test-markdown.mts`
- `AGENTS.md`, `CHANGELOG.md`

### 1. Store — `useAppStore.ts`

- Add `formatHelperEnabled: boolean` (initialized from
  `localStorage.getItem('ptnotes:formatHelper') !== '0'`) + `setFormatHelperEnabled(enabled)`
  that persists `'1'`/`'0'` and updates state — same pattern as `ptnotes:activeProject`.

### 2. Renderer — `MarkdownEditor.tsx`

- Imports: `mdiFormatUnderline`, `mdiFormatText`, `mdiCloseCircle` from `@mdi/js`;
  `BubbleMenu` from `@tiptap/react/menus`; `PluginKey` from `@tiptap/pm/state`;
  `type { Editor }` from `@tiptap/react`.
- Module scope: `const bubbleMenuKey = new PluginKey('formatHelperBubble')`.
- `useEditorState` selector gains `isUnderline: ed.isActive('underline')`.
- **Toolbar:** Underline button inserted after Italic.
- **Shared `FormatButtons`** component (icon-only for the bubble, icon+label in the
  context menu via `withLabels`) renders the 5 actions with active states.
- **Bubble popup:** `{formatHelperEnabled && <BubbleMenu …>}` with
  `shouldShow` → non-empty selection, `view.hasFocus()`, not inside a table;
  renders `.bubble-menu` with the 5 buttons + the X close button
  (`setFormatHelperEnabled(false)`).
- **Context menu:** `EditorContent.onContextMenu` — outside a table: `preventDefault`,
  position via `posAtCoords`, keep selection if the click is inside it else move the
  cursor there, open `formatMenu` (`note-menu` + `menu-overlay`), dispatch `'hide'`
  meta on `bubbleMenuKey`. Closing the menu (overlay click / Escape / action) just
  clears `formatMenu` — no re-show. Table branch untouched.
- **Status bar:** `.editor-meta` becomes a flex row — left: "Saving to
  `notes/{noteId}.md` · markdown"; right: `.editor-meta-actions` grouping the
  **Show Raw** button (label "RAW", `toggleRaw()`) then the format-helper
  button.
- **Show Raw:** `rawMode`/`rawText` local state (default `false` — remount on note
  change resets it, no persistence). `toggleRaw()`: ON → snapshot
  `editor.getMarkdown()` into `rawText` + clear open menus; OFF →
  `setContent(rawText, …)` re-syncs the WYSIWYG doc. `handleRawChange` updates
  `rawText` + debounced `saveNote`. In raw mode the toolbar, `BubbleMenu` and
  format/table menus are not rendered.

### 3. CSS — `main.css`

- `.editor-meta`: `display:flex; justify-content:space-between`.
- `.editor-meta-actions` (flex row, gap) keeps the two status-bar buttons together.
- `.editor-raw` (monospace, `flex:1`, editor padding, no border/outline/resize).
- `.format-helper-toggle` (icon+label, gap, `.active` highlight).
- `.bubble-menu` (floating elevated container, `position:relative`) +
  `.bubble-close` (absolute top-right circle, hover → `--danger`).
- `.note-menu-item.active` highlight for the context menu.

### 4. Tests — `scripts/test-markdown.mts`

Add an underline assertion: parse `some ++under++ and **bold** text` → the middle
segment carries a `underline` mark, and re-serializing yields the same `++..++` string.

### Verification

```bash
npm run test         # includes scripts/test-markdown.mts
npm run typecheck
npm run lint
```

plus manual QA: select text → bubble with 5 icon buttons + X; format from the
bubble/toolbar/context menu; right-click always shows the format menu; toggling
the status-bar button (icon+label) hides/shows the bubble only; X button turns the
feature off and persists across restarts; **Show Raw** → editor becomes a raw
markdown textarea, edits auto-save, switching back re-syncs the WYSIWYG view,
and switching notes resets the toggle to off (not persisted).
