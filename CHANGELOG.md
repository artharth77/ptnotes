# Changelog

## [0.15.1-dev] — 2026-09-03

### Added

- **Command Palette (⌘K / Ctrl+K)**: global fuzzy action launcher, invoked from anywhere in the app.
  - Fuzzy-matches across every registered action (tab switches, settings openers, theme switches, project refreshes, create quick note, new chat, sidebar toggle, and future app-wide actions).
  - Keyboard navigation: `ArrowUp`/`ArrowDown` with wraparound-free index clamping, `Enter` runs the highlighted entry, `Esc` closes. Hover sets the active index; mouse click runs directly.
  - Per-action icon (`@mdi/js`), title, optional subtitle (e.g. currently active state for tabs/theme), plus a category label that becomes a **sticky grouped header** in the result list so the View / Create / Project / Settings / Appearance sections stay visually scannable even in long results.
  - 100% renderer-local store state (`commandPaletteOpen`, `commandPaletteQuery`, `commandPaletteActiveIndex`) — no network or file I/O.
- **Appearance / Theme system**: three built-in color-scheme modes, persisted to `localStorage` and applied instantly via CSS custom properties.
  - New dedicated **Appearance** tab in Settings (moved out of the bottom of the Storage pane): segmented `Light` / `Dark` / `System` buttons with active-state highlighting.
  - `:root[data-theme='light'|'dark']` override palettes; `:root[data-theme='system']` uses the existing `@media (prefers-color-scheme: dark)` branch. Explicit light/dark never collide with the media query.
  - `color-scheme: light/dark` set per-mode so native scrollbars and form controls follow the theme.
  - Quick-toggle theme button in the top bar: one click cycles `light → dark → system → light` with an icon that reflects the current mode (sun / moon / auto-brightness).
  - `init()` applies the saved theme to `<html data-theme="…">` on startup so there is no FOUC / light-then-dark flash.
- **Note Templates**: a built-in 400-line template library + UI picker in the New Note modal.
  - 15 presets: blank, meeting-notes, daily-journal, project-brief, task-list, sprint-retro, bug-report, prd, onboarding-checklist, brainstorm, swot, howto, decision-log, plus a recipes cookbook.
  - Two-column scrollable card grid in the Create Note modal: each card shows an emoji icon, preset name, and a one-line description; active card highlights with the accent-soft background.
  - After `createNote(title)` the chosen template's `content(title, new Date())` factory is applied via an immediate `saveNote`, so the editor opens pre-filled with a ready-to-edit structure.
  - Close/cancel paths always reset `selectedTemplate` back to `blank` so the next New Note doesn't inherit a stale choice.

### Fixed

- **Command Palette: active index out of bounds after filter updates** — when the user typed a narrower query (or any text that shortened the filtered list) the old `activeIndex` could point past the new array length; pressing `Enter` then ran `select(undefined)` and nothing happened. A `useEffect` now clamps `activeIndex` to `Math.min(activeIndex, Math.max(0, filtered.length - 1))` every time the filtered list changes, and the `ArrowDown`/`ArrowUp` handlers already did the right thing for per-keypress motion.
- **Settings Appearance pane grammar fix** — the hint text “Choose how PTNotes' color scheme.” was grammatically incomplete (no verb after “how”). Shortened to the natural “Choose PTNotes' color scheme.”.
- **Command Palette: sidebar toggle icon was misleading** — the `sidebar:toggle` action used `mdiWindowClose` (an X icon), which visually means “close a window”, not “show/hide a sidebar”. Replaced with `mdiMenu`, the universal hamburger/sidebar-toggle glyph that matches the top-bar button's intent.
- **Settings tab organization**: the Appearance settings were prototyped tacked onto the bottom of the **Storage** pane (semantically unrelated — storage is about root paths and file moves; appearance is about visual theming). Appearance is now its own first-class tab in the settings nav, ordered between Storage and AI Settings, with its own route branch inside the `SettingsDialog` render.

## [0.15.0] — 2026-08-31

### Added

- **Bots group chat**: multi-bot group conversations with identities, roles and memories.
  - **Bot library** (Settings ▸ Bots): global bot profiles — name, role, persona/standing instructions, optional AI-provider profile pick and per-bot model override (falls back to the active profile). Stored in a SQLite database (`node:sqlite` builtin — no dependency, nothing for users to install) at `userData/bots.db`.
  - **Group chats** (new **Bots** drawer view, `⌘⇧G`): create a group per project with a title, ≥1 bot and a designated **group leader**; group list/history popover with open/rename/trace/delete. Persisted in `<project>/.data/bots/groupchat.db` (groups, messages, memories, task queue) so it follows the project root.
  - **Routing engine** (enforced in code, `src/shared/bots.ts` + `src/main/bots/orchestrator.ts`): an untagged user message goes to the **leader**, who answers and/or assigns work by `@`-tagging bots; `@bot-id` in the user message routes to that bot directly; bots can tag other bots to ask/hand over work. Loop protection: a bot tagged by another bot answers **without tagging back** unless the tagger explicitly requested a relay — a single bot→bot→bot relay chain per user message (relay budget), deep turns are display-only, and a hard cap of 8 bot turns per user message.
  - **No tools in chat, full replies**: bot turns are plain non-streamed completions (reasoning/thinking is stripped, never rendered); while a bot composes, the panel shows "**\<name\>** is typing…" with animated dots; every message carries a timestamp (time for today, date+time otherwise). Task start/queued/failed notices appear as compact system lines.
  - **Background tasks**: when a bot takes on real work it ends its reply with an ```assign block (parsed out of the chat); the task runs as a hidden `bot-task` module run (base tools + `start_module`/`wait_modules`, so it can spawn sub-modules) with `submit_result` expected, titled "**\<bot name\> Task**" in the tasks panel. **Single-flight per bot**: one running task, further assignments queue and the bot acknowledges "queued"; on completion the bot posts a result report in the chat and pulls the next queued task. Runs live in the dedicated **Bot Tasks** panel (opened from the group chat header; same card/trace/transcript UI as Modules — hidden from the Modules panel, Settings ▸ Modules and `start_module` listings, and never deleted by the Modules panel's clear-all).
  - **Long chats**: when the un-summarized context exceeds ~8k chars the **leader** (background, never shown in the chat box) produces a rolling summary that replaces older messages in the bot system prompts; the last 6 messages always stay verbatim, the full log stays visible, and in the same cycle each involved bot extracts durable facts into its **per-project memory** (capped at 50 entries, viewable/forgettable in Settings ▸ Bots) that is injected into its future turns.
  - **Raw AI trace** per group (`<groupId>.trace.jsonl` in the bots dir) viewable via the existing trace viewer (history popover + header button).

## [0.14.3] — 2026-08-30

### Added

- **AI: repeated identical tool calls are now blocked**: when the model calls the same tool with identical arguments 5 times in a row (chat and background module runs), the call is no longer executed — the model receives a `{"ok": false, "error": "Blocked: …"}` tool result telling it to take a different action or answer directly, which breaks infinite same-call loops (previously each repeat re-executed until the turn limit, or forever in an "unlimited" chat). The identity is the tool name plus key-order-independent arguments, so retries with changed arguments still run; the counter resets on a different call and at each new user message, and `wait_modules` polling is exempt.

### Fixed

- **AI: `list_kanban_cards` did not return the card id**: the tool output only carried title and fields, so the model could not verify which card a `kanban:<card id>` reference resolved to (or report a card's id). Each listed card now includes its `id`.
- **Kanban: all cards played the move animation when focus changed after scrolling or a sidebar toggle**: with the board horizontally scrolled (or a column / the sidebar list vertically scrolled), or right after hiding/showing the left panel, changing the focused card (click, arrow keys, "jump to card") made **every** card play the 200ms FLIP move animation at once. `useFlip` measured card positions with viewport-relative `getBoundingClientRect()` on every render, so any re-render after a scroll — or after the sidebar's 250ms width transition had shifted the board — saw all cards as moved. Positions are now measured in the card's own scroll container's content space (element viewport rect − container viewport rect + accumulated scroll offsets of the container and intermediate scrollable ancestors, e.g. a column's card list), which is invariant to container scrolling and container movement; only real layout changes (drag & drop, add/remove, filtering) trigger the animation.

## [0.14.2] — 2026-08-29

### Added

- **Kanban board keyboard navigation**: when a card is focused on the board view (click it), `ArrowUp`/`ArrowDown` move focus to the previous/next card in the same column (clamped at the ends) and `ArrowLeft`/`ArrowRight` move to the nearest adjacent column that has visible cards (skipping empty columns), keeping the row index where possible (clamped to the target column's length). `Enter` opens the focused card in the editor (same as double-click). Navigation operates on the filtered (visible) card set, the focused card is kept in view by the existing scroll-into-center behavior, and handled keys are consumed so the board doesn't scroll. Keys are ignored while a modal or the card context menu is open, when focus is in an input/textarea/select/button/contenteditable (filter bar, chat, editor), or when a modifier key is held.
- **Kanban card modal assignee autocomplete**: the Assignee field in the card create/edit dialog now shows an autocomplete dropdown fed by assignees already used on the board — it opens on focus (when any exist), filters case-insensitively as you type (an exact current match is excluded), and is keyboard navigable (`ArrowUp`/`ArrowDown` cycle with wraparound, `Enter` accepts the highlighted suggestion, `Escape` closes; mouse click works too). Selecting a suggestion fills the field; the value still persists through the modal's existing Save path, so nothing changes about when edits are written. The dropdown is not shown in the read-only archive view.

### Fixed

- **Kanban lost updates between the UI and background runs**: the UI edited cards/comments/columns by sending the **whole board** from a stale renderer copy (`kanban:save`), so any comment, column change or card a chat tool / module run wrote between the UI's load and its next save was silently overwritten (the 0.14.1 per-project lock only serialized main-process operations — it cannot protect a stale full-board write).
  - **Granular IPC**: `kanban:save` is removed; the renderer now issues per-operation calls — cards (`createCard`, `updateCard`, `moveCard` with in-column index, `deleteCard`), comments (`addComment`, `updateComment`, `deleteComment`) and columns (`addColumn`, `updateColumn` re-slugs + remaps the column's cards, `moveColumn`, `deleteColumn` with move/delete card mode and a ≥1-column guard) — each a locked read-modify-write in `PTNotesService` returning the updated board, which the store adopts (optimistic local update for drags/deletes, re-fetch on error).
  - **Comments are no longer replaceable by card edits**: the card modal's field save excludes `comments` — comments only change through the comment operations — so background comments added while a card modal is open survive the modal's save; `updateKanbanCard` still accepts an explicit `comments` patch (validated) for programmatic use, and `createKanbanCard` accepts initial `comments`.
  - **Regression tests**: 15 concurrent `addKanbanComment` on one card (no losses, unique ids), comment update/delete round-trips with server-generated ids, column add/rename/remap/move/delete (both modes), the ≥1-column guard, and a `comments` patch through `updateKanbanCard` (`test-service.mts`).

## [0.14.1] — 2026-08-29

### Fixed

- **Concurrent file-write conflicts (notes, kanban, planner)**: AI chat tools, background module runs (subagent) and the UI all mutate the same project files through read-modify-write cycles with no serialization — concurrent writers could lose updates (last writer wins) and shared fixed `.tmp` paths could make one writer's rename fail with ENOENT (leaving one tool call erroring).
  - **Per-project serialization**: promise-chain queues in `PTNotesService` now serialize kanban board/archive, note, and planner schedule/calendar operations per project (projects stay independent). Public mutators (`saveKanban`, `saveNote`, `saveSchedule`, card/task/archive mutations, `loadKanban`'s legacy TODO.md migration) are wrapped; internal raw read/write helpers keep the locks non-reentrant.
  - **Atomic writes**: all JSON and markdown stores now write through a unique `randomUUID()` tmp file + rename with best-effort tmp cleanup on failure (`atomicWrite`/`atomicWriteJson`) — kanban board/archive, chat threads, planner schedules/calendar, and notes (previously plain `fs.writeFile`).
  - **Atomic AI tool mutations**: `update_note` hunks are now validated and applied against the note's current content inside the lock (`withNote`), so concurrent edits can no longer shift line targets; `create_note` is a single atomic find-or-create (`upsertNote`), eliminating duplicate `-2` notes under concurrency; `add_task`/`update_task` run inside `withSchedule` (read → mutate → write in one locked step); `set_calendar`'s re-roll of all schedules moved into a single locked `rerollSchedules` pass.
  - **UI stays in sync with background runs**: module runs (e.g. the subagent) completing note, kanban or planner tool calls now refresh the notes list / kanban board / schedule list, reload the active note, and re-select the active schedule (or reload the working-day calendar after `set_calendar`) in the renderer (previously only the main chat path did), so a later UI save cannot wipe background changes.
  - **Turn limit now fails the run**: a module run that exhausts its `maxIterations` turn budget without producing a final answer is marked **failed** with a message ("Reached the turn limit (N model turns) without finishing. Partial progress is saved — start the module again to continue.") instead of staying stuck on **Running** forever; the transcript/trace still shows everything it did.
  - **Editor drops a deleted active note**: when `delete_note` runs in chat or a module run while that note is open, the editor now returns to the "no note loaded" state — previously `activeNoteId` kept pointing at the deleted file and typing would silently resurrect it via a save. Renaming the active note still keeps it in the editor under the new id.
  - **Concurrency regression tests**: parallel `createKanbanCard`/`createNote`/`createSchedule`/`add_task`/`update_note`/`upsertNote` suites in `test-service.mts`, `test-ai.mts` and `test-planner.mts` (no lost updates, no duplicate ids, no stray tmp files).

### Changed

- **No double confirmation for AI deletions**: `delete_note`, `delete_kanban_card` and `delete_skill` already pop the app's own confirmation dialog before deleting, but the model was nudged to pre-confirm via `ask_user` ("a choice, a detail, or confirmation" / "Requires user confirmation") — users got asked twice for one deletion. The `ask_user` guidance (system prompt + tool description) is now for choices/details only and explicitly names the deletion tools as auto-confirmed; each deletion tool description states the dialog is automatic and must not be preceded by `ask_user`.
- **Agents fill the kanban card description**: the subagent system prompt and `create_kanban_card` tool description now say outright to always pass the card details in the `description` parameter — never a bare title-only card — and to change existing cards with `update_kanban_card` instead of creating duplicates (the schemas always supported `description`; models were skipping it).

## [0.14.0] — 2026-08-28

### Added

- **Kanban board (replaces the Todo list)**: each project now has a kanban board with columns and cards. Cards carry a title, description, priority (high/medium/low), due date (relative display — "today", "3 days", "1 week"; overdue shown as the absolute date in red), labels, story points, assignee, and free-form key/value attributes.
  - **UI**: the sidebar lists columns with collapsible card rows and context menus (cards: open / move to column / delete; columns: rename / delete); the main area renders columns horizontally with native HTML5 drag & drop (drop before/append within a column, or onto another column). Board cards support a right-click context menu (edit / delete / move to column). Columns can be reordered by dragging their handle in both the sidebar list and the board view. Card labels are entered in a chip/tag input (labels render as pills with a remove button) that autocompletes from labels already used elsewhere on the board while typing and offers a "new" option to create a fresh label. The create/edit dialog is wider with a fixed height: row 1 has title + assignee (title takes 3/4), row 2 has a narrow column field, due date, story points, and a segmented priority control (icons, none is ✕), followed by labels, description, and an attributes list with an icon-only add button beside its label; the attribute key field is 30% wide. Each attribute row has a secret toggle (key icon) that marks the key as holding a secret (default off), persisted as `secretAttributes` on the card; duplicate attribute keys are shown in red and Save (and Enter) is disabled until they are resolved. The form content scrolls independently while the bottom action bar (Delete/Cancel/Save) stays fixed. Clicking a card opens a unified create/edit modal with a two-step delete. Columns can be added, renamed, and deleted (a board keeps at least four columns — the Delete column action is disabled below that; its cards move to the first remaining column, named in the confirm dialog, or are deleted).
  - **Storage**: `kanban/board.json` per project — `{ version, columns[], cards[] }` with a flat cards array (array order = card order) and UUID card ids; whole-board atomic writes (tmp + rename). New projects are initialized with the default Backlog / To Do / In Progress / Done columns.
  - **Migration**: a legacy `TODO.md` in a project folder is migrated on first load — open lines → To Do, checked lines → Done — and then deleted. New boards and migrated boards assign each default column a preset color from the KANBAN palette (Backlog gray, To Do blue, In Progress orange, Done green).
- **Kanban board filter bar**: a filter bar now sits above the board card view with five filters that combine with AND. Name/description text input (case-insensitive substring match on title or description); assignee text input with an autocomplete dropdown fed by assignees already used on the board (keyboard navigable, clear button); priority segmented control (Any/Low/Med/High); a label button (default "No selected labels", switches to "1 label" / "2 labels"…) that opens a popup with a label-filter textbox and a checkbox list of board labels — toggling a checkbox adds/removes it from the filter, and a card must carry **all** selected labels; due-date select with Overdue / Due today / Next 7 / 14 / 30 days (upcoming only — overdue cards are matched by the Overdue preset, not the windows) / No due date. When any filter is active the bar shows a matching/total card count and a Clear button, column counts switch to the filtered count (hover shows the total), and empty columns say "No matching cards". Filtering is view-only — drag & drop and editing are unaffected (hidden cards remain draggable from the sidebar); filter state is session-local to the board view and resets on tab/project switch.
- **5 kanban AI tools**: `list_kanban_cards` (all cards grouped by column with priority / due date / labels / assignee / story points), `create_kanban_card` (required title; optional description, column matched by name — default "To Do" —, priority, labels, dueDate, storyPoints, assignee, key/value attributes), `update_kanban_card` (matched by title, case-insensitive; only the provided fields are changed, `null` clears, `newTitle` renames), `move_kanban_card` (card by title → column by name), `delete_kanban_card` (requires user confirmation).
- **`kanban:` links + `!` card mentions**: the `!` mention picker now lists kanban cards and inserts `kanban:<card title>`; the AI can link to cards with clickable `[name](kanban:name)` links, which open the card editor (same pill pattern as `note:` links).

### Changed

- **Todo tab → Kanban tab**: the middle-column tab is now Kanban (sidebar + board view instead of the checklist panel); the welcome note, empty-state copy, and Settings wording updated to match.
- **IPC**: the `todos:*` handlers are replaced by `kanban:load` (board; runs the legacy `TODO.md` migration on first load) and `kanban:save` (whole board, normalized, atomic tmp + rename).
- System-prompt and subagent guidance updated to the kanban tools and the `kanban:` link format; base tool count is now 24 (36 with the browser toolset).
- Docs updated (`docs/ARCHITECTURE.md`, `README.md`, `AGENTS.md`, `docs/module-development.md`).

### Removed

- **Todo list**: the markdown checklist (`TODO.md`), the `TodoPanel` component, the todo service/IPC methods, and the 4 todo AI tools (`create_todos`, `toggle_todo`, `delete_todo`, `list_todos`). Existing `TODO.md` files are not lost — they migrate to the kanban board on first load.

## [0.13.4] — 2026-08-27

### Changed

- **Chat input history navigation now respects typed text**: `ArrowUp`/`ArrowDown` only cycle through previous user messages when the input box is empty. Once the user starts typing anything, the keys revert to normal caret movement until the input is cleared to blank again, preventing accidental overwrites of in-progress messages. In-progress history navigation (after an `ArrowUp` recall) still allows cycling until cleared.
- **`read_skill` and `read_skill_file` merged into one tool**: the two skill-reading tools are now a single `read_skill` with an optional `file` parameter — omit `file` to load the skill's `SKILL.md` instructions, or pass a relative path like `FORMAT.md` or `doc/DOC.md` (e.g. `[FORMAT.md](./FORMAT.md)` in `SKILL.md`) to load a sibling file inside that skill's folder (PDF and text files supported, relative-only, no traversal). The redundant `skill` alias param was removed (use `name`). System prompts (`chatSession.ts` + `modules/runner.ts`), `docs/ARCHITECTURE.md` (tool table + module section, count header `25+12=37` → `24+12=36`), and `docs/module-development.md` updated; base tool count is now 24 (36 with browser toolset).
- **Prompt token reduction (conservative, examples kept)**: `project` param hidden from all 22 base tools (server-injects current project via `projectOf`; all operations now target the active project — switch project in UI to cross projects), `update_note`/`ask_user`/`add_task`+`update_task` keep their hunk/secret/TaskLocator examples for model clarity, shared hints extracted to new `src/main/ai/promptConstants.ts` (`SKILLS_PREAMBLE`, `TASK_LOCATOR_HINT`, `RENDER_HINT`) to deduplicate chart/diagram/infographic/`Pure local` boilerplate, chat system prompt made cacheable by removing `Active project` (now sent as `[Context] Active project: "…"` user suffix via `buildActiveContextSuffix` on first turn and on project switch, hidden from UI, same pattern as active note/schedule; `clear()` resets context) and keeping `Current date:` at end (daily miss acceptable), module prompt keeps `Current project:` + `Current date:` at end. Saves ~180t/turn from `project` removal plus shared dedup.
- **PPTX/DOCX icons now optional (AI decides)**: `PowerPoint` module no longer forces an icon on every title/section/statement slide, and `Word` module no longer forces an icon on the title page — prompts now say `Optionally add a tasteful Lucide icon when it aids clarity …; otherwise omit "icon"` (docx) / `… if useful, call search_lucide_icons …` (pptx). Tools remain available; `DESIGN_SCHEMA` still documents `icon` as optional.
- **DOCX table width always assigned**: `Word` table blocks now accept `widths` (per-column percentages, equal if omitted, normalized to 100) and `width` (table width % 10-100, default 100) plus `DESIGN_SCHEMA` docs; builder sets `Table width: tableWidth%` and `TableCell width: colWidths[col]%` so every inserted table has explicit widths.
- **Module live tools moved to history overlay**: `inFlightTools` (receiving/queued/running) no longer shown on `ModuleCard`; the `ModuleHistoryOverlay` now renders them at the end of the chat (after transcript, before `Module is still running…`) with spinner/⏳ + name + state, auto-scroll pinned and cleared on `done`/`failed`/`cancelled`.
- **Chat bubble per-bubble selection (JS, AI chat only)**: selection isolated per `.chat-msg` bubble via JS in `ChatDrawer` (only AI chat, module/history overlay not handled). `mousedown` on a bubble locks other bubbles + `body`/`chat-drawer` to `user-select:none` (origin stays `text`) to prevent flicker when dragging to another bubble, status bar, panel title or outside panel; `selectionchange` clamps `anchorBubble !== focusBubble` to origin; `Cmd/Ctrl+A` inside a bubble selects only that bubble, inside chat panel selects only the panel, outside selects nothing. `You`/`Assistant` labels (`chat-msg-label`) set `user-select:none` so they are never copied.
- **Chat bubble right-click menu**: right-click inside any bubble shows `Copy message` (`mdi/content-copy`), `Copy selection` (`mdi/select`, only if selection inside that bubble), `Select all` (`mdi/select-all`, selects that bubble via `range.selectNodeContents`), and for user bubbles `Copy & paste to prompt` (`mdi/keyboard-return`, copies and sets `input`). Menu at `fixed {x,y}` clamped to viewport via `bubbleMenuRef` measurement (`right/bottom` margin 8) and `white-space: nowrap` on `note-menu-item` so `Copy & paste to prompt` stays single line.

## [0.13.3] — 2026-08-26

### Changed

- **`update_note` is now line-based, diff-style editing**: the tool takes an `edits` array of `{startLine, endLine, content}` hunks (1-based inclusive, same convention as `read_note`) instead of a full-content overwrite. A hunk replaces lines `startLine..endLine` with `content`; `endLine = startLine - 1` inserts before `startLine`; `startLine = totalLines + 1` appends at the end; an empty `content` deletes the lines. All hunks reference the original line numbers and are applied bottom-up in one atomic write, so multiple hunks never shift each other; overlapping hunks and out-of-range lines are rejected with an error and nothing is written. The note must already exist — the error points to `create_note`. The result now includes the new `totalLines`.
- **`create_note` owns whole-note writes**: its description now states the split — `create_note` creates a new note or fully rewrites an existing one, while `update_note` is for targeted line edits. When `create_note` rewrites the note the user is currently viewing, the open note view now reloads (previously only `update_note` triggered the reload).
- System-prompt and subagent guidance updated to the read-then-edit flow (`read_note` for line numbers, then `update_note` hunks).
- **`read_note` now returns line-numbered content**: each line is prefixed with its 1-based line number (absolute numbers, even for ranged reads), so the AI targets `update_note` hunks at the exact lines instead of counting by eye — this fixes off-by-one edits that hit the blank line before the intended line. Tool descriptions and prompts now say to use the displayed numbers verbatim and never include the prefixes in written content.
- **Live tool-call status in chat**: tool-call bubbles now show their lifecycle in real time — "receiving…" while the model streams the call, then `queued` / `running…` as each tool executes (tools still run sequentially), settling into the final 🛠/⚠️ state with the result. Stop or a stream error marks unfinished calls as interrupted. The transient `status` is never persisted to saved chats.
- **Live tool-call status on module cards**: module runs now broadcast the same lifecycle for the subagent's own tool calls (`receiving` → `queued` → `running` → `done`) via a new transient `'tool'` module event; active cards in the Module panel show compact live rows (spinner + tool name + state) for every in-flight call, and rows clear when a call settles or the run reaches a terminal state. Calls rejected by the mandatory-first-`set_plan` guard settle with `ok:false`.
- **Failed tool responses highlighted in the AI trace viewer**: in the trace message list, tool entries whose result carries `"ok":false` (error response) now render their tool name in red for quick scanning.
- **`browser_screenshot` defaults to the active project**: when the `project` parameter is omitted, the screenshot is now saved to the active project's `screenshots/` folder (resolved per call from the chat session) instead of the notes root's `screenshots/` folder. If there is no active project, the tool returns an error.
- **`list_notes` and `search_notes` merged into one tool**: the two note tools are now a single `list_notes` with an optional `query` parameter — omit `query` to list all note titles, or pass a word/phrase to return only notes whose title or content matches (with a short snippet). System-prompt and subagent guidance updated to match; base tool count is now 25.

## [0.13.2] — 2026-08-25

### Added

- **Splash screen on startup**: a small frameless window with the app icon, "PTNotes" title and a spinner appears as soon as the app launches (before settings/service init), and closes when the main window is ready to show — no more blank screen during startup. The splash skips the taskbar, isn't resizable, and is also dismissed if the renderer fails to load.
- **Copy buttons in the AI trace viewer detail pane**: labeled content blocks in the item-detail view now get an icon button (right of the block label) that copies the raw text to the clipboard — Content for system/user/assistant messages, Result for tool calls, assistant Reasoning (the button inside the collapsible summary no longer toggles it), and per-tool-call arguments JSON. The icon swaps to a checkmark for 1.5s after copying.
- **Chat tool-loop confirmation**: when the chat hits the 12-iteration tool-loop cap and the model still wants to continue, the user is asked how to proceed — allow 12 more steps, allow until finished, or stop. Closing the dialog stops the chat. Pending `ask_user` responses are also resolved on session stop/clear (defensive).
- **Secret answers in `ask_user`**: questions can now be flagged `secret: true` for sensitive input (passwords, API keys, tokens). The dialog renders a masked input with a lock badge and shows `••••••` on the confirm pane and in the chat's Q&A bubble. The answer is held in an in-memory per-session map only — the model receives a `${SECRET:<id>}` token instead of the value, and when it later passes that token into a `browser_*` tool argument the app substitutes the real value right before execution (unknown/stale tokens fail the call). Tokens — never values — are written to the conversation, the raw AI trace, and all UI surfaces; secrets are dropped when the chat is cleared or the app quits.

### Changed

#### Browser snapshot coverage (`browser_snapshot`)

- **Accessible-name computation rewritten**: names now resolve `aria-label` → `aria-labelledby` (id refs resolved) → `<label>` association (wrapping or `for=`) → placeholder → `title` → `alt` → text content. Input buttons (`type=submit/reset/button/file`) read their `value` attribute (previously always empty names); `input type=image` uses `alt`; SVGs with `<title>` are named images. The generic text fallback now only applies to leaf elements, removing the previous name/text duplication on containers.
- **Form state is now visible to the AI**: textboxes/searchboxes/spinbuttons expose their current `value`, `<select>` exposes its selected option(s), and `aria-describedby` is captured as a `description` field.
- **ARIA-aware element state**: checkbox/radio/switch/menuitemcheckbox/menuitemradio prefer `aria-checked` over the DOM property (custom role-based widgets no longer report unchecked) with `indeterminate` support; `aria-disabled`, toggle-button `aria-pressed`, slider/progressbar/spinbutton `aria-valuenow`, heading `aria-level` for non-`h*` elements, and native `option.selected` are all captured.
- **Traversal scope widened**: open shadow roots (`element.shadowRoot`) and same-origin iframe documents (`contentDocument`, cross-origin safely skipped) are now included; `contenteditable` elements infer role `textbox` and receive refs so `browser_type` can target rich-text editors.
- **Clickables without `onclick` are now detected**: an element receives a ref if it carries any inline `on*` event-handler attribute (`onmousedown`, `onpointerdown`, `ontouchstart`, …), has an interactive ARIA attribute (`aria-haspopup`, `aria-expanded`, `aria-pressed`, `aria-activedescendant`, `aria-controls`), or computes to `cursor: pointer` — so framework-built clickables (React/Vue `onClick`, jQuery `.on()`) on plain `span`/`div` are now targetable via `browser_click`.
- **Role table extended**: `hr`→separator, `progress`/`meter`→progressbar, `output`→status, `<search>`→search, `menu`/`dl`→list, `datalist` and multi-select `select`→listbox, `area`→link, `canvas`→img, `input type=search`→searchbox. Explicit `role="presentation"/"none"` renders as a transparent container (no name/state/ref).
- **Visibility heuristic** additionally treats `opacity: 0` and `visibility: collapse` as hidden.
- **Ref attribute renamed** `data-ref` → `data-ptnotes-ref` so snapshots no longer clobber host pages that use their own `data-ref` attributes.
- **Honest truncation**: subtrees cut by the `depth` parameter are marked `truncated: true`, and traversal stops at a node cap — 1500 _visible_ elements by default (hidden elements don't consume the budget) — setting top-level `nodesTruncated` instead of slicing the JSON output mid-string at 300k chars. New optional `maxNodes` parameter on `browser_snapshot` (1–20000) raises the ceiling for very large pages.
- **No more blank names in snapshots**: nodes without an accessible name omit the `name` field entirely and carry `tag` (lowercase HTML tag, e.g. `"div"`) instead, so every node stays identifiable without empty-string noise.
- Docs updated (`docs/ARCHITECTURE.md` → Browser toolset).

#### Ask dialog

- **Single single-select questions submit on click**: when the `ask_user` tool (or the new tool-loop confirmation) presents a single multiple-choice question, clicking an option immediately submits the answer — no confirm pane. Multi-question and free-text flows are unchanged.

## [0.13.1] — 2026-08-25

### Added

- **Browser maximize option**: new "Maximize browser window" toggle in Settings ▸ Toolsets (below the existing headless toggle). When enabled, the browser launches maximized — uses `--start-maximized` on Windows/Linux and `--window-size` + `--window-position` on macOS. The viewport is set to `null` so Playwright does not constrain the page size. Persisted as `browserMaximize` in `ptnotes-settings.json`.
- **Browser HTTPS certificate bypass**: new "Ignore HTTPS certificate errors" toggle in Settings ▸ Toolsets. When enabled, Playwright skips certificate verification (`ignoreHTTPSErrors: true`). Only use with trusted sites — never enter sensitive data while this is enabled. Persisted as `browserIgnoreHttpsErrors` in `ptnotes-settings.json`.

### Changed

- AI chat streaming now keeps the busy/indicator state for 1 second after the stream ends, giving the user time to see the last content before the UI transitions. The Stop button still takes effect immediately.

## [0.13.0] — 2026-08-24

### Added

#### Browser toolset (in-app MCP, chat-only)

- **Playwright browser control** via an in-process MCP server + client over `InMemoryTransport`, implemented in `src/main/mcp/`. Uses `playwright-core` to drive installed Chrome or Edge (no bundled Chromium — auto-detects `channel: 'chrome'` then `channel: 'msedge'`; if neither is installed, browser tools return a clear error). Headful by default.
- **12 browser tools** (chat-only, never in module subagents): `browser_navigate`, `browser_navigate_back`, `browser_snapshot` (structured JSON accessibility tree), `browser_click`, `browser_type`, `browser_select_option`, `browser_press_key`, `browser_screenshot` (PNG), `browser_evaluate` (run JS on page), `browser_wait_for`, `browser_set_mode` (headful/headless toggle), `browser_close`.
- **Structured `browser_snapshot`**: returns a JSON tree with `role`, `name`, `ref` for each visible element. Hidden elements (`display:none`, `visibility:hidden`, `aria-hidden`, zero-size) are excluded. Interactive elements get unique `ref` strings (`e0`, `e1`, …) and `data-ref` attributes for precise targeting. Supports `depth` (limit tree depth) and `boxes` (include bounding boxes) parameters.
- **Ref-based element targeting**: `browser_click`, `browser_type`, and `browser_select_option` accept an optional `ref` parameter (from `browser_snapshot`) for unambiguous element selection. Text-based fallback preserved with visibility filtering to avoid clicking hidden elements.
- **Per-project screenshots**: `browser_screenshot` saves to `<project>/screenshots/` via `PTNotesService.screenshotsDir()`. Accepts optional `project` parameter (defaults to current project).
- **Headless mode persistence**: `browser_set_mode` now saves the headless/headful preference to `ptnotes-settings.json`, surviving app restarts.
- **Headless guard**: the system prompt instructs the AI to call `ask_user` for confirmation before switching to headless mode (browser becomes invisible).
- **`ptfile://` custom protocol**: registers a `ptfile://` scheme in the main process to serve local image files for chat rendering. The protocol reads files from disk and returns them with proper MIME types. CSP updated (`img-src 'self' data: ptfile:`) to allow the protocol.
- **Chat image rendering**: markdown image tags with absolute paths (`![name](/full/path/image.png)`) are converted to `ptfile://local/full/path/image.png` and rendered inline in the chat.
- **Settings ▸ Toolsets** category: toggle browser toolset on/off. Warning that each enabled toolset adds tools to every chat turn (more tokens, higher chance of wrong tool selection). Toolsets are extensible for future external MCP connections.
- `PTNotesService.screenshotsDir(project)` method for per-project screenshot directories.
- **Chat image viewer**: click any image in the AI chat response to open a fullscreen lightbox (fade-in animation). The viewer shows the image centered and constrained to the viewport (90vw × 85vh) with the alt text as a caption. Close via backdrop click, Escape key, or the ✕ button (fade-out animation). Only active in assistant messages (note editor images unaffected).
- Dependencies: `@modelcontextprotocol/sdk@^1.30.0`, `playwright-core@^1.62`, `zod@^4.4`.

### Changed

- Tool count: 26 base + 12 browser = 38 total (guideline; browser tools are opt-in).
- `StorageSettings` now includes `disabledToolsets?: string[]` and `browserHeadless?: boolean` (persisted in `ptnotes-settings.json`).
- System prompt accepts an optional extra section (browser toolset instructions injected when enabled) and includes guidance for image file paths (`![name](full/path)`).
- `browser_navigate` and `browser_navigate_back` return structured JSON snapshot instead of plain text.
- App version (`APP_VERSION`) is now sourced from `package.json` via `app.getVersion()` instead of hardcoded strings.

## [0.12.0] — 2026-08-24

### Added

#### Excel support for chat file attachments & read_file

- **Excel attachments**: `.xlsx` / `.xlsm` workbooks are now accepted when dragging files into the chat (detected by content: ZIP magic + Excel extension), stored in `<project>/files/` like PDFs and text files, and reusable via `#` mentions.
- **Excel reading via exceljs**: the `read_file` tool parses Excel workbooks locally with the new `exceljs` dependency and converts them to structured data — JSON by default (`{ "<sheet name>": [row objects] }`, header row → keys) or CSV (`## Sheet: <name>` sections) via an optional `format` argument.
- **Multi-sheet workbooks** are fully read; cell values are normalized for the AI (formula results resolved, rich text flattened to plain text, dates as ISO strings). Output is truncated at the same `MAX_PDF_CHARS` limit as other readers.
- **Worksheet filter via `query` parameter**: `read_file` accepts an optional `query` string in URL-style var format (`var=value&var=value`, URL-encoded values are decoded). Supported variables: **`workspace`** — a worksheet name or 1-based worksheet number (e.g. `workspace=Sales` or `workspace=2`); unknown worksheets return an error listing the available sheets — and **`list=workspace`**, which returns a minified JSON list of all worksheets with their 1-based index (`[{"index":1,"name":"Sheet1"},…]`) instead of file content. Only supported for `.xlsx`/`.xlsm` files; unknown query variables, invalid `list` values, and combining `list` with `workspace` are rejected with clear messages.
- Legacy binary `.xls` files remain unsupported (exceljs reads only `.xlsx`/`.xlsm`); non-ZIP binaries keep the clear "binary file" error message.
- The system prompt and chat drop hints now mention Excel files; `files:extract` IPC inherits Excel support automatically.

#### Excel (.xlsx) module

- **New background module** `xlsx` ("Excel (XLSX)") that produces real styled Excel workbooks in `<project>/files/`. Registered after the Word module; the Settings ▸ Modules list shows it as **Excel (XLSX)**.
- **Workbook inspection tools**: `excel_list_sheets` (sheet index/name/dimensions), `excel_read_values` and `excel_read_styles` accept a file, an optional worksheet (name or 1-based number) and an optional range in A1 notation (`A1..G20` or `A1-G20`). Styles are returned per cell — font (name/size/bold/italic/underline/strike/color), fill (pattern + fg/bg color), borders (style + approximate width + color per side), alignment (vertical/horizontal/wrap), number format — plus column widths and row heights. Colors round-trip as hex (`#RRGGBB`/`AARRGGBB`), theme (`theme-0..11`) or indexed (`indexed-0..65`, including the `indexed-64` system-background marker Excel writes as bgColor), each optionally with an `@tint` suffix.
- **`create_xlsx_file`** builds a workbook from a design JSON: reusable named styles per sheet (`styleRef`), explicit cells (values; strings starting with `=` become formulas), bulk rows (`{ startCell, values }`), column widths, row heights, freeze panes, merged ranges and embedded chart/diagram PNG images (rendered via the shared chart/diagram/infographic tools). Output is deduplicated via `uniqueOutputPath`; failed builds clean up after themselves.
- **Template support**: pass an existing project `.xlsx` plus a mode — `clone-layout` keeps the template's layout/cells and applies the design on top; `style-source` starts fresh and copies the template's per-cell styles, column widths and row heights onto matching addresses (sheets match by name or via `templateSheet`). The module's system prompt instructs the subagent to inspect values _and_ styles over the header row plus 2-3 data rows below it, match columns to headers **by name** (never by position), and reproduce observed data-row styling including banded/alternating striping.
- **`edit_xlsx_file`** edits an existing workbook in-place (overwrites the file). Supports multiple operations per call: `set_cells` writes values row-wise starting at a cell address with optional per-cell styles (font, fill, border, alignment, number format); `insert_rows` / `delete_rows` and `insert_columns` / `delete_columns` shift cells at a 1-based index. Up to 100 operations per call.
- Module subagent tool tests cover builder round-trips (values/styles/theme+indexed colors/tint), both template modes, validation errors, direct tool execution against the service and a full scripted module run.

#### Modules — pass source references instead of pre-reading

- The main chat agent is now instructed to delegate sources as inline references in the module prompt — `note:<notename>`, `file:<filename>`, `plan:<schedule id or name>` (alias `schedule:`) — instead of reading notes/files/schedules itself first and pasting their content into the prompt.
- Every module subagent's system prompt gained a **SOURCE REFERENCES** section mapping each prefix to its own read tools (`read_note`, `read_file`, `list_schedules` + `read_schedule`), with guardrails: never ask for referenced content; if a source does not exist, say so instead of inventing it.

#### Built-in skills

- Three built-in skills ship with the app and are enabled by default:
  - **summarize** — condenses long documents, notes, or web pages into concise structured summaries.
  - **schedule-to-excel-export** — exports a project schedule into a professional styled Excel workbook (`create_xlsx_file`), with design specs for headers, status-colored cells, and % complete bars.
  - **schedule-to-excel-update** — updates an existing Excel workbook in-place from a project schedule (`edit_xlsx_file`), keeping the workbook's column structure while applying status background colors and % complete values.

## [0.11.0] — 2026-08-21

### Added

#### AI provider profiles

- **Profile set**: the AI configuration is now a set of **named profiles**, each its own `baseUrl` / `apiKey` / `model` combination, plus a persisted **active profile** that the chat actually uses. The Base URL field in the profile editor is an editable input with a **predefined endpoint dropdown** (OpenAI, OpenRouter, Ollama, Ollama Cloud, OpenCode Go, 9arm AI Passport — shared from `src/shared/aiEndpoints.ts`).
- **Profile management in Settings ▸ AI Settings**: an **Active profile** selector (switching it takes effect immediately) alongside **New profile** / **Edit profile** / **Delete profile** actions. Editing a profile happens in a modal and never changes which profile is active; deleting the active profile falls back to the first remaining one (delete is disabled when only one profile exists). The **PDF upload toggle is now global** — it applies across all profiles, not per-profile.
- **Legacy migration**: the old flat `ai-provider.json` config is automatically migrated on first load into a single **"Profile 1"**, which becomes the active profile; the legacy `uploadPdfEnabled` is hoisted into the global toggle and the file is rewritten once. Keys stay **plain text** with `chmod 600` (no encryption), exactly as before.
- **New store API + IPC**: `AIConfigStore` now exposes `getAll()` / `saveAll()` (full profile set + global toggle) alongside the unchanged `load()` (which still returns the active profile as a `AIProviderConfig`, so chat/module/title-generation consumers are untouched). Added `ai:getProfiles` / `ai:saveProfiles` IPC channels (preload `getProfiles` / `saveProfiles`); the renderer never touches the filesystem.
- **Chat drawer profile switcher**: the chat drawer's statusbar shows the active profile's **model name** on the left; hovering reveals an arrow button and clicking either the name or the arrow opens a **profile popup** (anchored above the statusbar) listing every profile with its name and model. Selecting a profile switches the active profile immediately via `saveProfiles`. The statusbar's In / Out / Cache token labels are now compact icons (`mdiTrayArrowDown` / `mdiTrayArrowUp` / `mdiTrayFull`).

#### Module panel — moved to the right-side drawer

- The **Modules** tab is removed from the left sidebar. The module panel now lives in the **right-side drawer**, toggled from a new **Module** button (🧩 `mdiPuzzleOutline`) in the top bar.
- The top-bar **Chat** and **Module** buttons now render as a **segmented view toggle** (like the Planner's Grid/Gantt toggle), showing one active view at a time. The right drawer shows **either Chat or Module at a time**: clicking a button opens its view (or closes the drawer if already open); clicking the other button switches views without closing. The Module button is disabled when no project is open.
- New keyboard shortcut **`⌘⇧M` / `Ctrl+Shift+M`** toggles the module panel (alongside the existing `⌘⇧C` / `Ctrl+Shift+C` chat shortcut).

#### Modules — can read skills (read-only)

- **Skills in modules**: module subagents can now load and apply skills. The runner injects the **enabled-skills index** into the module's system prompt (only when at least one skill is enabled, matching the chat's behaviour), so a module can discover which skills exist and call `read_skill` to load a skill's full content, plus `read_skill_file` to read sibling files inside a skill's folder.
- **Read-only**: modules get `read_skill` / `read_skill_file` from the base tool set, but the mutating skill tools **`create_skill` and `delete_skill` are excluded** — autonomous background modules can read skills but never create, edit, or delete them.

## [0.10.1] — 2026-08-21

### Added

#### Chat — on-demand reading of skill-linked files

- New **`read_skill_file`** tool: lets the assistant read a sibling file stored inside a skill's folder, referenced from its `SKILL.md` via a relative link (e.g. `[FORMAT.md](./FORMAT.md)` or `[DOC.md](./doc/DOC.md)`). After loading a skill with `read_skill`, the model calls `read_skill_file` (passing `scope`, `skill` and the relative `file` path) only when it actually needs that file — nothing is auto-loaded into context.
- Accepts PDF and text files (markdown, JSON, YAML, etc.) via the existing local reader; the path is **relative to the skill folder only** — absolute paths and `..` traversal are refused. Read/validation happens in the main process, so the renderer's no-filesystem invariant is preserved and `create_skill`/`saveSkill`/the Settings ▸ Skills editor are unchanged.

#### Chat — token usage tracking

- **Per-message usage in the AI trace**: provider token usage (input / output / cached) is now extracted from AI responses and recorded on each chat exchange. Handles both the chat.completions shape (`prompt_tokens` / `completion_tokens` / `prompt_tokens_details.cached_tokens`) and the Responses API shape (`input_tokens` / `output_tokens` / `input_tokens_details.cached_tokens`), via a new shared helper module `src/shared/usage.ts` (`normalizeUsage` / `addUsage` / `sumUsage` / `formatTokens`). Streaming requests now send `stream_options: { include_usage: true }`, and usage rides along on the `message-end` event (tool-call turns, final turns, and PDF-upload turns), plus on title-generation and PDF-upload trace entries.
- **Assistant detail**: the trace viewer's assistant panel now shows parsed **Input tokens** / **Output tokens** / **Cache read** rows instead of a raw JSON blob (raw JSON is kept as a fallback when the shape is unrecognized).
- **Session totals status bar**: a new status bar at the bottom of the chat drawer shows the running totals for the current chat — **In** / **Out** / **Cache** (compact `12.3k` formatting) — summed across the session's assistant messages. It only appears when at least one message carries usage, so it stays hidden for providers that don't report streaming usage (e.g. Ollama).

## [0.10.0] — 2026-08-20

### Added

#### Planner — Gantt chart view

- **View toggle**: a new bottom status bar in the planner editor with segmented **Grid View** / **Gantt Chart View** buttons. The active view is session-only (resets to Grid when switching schedules) and switching carries the scroll position between the grid and the Gantt body.
- **Gantt chart** (`GanttChart.tsx`): a day-grid timeline auto-fitted to the min plan start → max plan end across all tasks (+7-day padding, falling back to today), with a month band plus a floating "current month" label that follows horizontal scroll, and a day-axis header (weekday + day number). Non-working days (weekends + project holidays via `isWorkingDay`) are shaded gray and today is highlighted. Fixed left columns (collapse toggle + No. + Title) indent by task depth and share the table view's collapse state; No. numbering is derived the same way as in the grid.
- **Task bars**: leaf bars are draggable, parent bars are not (distinct color + `v───v` end arrows). Leaf bars expose left/right edge handles: dragging the **start** edge keeps `planEnd` fixed and recomputes `duration`, dragging the **end** edge keeps `planStart` fixed and recomputes `duration`, and dragging the **body** shifts both dates by the same day delta (duration preserved). All drags snap to whole days (pointer events, delta clamped so the bar stays in the timeline and start never passes end), preview live while dragging, and commit only on release with a non-zero delta.
- **Bar popup**: right-clicking any bar (parent or leaf) opens a popup with No., Title, Plan Start, Plan End, and Duration (working days); it closes on outside click / Escape / close button. Leaves with dates get a **Clear Plan** action (clears `planStart`/`planEnd`).
- **Day-cell click**: for leaves without dates, clicking a day cell sets `planStart` to that day and `planEnd` via `computeEndDate` (duration defaults to 1); settable cells show a hover hint, and date-less leaf titles are dimmed.
- All Gantt edits flow through the existing `editTask`/`commit` path, so parent rollup, undo/redo, and debounced autosave work unchanged.
- **Table view constraints**: No. and Title columns are always rendered and can no longer be hidden (checked + disabled in the column modal).
- **Gantt-only chrome**: a day-width zoom slider (16–32 px, step 4) in the status bar, and the toolbar's add/delete/copy/indent/move, columns, and calendar buttons are disabled in Gantt mode.

#### Planner — AI task placement by nested task number

- `add_task` and `update_task` now infer the parent from a **nested** `addAfter` task number (e.g. `addAfter: "2.1.1"` without `parent` places the task as a sibling of the matched task, under the same parent). An explicit `parent` still wins over `addAfter` (in `update_task`, an empty `parent` forces top level), and moving a task next to its own descendant is rejected (cycle-safe).

#### Planner — grid view context menu

- **Right-click context menu**: right-clicking a task row opens a cursor-positioned menu that acts on the current selection — right-clicking an unselected row selects it first and makes it the anchor. It offers **Insert Before / Insert After / Insert Sub Task**, **Copy / Cut / Paste Before / Paste After** (paste actions disabled while the clipboard is empty), and **Delete** (with the usual parent-confirmation). The menu mirrors the note-menu pattern and closes on outside click, `Escape`, or grid scroll.
- **Auto Plan Date**: chains the selected leaf tasks onto the plan timeline — the first selected task starts on the next working day after the immediately preceding non-descendant row's `planEnd` (when it has one), and each subsequent selected task chains from the previous one's new `planEnd`, preserving each task's duration. Parent/group rows are skipped, and the action is disabled when no such anchor exists.
- **Clear Plan Date**: clears `planStart`/`planEnd` on all selected tasks.
- **% Complete slider**: a slider in the menu sets `%Complete` on the selected leaf tasks (parent/group rows are skipped, matching the table's read-only rollup). Dragging commits live without flooding undo history — a single undo step is recorded when the drag ends (pointer up / blur / key up).
- **Multi-add**: the toolbar's **Add Task** and **Add Sub Task** actions now insert one new task per selected row (previously a single task), selecting and focusing the new rows; the two toolbar paste buttons were consolidated into a single **Paste** button (pastes before the selection).
- **Keyboard navigation**: `PageUp`/`PageDown` move the selection 10 rows at a time and `Home`/`End` jump to the first/last row; arrow-key, page, and home/end moves all scroll the active row into view. Right-clicking or shift-clicking while editing a cell now exits the cell so keyboard navigation never fights the input.
- **Shared helper**: the chain math uses a new exported `nextWorkingDayString` from the shared planner engine (`src/shared/planner.ts`), covered by new unit tests in `scripts/test-planner.mts`.

#### Planner — schedule list layout QoL

- The schedule list item meta now stacks the **updated date** on top with the **task count** below it in a smaller font, and the **More actions** button stays vertically centered to the right of both lines.

#### Note & schedule lists — right-click context menu

- Right-clicking a note or schedule item in its list opens the same context menu as the **More actions** ("⋯") button (Rename / Show in Folder / Delete).
- The menu is clamped to the window bounds, so it no longer gets trimmed when the item sits near the window border.

### Changed

#### Chat — static system prompt for provider prompt caching

- The active note and active schedule are no longer baked into the system prompt. The system prompt is now static per project/date/skills, so providers can reuse their prompt-prefix cache across turns.
- Instead, the currently active note/schedule is appended as a **context suffix** to the user message — but only when it **changed** since the last send (the first message always includes it). The chat bubble still shows just the raw user text; the suffix is hidden from the UI and visible only in the raw AI trace.

## [0.9.0] — 2026-08-19

### Added

#### Planner — project schedules with working-day math

- **Planner tab**: a fourth sidebar tab (`mdiChartTimeline`) with a schedule list (filter, create, rename, delete) and a grid editor keyed to the active schedule. Schedules are JSON files under `<project>/planner/<slug>.json`; a shared `calendar.json` holds the project's working-day config.
- **Hierarchical task grid**: columns **No. · Title · Status · Owner · Duration · Plan Start · Plan End · Actual Start · Actual End · %Complete · Note**, with per-row actions to add a subtask, add a sibling, or delete (deleting a parent asks for confirmation because it removes its children). Auto-saves ~800ms after edits (debounced, flushed on unmount).
- **Working-day engine** (`src/shared/planner.ts`, shared by main + renderer + tests): `planEnd = start + duration − 1` working days skipping weekends and project holidays; editing a plan start/end/duration recomputes the other field (end-date-fixed). Parent tasks roll up children — plan dates (min/max), duration, %complete (duration-weighted), and status. `On Hold` is manual-only; other statuses are derived from %complete. Actual dates are free-form and never computed.
- **Calendar modal**: edit the project week (start/end weekday) and holiday list (add/remove); saving re-rolls all schedules so parent durations reflect the new calendar.
- **AI planner tools** (20th–26th): `list_schedules`, `read_schedule`, `create_schedule`, `update_schedule` (rename), `add_task` (with optional parent nesting; planStart+duration or both dates — the missing value is computed), `update_task` (end-date-fixed date edits, status/percent handling; plan-field edits on parent tasks are rejected — they are derived from children; `parent`/`addAfter` move a task — and its subtree — to a new parent/position, cycle-safe), and `set_calendar` (week + holiday changes that re-roll schedules).
- **Tests**: `scripts/test-planner.mts` covers date math, holidays, status rules, rollups, service CRUD, calendar persistence, and all seven AI tools.

#### Planner — undo/redo

- **Undo/redo for the planner editor**: toolbar **Undo**/**Redo** buttons plus `⌘Z` / `⇧⌘Z` (on Windows/Linux `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`). History is kept in the app store as per-schedule stacks (capped at 100 entries), so switching schedules preserves each one's history; deleting a schedule prunes it. Text/number fields (title, owner, duration, %complete, note) capture the pre-edit state on focus and record a single undo step when the field loses focus — so typing a whole field undoes once, not per character — while discrete actions (add/delete/move/status/date/columns) record immediately. Undo/redo restore the snapshot, cancel any pending autosave, and re-save the restored state.
- **Focus-aware shortcuts**: keyboard undo/redo is intercepted in the **main process** (`before-input-event`, gated by a `planner:set-edit-active` flag driven by the editor's focus) because the app menu's `undo`/`redo` roles swallow `⌘Z` before the renderer can act. This keeps the markdown editor, chat input, and native text fields on their own undo behavior.

## [0.8.0] — 2026-08-17

### Added

#### Module result-return + main-chat multi-module waiting

- **`submit_result` module tool (18th)**: when a module run is started with a new `expect` argument on `start_module`, the subagent must call `submit_result` before finishing. The payload (JSON, markdown, or plain text — the main chat specifies the format) is stored on `ModuleRun.result`, broadcast as a new `'result'` module event, and propagated on the `done` event.
- **`wait_modules` chat tool (19th)**: the main assistant can start several modules in parallel, then call `wait_modules({ runIds })` to block (event-driven, default 600s timeout, cancelable via Stop) until every listed run is terminal, returning each run's `status` / `result` / `outputFiles` / `summary` / `error`. The chat continues its normal tool loop with the results in context.
- **Orchestration guidance in the system prompt**: the assistant is told to delegate parallel deliverables to `start_module` (passing `expect`), then `wait_modules` with all runIds — and to never wait when it does not need the output.
- **Waiting UX**: while the chat is inside `wait_modules`, the chat drawer shows "Waiting for N module run(s)…" instead of "AI is thinking…" (driven by a new `'waiting'` stream event with `runIds`).
- **General-purpose Subagent module**: a new **Subagent (long-run)** module runs open-ended, autonomous multi-step work (deep research, summarizing many notes/files, drafting content into notes) using only the shared base tools — no required output file and a larger turn budget (`maxIterations` is now per-module, default 30). The AI decides when to start it (or the user asks to "run the subagent"); like every module it supports `start_module`'s `expect` → `submit_result` result return.

#### Full raw AI trace log

- **Raw AI trace files**: every app↔AI-provider exchange is now persisted as a **readable onversation log** — chat sessions to `<project>/.data/chat/<sessionId>.trace.jsonl` and odule runs to `<project>/.data/modules/<runId>.trace.jsonl`. Each file is **JSONL** one record per line, appended — the file is never rewritten): the first record is a _header_* with the chat/module info (`{ type: 'header', project, key, kind, startedAt }`), hen one entry per logical message with a per-file monotonic `seq`, `role` `system` / `user` / `assistant` / `tool`), a timestamp, `durationMs` and `content`: the ystem prompt (written only once per file, on the first send), user prompts, assistant eplies (with the tool calls it issued and their payloads), and tool responses (each ool's result). Assistant entries also keep `reasoning`, finishReason`, `usage` and the model/base-URL/endpoint. Because the file is append-only, chat session accumulates the trace of **every** send in one file. Auxiliary AI calls — DF uploads via the Responses API and background chat title generation — are traced into he current chat's trace file too.
- **Never logged**: the API key (entries store `baseUrl`/`model`/params only) and the PDF ase64 payload (only `file_id`/filename). Tracing is best-effort and never fails a send.
- **Trace viewer**: a read-only modal shows the formatted JSON of any chat session or module run with **Reveal in Finder** and **Copy JSON** — opened from timeline-clock AI-trace buttons on each chat-history item, a chat-panel header button for the active session, and the module run's transcript overlay. If no trace exists, it shows "No trace data found for this session." instead of loading.
- **Follows lifecycle**: trace files are deleted with their chat/run, cleared on module retry, nd move automatically with the project on a root change.

## [0.7.1] — 2026-08-15

### Added

- **Build-in skills**: the app now ships read-only **Build-in** skills as markdown files under `resources/builtin-skills/<name>/SKILL.md` (same OpenAI front-matter layout), packaged with the app. Developers add/update them by editing the files; in **Settings ▸ Skills** users see them in a new **Build-in skills** section where they can only **enable/disable** each one (no edit, move, or delete — overrides are persisted in `ptnotes-settings.json`). Enabled Build-in skills are listed in the assistant's system-prompt skills index, readable via `read_skill` (scope `builtin`), and available as `/`-slash skill commands; a `builtin` scope cannot be created or deleted by the AI (`create_skill`/`delete_skill` stay `global`/`project`).
- **Editor link tooltip**: holding **Cmd/Ctrl** over a link in the WYSIWYG editor now shows a cursor-following tooltip with the contextual action — `Open note: <name>`, `Open skill: <name>`, `Open file location: <name>`, or `Open link: <url>` — previewing where the Cmd/Ctrl+click will take you. The tooltip follows the mouse while hovering and disappears on leaving the link, releasing the key, or leaving the editor.
- **Find & replace in the markdown editor**: **`Cmd/Ctrl+F`** (or the new magnify toolbar button next to Undo) opens a find bar with live match highlighting, a `current/total` counter, previous/next navigation (moves the caret and scrolls the editor to the match), a match-case toggle, and single **Replace** / **Replace all** actions. As you type, matches highlight immediately and the editor jumps to the first match. Highlights are ProseMirror decorations (non-destructive — markdown source, undo, and auto-save are untouched) and never cross paragraph boundaries. `Escape` closes the bar; the bar is hidden in raw-markdown mode. Freeing `Cmd/Ctrl+F` required replacing the default Electron menu with a custom one that drops the Edit→Find role.
- **Infographic icons**: infographic designs can now set `icon` on items using the local **`mdi/<name>`** format (e.g. `"icon": "mdi/cog"`, `"mdi/email"`, `"mdi/rocket"`) — the only supported icon source. Icons are resolved **offline** from the bundled `@mdi/js` catalog (7,447 Material Design Icons) via a registered `@antv/infographic` resource loader that embeds inline `<symbol>`s, so the renderer never queries the package's remote icon service; `illus` (remote illustration) fields remain stripped. Bare names like `icon: "rocket"` are canonicalized to `mdi/rocket`, and unsupported sources (URLs, data-URIs, raw SVG, `ref:`) are dropped. When an item omits an icon, a matching name is **auto-filled** from the item's label (keyword match + synonym map, default `mdi/star`) so icon slots render instead of staying blank.
- **Dependency list in About**: Settings ▸ About now shows every production dependency with its installed version in a read-only textbox (one package per line, e.g. `@antv/infographic@0.2.19`). Versions are resolved from `node_modules`, so they reflect what's actually installed.

### Fixed

- **Markdown editor link navigation**: fixed a bug where plain clicks on http/https links still triggered navigation in some environments; links now correctly place the text cursor on plain click and only navigate on **Cmd/Ctrl+click**.
- **External link errors**: added a protocol allowlist (`http`, `https`, `mailto`) and caught promise rejections in `shell.openExternal` to eliminate "No application found to open URL" console errors and improve security.
- **Editor link rendering**: links in the WYSIWYG editor are now rendered as `<span>` instead of `<a>` to completely disable default browser anchor behavior.

### Changed

- **No `ask_user` timeout**: the human-in-the-loop question dialog no longer auto-cancels after 120s — the assistant now waits indefinitely for your answers. The pending request stays open until you submit or cancel (or start a new chat).

All notable changes to PTNotes are documented in this file.

## [0.7.0] — 2026-08-14

### Added

#### Human-in-the-loop — `ask_user` tool

- New **`ask_user`** chat tool (17th) lets the assistant ask the user for input — a choice, a detail, or confirmation — before continuing. The model can pose **1–8 questions** in a single call (validated: non-empty id + question; `options` 2–6 when present, omitted/empty for free text, `multiple: true` for multi-select checkboxes).
- Questions are presented in a **wizard-style dialog** (`.ask-dialog`, ~660px): left nav with numbered question rows + a final Confirm row (active row highlighted, long text ellipsized, click to jump), right pane showing the full question with a focusable radio / checkbox / free-text input, and Previous / Next at bottom-right.
- **Require-all-answered** gating: Confirm (and Enter on the confirm pane) stays disabled until every question has an answer; the confirm pane shows a `Q1 → answer` summary and flags missing ones as "Not answered". Enter on the confirm pane with missing answers jumps to the first unanswered question.
- **Keyboard spec:** `↑`/`↓` move the cursor highlight; `←`/`→` navigate panes (like `Shift+Tab`/`Tab`, except on free-text questions where they move the input caret); radio `Enter`/`Tab`/`Space` commit + next; checkbox `Space`/`Enter` toggle + `Tab` next; free-text `Enter`/`Tab` next; `Shift+Tab` previous; `Escape` cancels.
- Answers flow back to the model as the tool result (`{ ok, cancelled, answers }`), so the conversation loop continues with the user's input. Unanswered dialogs time out after 120s (treated as cancelled).
- **Chat-only:** `ask_user` is filtered out of background module subagent tool lists and `ToolContext.ask` is absent in module runs — modules can never pop a dialog.
- The flow logic (`src/shared/ask.ts`: `initFlow`, `reduce`, `isAllAnswered`, `buildAnswers`) is pure and unit-tested (`scripts/test-ask.mts`), and `ask_user` tool validation/result paths are covered with a mocked `ctx.ask`.
- `ask_user` tool bubbles in chat show a compact **Q&A summary** (question → answer lines) instead of raw JSON when expanded, with a "Cancelled by user" line for cancelled runs.

#### Chat QoL

- **New Chat focuses the input**: clicking the **+ New Chat** button now moves focus to the chat input so you can start typing right away.

#### Chat keyboard shortcuts

- While the cursor is in the chat input box, **`Cmd/Ctrl+Shift+N`** starts a new chat and **`Cmd/Ctrl+Shift+H`** opens the chat history popup (toggling it closed if already open, refocusing the input). The `Shift`-modified combos avoid the app's default menu accelerators (`Cmd+N` New Window, `Cmd+H` Hide), so no menu changes were needed; opening via the shortcut blurs the input so the popup takes keyboard focus.
- The **chat history popup is keyboard-navigable**: `↑`/`↓` move the active selector (highlighted row, auto-scrolled into view when out of sight), mouse hover re-syncs the selector to the pointer, `Enter` opens the selected session, `Escape` closes. Works whether the popup was opened by mouse or by `Cmd/Ctrl+Shift+H`.
- While the chat input is focused, **`Ctrl+Home`** / **`Ctrl+End`** scroll the chat message list to the top / bottom and **`Ctrl+PageUp`** / **`Ctrl+PageDown`** scroll it by one page (uses `Ctrl` on all platforms, including macOS).
- **`Cmd/Ctrl+Shift+C`** toggles the chat panel from anywhere — identical to the top-bar Chat button (handled by a global window listener in `ChatDrawer`, which is always mounted). It is suppressed while any dialog/modal is open (a `.modal-overlay` or `.module-history-backdrop` in the DOM).

#### Tables in the markdown editor

- New **Insert Table** toolbar button (next to the link button) creates a 3×3 table with a header row (`insertTable`).
- While the cursor is inside a table, a contextual toolbar group appears: **insert/delete column** (before/after), **insert/delete row** (before/after), and **Delete Table**. Delete column/row disable at 1 column/row. (No merge/split — plain markdown tables can't represent merged cells.)
- **Right-click a table cell** for the same actions as a context menu at the cursor (caret moves to the clicked cell so commands target it). Closes on Escape, outside click, or another right-click.
- Table cells use the app's border/header style with a soft highlight for the selected cell.

#### Markdown editor QoL

- **Underline** is now available in the note editor: a new toolbar button (after Italic) toggles it, and it's included in the format helper and right-click menu too. Underline round-trips to markdown as GitLab-style `++text++` (StarterKit v3 already registers the extension — no new dependency).
- **Format helper bubble**: selecting text in the editor pops an icon-only bubble above the selection with **Bold / Italic / Underline / Strikethrough / Inline code** buttons (active states + tooltips). A circular **X** button in its top-right corner closes the bubble and turns the feature off.
- **Right-click format menu**: right-clicking in the editor always shows a context menu with the same five formatting actions (keeps the selection when the click is inside it, otherwise moves the cursor to the click point). Opening the menu hides the bubble popup; closing it does not bring the bubble back — it only returns on a fresh selection. The table right-click menu is unchanged.
- **Status-bar toggle**: the editor status bar now has an icon + label **Format helper** toggle on the right that turns the bubble popup on/off. The setting is remembered across restarts (default on, stored in `localStorage`).
- **Show Raw mode**: a second status-bar button (left of the Format helper, label "RAW") swaps the WYSIWYG editor for a plain monospace **markdown `<textarea>`** so you can edit the raw source directly. Edits auto-save (~800ms debounce, same as the WYSIWYG view) and toggling back re-syncs the rich editor. The toggle is **not persisted** — it resets to off every time you switch notes.
- **Cmd/Ctrl+click link navigation**: links in the WYSIWYG editor no longer navigate on plain click (which now correctly places the text cursor); instead, users must hold **Cmd/Ctrl** to navigate. External links open in the OS browser; internal `note:`, `skill:`, and `file:` links open the respective note, skill editor, or reveal the file in Finder (matching chat behavior). Hovering a link while holding the modifier key changes the cursor to a pointer.

### Fixed

- **Markdown tables now render in the note editor**: TipTap's `StarterKit` doesn't include table extensions in v3, so `@tiptap/markdown` silently dropped the whole `<table>` on parse. The `@tiptap/extension-table` `TableKit` (Table/TableRow/TableCell/TableHeader) is now registered, so tables in notes display as real tables and round-trip to valid markdown on save.

## [0.6.0] — 2026-08-13

### Added

#### About pane in Settings

- New **About** category in Settings showing the app icon, name, version, one-line description, a short tech-stack blurb, and labeled rows for the Electron / Chromium / Node.js runtime versions.
- Version data flows through IPC from the main process (`settings:getAbout` → `app.getName()` / `app.getVersion()` / `process.versions`), so the renderer never touches `process.versions` directly; the icon is bundled as a Vite asset (allowed by CSP `img-src 'self'`).
- Read-only pane (no Save/Cancel actions), matching the existing settings-pane layout.

#### Skills in AI chat

- New **Skills** feature: named instruction documents the AI can load on demand. **Global** skills live at `<root>/.skills/` and apply to all projects; **project** skills live at `<project>/.data/skills/` and apply to one project. Each skill is a folder with a `SKILL.md` manifest using the OpenAI skill-guide front-matter (`name:` + one-line `description:`).
- The system prompt now lists skill names + descriptions (global + project) and is rebuilt on every send, so skill changes apply mid-session; the assistant calls `read_skill` to load full content when relevant. Three new chat tools (`create_skill`, `read_skill`, `delete_skill`) bring the tool count to 16.
- New **Skills** category in Settings listing skills with a per-skill enable/disable toggle (32px) and a `⋮` context menu (**Edit skill**, **Move to Global/Project skills** — relocating the whole skill folder between scopes — and **Delete skill** with confirmation); create/edit happens in a modal (scope, name, description, markdown content); changes apply immediately.
- Skills can be **disabled** (an `enabled:` front-matter flag in `SKILL.md`, default `true`): disabled skills are excluded from the system-prompt index and refused by `read_skill`, with a new `skills:setEnabled` toggle IPC.
- `changeRootDir` now relocates the global `<root>/.skills` folder alongside the project registry.

#### Slash commands in chat

- Typing `/` at the start of the chat input opens a popup listing **built-in commands** (`/new` → start a new chat, `/models` → open AI Settings) and **enabled skills** (~10 rows). Typing filters by name + description; **Tab** autocompletes the command with a trailing space so more parameters can be typed; **Enter** (or a mouse click) autocompletes and runs the command immediately.
- Skill commands submit `Use the skill "name" (scope: …): <prompt>` so the assistant loads the skill via `read_skill` first (a system-prompt rule enforces this) and applies it to the given prompt.
- The command registry is extensible: built-ins live in `src/renderer/src/commands.ts` (client actions, no IPC), skills are merged in dynamically via `buildSkillCommandList` (built-ins win over same-named skills, project scope wins over global, disabled skills excluded), and the parsing/filtering/message-building logic is pure and unit-tested in `src/shared/slash.ts`.

#### Skill links in chat

- The system prompt now tells the assistant to link skills it mentions with the same convention as notes/todos: `[skill name](skill:skill name)`. The renderer renders these as clickable pills (book icon) that open **Settings → Skills** and load that skill directly into the editor for viewing or editing (via the `skillEditRequest` store field consumed by the Skills pane).

#### `read_note` supports the active note

- The `read_note` tool now accepts an **omitted `title`** to read the note the user is currently viewing. The chat session tracks the active note on every send and tells the model (via the system prompt) that "this note", "the current note" or "the active note" means it should call `read_note` without a title; the tool resolves the active note locally. Passing an explicit `title` still overrides it.

#### Chat QoL

- **Escape closes every popup**: all dialogs and context menus now close on `Escape` (Settings, New/Rename/Delete modals, confirm dialogs, the skill editor, `⋮` menus, the chat-history popup). Stacked modals close only the topmost one.
- **Focus follows chat**: clicking the **Chat** button focuses the chat input, and opening a chat thread from the history popup focuses the input as well.
- **Arrow-key history**: in the chat input, **↑** recalls your previously sent messages (from blank, it brings back the latest) and **↓** moves forward again; pressing **↓** on the latest message clears the input to blank.
- **Jump to bottom**: when you scroll up in the chat thread, a floating chevron button appears at the bottom; clicking it scrolls back to the latest messages.

### Changed

- **Chat/module data moved into `<project>/.data/`**: per-project `chat/` and `modules/` folders (including `modules/temp/`) now live under the dot-directory `<project>/.data/`, keeping app-internal data out of the project root and the `#` file picker. Legacy folders found at the project root are migrated automatically on startup (and after changing the storage root) — whole-folder move when the target is free, recursive merge otherwise, with colliding files kept as `-2` copies. The migration is idempotent.
- **Settings dialog height**: the dialog now spans a fixed `80vh` (min = max = 80% of the window height); when a pane's content is too long, the settings pane scrolls internally instead of growing the dialog.

## [0.5.2] — 2026-08-12

### Added

#### MDI Icon Overhaul

- Replaced editor toolbar and UI buttons with Material Design Icons (MDI):
  - Editor Toolbar: Headings, Bold, Italic, Strikethrough, Code, Lists, Quote, Link, HR, Undo, Redo.
  - Navigation: Refresh, Pencil, Trash, Folder, Chat, Cog, History.
  - Note/Todo links in chat now use content-aware MDI icons (Note, Todo, Docx, Pptx, Image, Code, Default).
- New **Chat Skeleton** overlay: prevents lag and content reflow during chat panel resizing by rendering a shimmery placeholder instead of the heavy drawer.

### Changed

#### UX Improvements

- **Resizing Performance**: Reworked sidebar and chat panel resizing to use imperative DOM updates with rAF-coalescing and disabled CSS transitions during drag, eliminating lag.
- **Todo Panel**: Moved "Hide completed" and "Delete all" to a new dots-vertical context menu; replaced checkboxes with a toggle-switch icon (size 28px).
- **Module Panel**: Moved "Delete all" finished runs to a new dots-vertical context menu; replaced checkboxes with a toggle-switch icon (size 32px).
- **Confirmations**: Note deletion and Todo "Delete completed" now use styled Modals instead of native `window.confirm`.
- **Note Links**: AI responses now link to slugified note IDs rather than display names, ensuring robust opening of notes with spaces.
- **Module Settings**: Replaced checkboxes with right-aligned MDI toggle switches (size 32px) with accent-color active states.

### Fixed

- **Module Output Pills**: Fixed layout wrapping between icon and filename; added truncation with ellipsis.

## [0.5.1] — 2026-08-12

### Fixed

- **Packaged infographic module crash (Windows/macOS/Linux)**: `@antv/layout` ships ESM files that import from their own nested `node_modules` (e.g. `@antv/layout/lib/node_modules/tslib/tslib.es6.js`), but electron-builder unconditionally drops any folder named `node_modules` inside a package, so those imports broke at runtime with `Cannot find module ... @antv\layout\lib\node_modules\tslib\tslib.es6.js` when creating an infographic from a packaged build. A `files` `from`/`to` entry in `electron-builder.yml` now force-copies the package's nested `node_modules` into the asar so the `@antv/infographic` SSR chain resolves correctly.

## [0.5.0] — 2026-08-11

### Added

#### Word documents (DOCX module)

- New **Word (DOCX) module** mirroring the PPTX module: the background subagent plans steps, reads any referenced `note:`/`file:` inputs, authors a JSON block design and calls `create_docx_file` to save a ready-to-open `<project>/files/<slug>.docx`.
- The design is a linear **block model** (`title-page`, `heading` level 1–6, `paragraph`, `bullets`, `numbered`, `table`, `quote`, `callout`, `chart`, `diagram`, `infographic`, `divider`, `page-break`) with optional portrait/landscape orientation, `normal`/`narrow`/`wide` margins, a theme palette (`primary`/`accent`/`fontFace`) and an optional footer with page numbers.
- Rendered in-process by the pure-JS `docx` OOXML builder (no native deps, so no utility-process worker is needed — consistent with `pptxgenjs`).
- Reuses the shared tool-packs: `render_chart`/`render_diagram`/`render_infographic` PNGs are embedded as full-width, aspect-preserving pictures with optional captions; Lucide icons rasterize onto the title page; temp render files (`<project>/modules/temp/*`) are cleaned up once the document is built (`collectChartPngPaths` + `cleanupModuleTempFiles`).
- Registered in the module registry so it appears in the Modules tab, `start_module` and Settings → Modules; the generic module card / history overlay / reveal pills require no renderer changes.
- New test suite `scripts/test-docx.mts` (wired into `npm test`): builder unit tests, embedded chart/diagram/infographic blocks + temp-file cleanup, full scripted subagent run, disabled-module gate, and premature-finish failure.

#### Module run chat history

- Every module run now records its subagent conversation (system prompt, user prompt, assistant turns, tool calls with results) as a read-only transcript.
- Transcripts persist to `<project>/modules/<runId>.chat.json` as the run progresses (auto-saved per turn) and are cleaned up when a run is deleted or retried; live runs stream from the in-memory session.
- New **💬 history button** on each module card opens a read-only overlay docked over the chat panel showing the transcript: collapsed-by-default `<think>` reasoning blocks, collapsible tool-call bubbles (with 📄 note pills for `create_note`/`update_note`), user-message collapse, and the system prompt in a collapsible box.
- The overlay also shows the run's live step tracker and status; it polls while the run is still active, and closes with Esc or the backdrop.
- New IPC channel `modules:readChat` (preload `window.ptnotes.modules.readChat`).
- Shared chat-bubble rendering extracted into `chatBubbles.tsx` / `chatContent.ts` / `moduleStatus.ts` (reused by both the chat drawer and the overlay).

#### Gantt diagrams

- The mermaid diagram tool-pack now accepts `gantt` diagrams alongside flowchart/sequence/state/class/ER/pie. Gantt includes need an SVG `viewBox` from `parentElement.offsetWidth`, which the svgdom DOM shim doesn't support, so a tiny `parentElement` polyfill (delegating to `parentNode`) plus a fixed `useWidth`/`useMaxWidth: false` config lets gantt render in-process; rasterization and the isolated utility-process path are unchanged.

#### Infographic rendering (@antv/infographic)

- New shared infographic tool-pack any module can reuse (`createInfographicTools.ts` + `infographic.ts` + `infographicRenderer.ts` + `infographic-render-worker.ts`): `list_infographic_templates` (the ~276 built-in catalog, filterable by category/query, with per-category data-shape hints), `infographic_preview` (dry-run validation, writes nothing) and `render_infographic` (design → rasterized PNG + SVG + sidecar JSON in `<project>/modules/temp/`).
- Designs are authored as **@antv/infographic DSL** (an `infographic <template>` first line followed by `data` / `design` / `theme` blocks) or as a JSON `{ "template", "data", ... }` object, and rendered by the package's node SSR entry (`@antv/infographic/ssr` → `renderToString` on a `linkedom` DOM shim), rasterized by `@resvg/resvg-js` — pure-local, in-process, no network, browsers or CLI tools. Layout families: lists, sequences/timelines/roadmaps, comparisons/SWOT, relations/networks, hierarchies/mindmaps, charts (pie), word clouds.
- The SSR entry installs browser-like globals (`window`/`document`/DOM classes/`requestAnimationFrame`) and never restores them, so the renderer snapshots and restores those globals around every render; model-supplied `icon`/`illus` fields are stripped (validation) so the offline renderer never hits the package's remote icon service.
- Rendering runs in an isolated Electron **utility process** (`infographicRenderer.ts` forks `infographic-render-worker.js`, with a plain-Node fallback for tests and `PTNOTES_INFOGRAPHIC_WORKER` overriding the worker path), so a heavy SSR/DOM render or native crash only fails the in-flight render tool instead of the app.
- Validation rejects unknown templates, malformed syntax and empty data blocks (the SSR entry otherwise hangs for its 10s internal timeout on a render that never completes).
- PPTX slides accept a new `infographic` layout that embeds the rendered PNG (same `x/y/w/h` placement and aspect-ratio scaling semantics as `chart`/`diagram`); temporary infographic files (`modules/temp/*.png` + `*.svg` + `*.json`) are deleted automatically once the deck is built (`collectChartPngPaths` now also collects `infographic` keys).
- New **standalone `infographic` module**: the subagent picks a template, authors the design and calls `create_infographic_file` to save the final deliverable as `<project>/files/<slug>.svg` (primary vector output) + a matching `.png`; registered in the module registry so it appears in the Modules tab, `start_module` and Settings → Modules.
- Module runs now record **multiple output files**: a run tracks every deliverable in `outputFiles` (output tools can return a `files` array alongside `path`/`file`), the module card shows one 📄 reveal pill per file, `modules:reveal` accepts an optional `filePath` to reveal a specific file, and `deleteRun`/`clearHistory` with the delete-output option removes all of them. The infographic module delivers both `.svg` + `.png` as separate pills.

## [0.4.0] — 2026-08-10

### Added

#### Diagram slides in PPTX presentations

- New shared diagram tool-pack (`createDiagramTools.ts` + `mermaid.ts` + `diagramRenderer.ts` + `diagram-render-worker.ts`) any module can reuse: `diagram_preview` (dry-run validation, writes nothing) and `render_diagram` (mermaid DSL source → rasterized PNG + SVG + sidecar JSON in `<project>/modules/temp/`).
- Diagrams are authored as **mermaid DSL text** (`flowchart TD/LR`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`, `erDiagram`, `pie`) and rendered by mermaid v11 on a jsdom/svgdom DOM shim (`isomorphic-mermaid`) — pure-local, in-process, no network, browsers (headless Chromium) or CLI tools. Mermaid owns all layout/edge-routing/shape math.
- Rendering runs in an isolated Electron **utility process** (`diagramRenderer.ts` forks `diagram-render-worker.js`, with a plain-Node fallback for tests and `PTNOTES_DIAGRAM_WORKER` overriding the worker path), so a native `@resvg/resvg-js` crash or a heavy mermaid+DOM render only fails the in-flight render tool instead of the app.
- The renderer isolates the DOM globals the shim installs (`window`/`document`) around each render, so nothing browser-like leaks back into the host (the OpenAI SDK refuses to run in a "browser-like" environment).
- PPTX slides accept a new `diagram` layout that embeds the rendered PNG (same `x/y/w/h` placement and aspect-ratio scaling semantics as `chart`); `diagram_preview` → `render_diagram` → `create_pptx_file` is the recommended flow.
- Temporary diagram files (`modules/temp/*.png` + `*.svg` + `*.json`) are deleted automatically once the deck is built (`cleanupModuleTempFiles` now also removes `.svg` siblings).
- Reusable diagram tool imports for module authors added to `docs/module-development.md`.

#### Lucide icons in PPTX slides

- New shared tool-pack (`src/main/modules/shared/lucideIcons.ts` + `createLucideIconTools.ts`) any module can reuse: `search_lucide_icons` (keyword → canonical icon names + tags) and `get_lucide_icon` (name → SVG string or PNG data URI).
- Catalog is built from Lucide's `tags.json` (all 1764 canonical names) with fuzzy keyword scoring over names and tags; SVG rendering is cached and PNG rasterization uses `@resvg/resvg-js`.
- PPTX slides now accept an optional `icon` field (Lucide canonical name or `{ name, size, color, x, y }`); icons are embedded as rasterized PNGs so they render reliably in any slide viewer, with a first-letter fallback when an icon can't be found.
- The PPTX module subagent is prompted to pick tasteful icons for title/section/statement slides and optional corner icons on content slides.
- Reusable shared tool imports for module authors documented in `docs/module-development.md` (no core/framework changes needed — the runner already merges `module.tools`).

#### Chart slides in PPTX presentations

- New shared chart tool-pack (`createChartTools.ts` + `chart.ts` + `chartRenderer.ts` + `chart-render-worker.ts`) any module can reuse: `chart_preview` (dry-run validation, writes nothing) and `render_chart` (Chart.js-style JSON → rasterized PNG + sidecar JSON in `<project>/modules/temp/`).
- Charts are drawn with **Chart.js** onto `@napi-rs/canvas` (prebuilt Node-API Skia binding, no rebuild) as pure-local, in-process rendering — no network, browsers, or CLI tools. Design validation caps the dataset/point counts and rejects oversized `options`.
- Native rendering runs in an isolated Electron **utility process** (`chartRenderer.ts` forks `chart-render-worker.js`, with a plain-Node fallback for tests), so a Skia/native crash only fails the in-flight render tool instead of the app; `PTNOTES_CHART_WORKER` overrides the worker path in tests.
- PPTX slides accept a new `chart` layout that embeds the rendered PNG; `chart_preview` → `render_chart` → `create_pptx_file` is the recommended flow, with optional slide `x/y/w/h` placement and automatic aspect-ratio scaling to fit the body area.
- Temporary chart files (`modules/temp/*.png` + `*.json`) are deleted automatically once the deck is built (`cleanupModuleTempFiles`), keeping them out of the `#` file picker.
- New `outputTool` field on `RegisteredModule`: if the subagent tries to finish without producing the deliverable file, the runner prompts it up to 2 times to call the output tool before failing the run instead of silently marking it done.
- Reusable chart tool imports for module authors added to `docs/module-development.md`.

#### Module run management

- Failed module runs show a **↻ Retry** button (hover over the card) that re-runs the subagent from the same stored prompt via a new `modules:retry` IPC, resetting the run in place so the existing card resumes live progress.
- The module progress bar turns **green** when a run completes successfully (`done`).

### Fixed

- Module runs (and chat tool-call turns) no longer fail on local OpenAI-compatible endpoints such as Ollama with `400 invalid message content type: <nil>`: assistant messages with no visible text now send `content: ""` instead of `null`, which OpenAI tolerates but Ollama (Go `nil`) rejects.
- The chat `#` file mention now refreshes the project file list from disk the moment the picker opens, so files deleted outside the app (or since load) no longer show as stale cached entries.

## [0.3.0] — 2026-08-08

### Added

#### Background modules (subagent framework)

- New **Modules** sidebar tab (Notes | Todo | Modules) tracking long-running AI generation jobs with live status (planning / running / done / failed).
- `start_module` chat tool: the main assistant can kick off a module in the background and keep responding; module progress streams into the chat as a live status card on the message.
- Framework modules run in the main process as independent subagents and get all base chat tools plus their own module tools, following a plan-first workflow (`set_plan` → `update_step`… → single output tool).
- Module registry (`ModuleRegistry`): new modules self-register and appear in `start_module` automatically, with no changes to core chat code.
- Run state and prompts persist under `<project>/modules/` so finished runs survive restarts; runs can be **stopped** and output files **revealed** from the Modules tab or the chat card.

#### PPTX module

- First module shipped: asks the subagent to design a deck, then `create_pptx_file` builds a real `.pptx` into the project `files/` folder via `pptxgenjs`.
- Supports one-slide-per-section decks with cover, agenda, section/statement, bullet, two-column and table slide types, shared theme (fonts + palette) and shape/overflow-safe text via the theme class.

#### Module settings & per-run management

- New **Modules** category in Settings lists the installed modules with enable/disable toggles that apply immediately; disabled modules are hidden from the `start_module` tool description and refused if started.
- The `start_module` tool schema is rebuilt on every chat turn from the current settings, so toggling a module updates the assistant's available-module list without a restart or session reset.
- Per-run delete in the Modules tab: history cards show a hover delete button; a confirm dialog supports deleting the related output file.
- Empty **Modules** tab links to **Settings → Modules** so users can find the enable/disable toggles.

### Changed

- Chat sessions now accept an extended tool list: the module `start_module` tool is merged on top of the 12 base tools (base tool behavior unchanged).
- The `start_module` tool is supplied by a `ToolsProvider` resolved on each model turn rather than a static list built at startup.
- Modules IPC now accepts the settings store and module registry (read live enabled state), and exports `deleteRun` (`modules:deleteRun`).

### Fixed

- `ModuleRunner` now uses the injected client factory (`createClientFn`) — previously the fallback OpenAI client was used instead, so module runs failed with a connection error when a test/host custom client was provided.

## [0.2.0] — 2026-08-07

### Added

#### Settings dialog & configurable project root

- General **Settings** dialog (two-panel: **Storage** + **AI Settings**); top-bar button renamed from _AI Settings_ to **Settings**.
- **Storage** category shows the current project root path with a **Change…** button (native folder picker).
- Changing the root moves **all** project data (folders, notes, todos, chats, `.ptnotes-projects.json`) after explicit confirmation; the new root is persisted in `userData/ptnotes-settings.json` (chmod 600).
- Persistent project registry keeps working after relocation (missing paths still flagged).

#### AI model list (editable combobox)

- **Model** field in AI Settings is an editable combobox: pick from a fetched list or type a custom model id.
- **Load models** button (and silent auto-load when the pane opens) calls `ai:listModels(baseUrl, apiKey)` against `GET {baseUrl}/models`, using the in-dialog (unsaved) values.
- Fetched models appear in a scrollable dropdown (~10 visible rows, filtered by typing); failures show a friendly error and never clear the typed value.
- Default model is now empty (placeholder only), so users must pick/type a model.
- **AI not configured** banner in the chat panel with a button that jumps to **Settings → AI Settings**.

#### Chat file & PDF attachments

- Drag & drop **multiple files** into the chat: supported files (any text file plus PDFs, detected by content) are copied silently to `<project>/files/`, referenced via `#` → `file:<filename>`. Unsupported-only drops show an alert.
- `read_file` tool extracts text locally — `pdf-parse` for `.pdf`, raw text for any text file — with `MAX_PDF_CHARS` truncation + `truncated` warning and a clear "No text found" message for scanned PDFs.
- Duplicate drops reuse existing `files/` copies by size + SHA-256 instead of creating `-2` copies.
- Dropped files surfaced in chat as attachment chips linked to the saved `files/` copy.

### Changed

- Replaced the single-panel AI Settings dialog with the two-panel **Settings** dialog.
- Replaced the dependency-free `<datalist>` combobox with a custom model dropdown (scrolling + outside-click close).

### Fixed

- Reopening a past chat session (or switching sessions / New Chat) no longer loses the conversation context: the AI now continues from the messages shown in the chat. Previously only the in-memory session was sent, so loading a historical session reset the model's context and replies didn't follow the selected history.
- Creating/renaming a note with a non-Latin title (e.g. Thai) no longer produces an "untitled" note: slugification now keeps Unicode letters and combining marks for all scripts, stripping only Latin combining accents.
- Chat now displays an error message when the AI server cannot be reached. Previously the first message in a session could fail silently: the `error` stream event could arrive after `chatStreamProject` had already been reset to `null`, so the renderer dropped it. The handler now falls back to the active project so the error is always applied to the last assistant message. See [#1](https://github.com/artharth77/ptnotes/issues/1).
- The "+ New Chat" button no longer wraps to a second line when the chat title is long: the header actions now stay fixed width while the title truncates with an ellipsis.

## [0.1.0] — 2026-08-05

Initial release.

### Added

#### Core notes & todos

- Electron app scaffolded with electron-vite, React 19, and TypeScript.
- Projects organized as folders on disk; creating a project initializes a `TODO.md` + `welcome.md`.
- TipTap WYSIWYG editor with markdown as the source of truth; auto-save ~800ms after edits (debounced).
- Notes: create, read, save, rename, delete, and refresh from the Notes tab.
- Todos: markdown checklist (`- [ ]` / `- [x]`) with toggle, progress counts, **Show All** toggle, **Delete completed** (with confirmation), and drag & drop reorder.
- Persistent project registry (`.ptnotes-projects.json`) so folders deleted externally still show, flagged with `pathExists`; missing projects can be **recreated**.
- Auto-select `welcome.md` after project create/recreate (only when the note was actually created).

#### AI chat assistant

- Right-side collapsible chat drawer with real-time streaming replies.
- Works with any OpenAI-compatible endpoint (base URL, API key, model configurable in-app; config stored in `userData/ai-provider.json`, chmod 600).
- 12 tools: create/update/read/delete/list/search notes, create/toggle/delete/list todos, DuckDuckGo web search (keyless), and local cheerio web fetch.
- Tool-call loop with collapsible tool results log; tool errors fed back to the model for self-correction.
- `@` note mention and `!` todo mention pickers insert `note:<name>` / `todo:<text>` markers.
- Clickable note links in AI responses (`[name](note:name)`) open the note and switch to the Notes tab.
- AI-triggered note/todo mutations refresh lists regardless of active tab.
- Markdown rendering in chat via `react-markdown` (GFM tables, single-line breaks, raw HTML escaped for XSS safety).
- `<think>` reasoning blocks (from `reasoning_content`, e.g. DeepSeek-R1) shown in a separate collapsed-by-default bubble.
- **Stop button** interrupts an in-flight AI run (AbortController).
- `delete_note` tool requires in-app user confirmation before deleting.

#### Chat history & titles

- One JSON file per session under `<project>/chat/`, auto-saved per message.
- **New Chat** archives the current thread; a history picker lists sessions (title, message count, date) with rename and delete.
- Hybrid titles: local heuristic from the first message immediately, refined by a background AI completion (`ai:generateTitle`).
- Chat sessions persist in memory per project; closing/reopening the drawer keeps the conversation.

#### Packaging

- electron-builder config for macOS (DMG + zip) and Windows/Linux targets.
