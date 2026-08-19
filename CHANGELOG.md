## [0.9.0] — 2026-08-18

### Added

#### Planner — undo/redo

- **Undo/redo for the planner editor**: toolbar **Undo**/**Redo** buttons plus `⌘Z` / `⇧⌘Z` (on Windows/Linux `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`). History is kept in the app store as per-schedule stacks (capped at 100 entries), so switching schedules preserves each one's history; deleting a schedule prunes it. Text/number fields (title, owner, duration, %complete, note) capture the pre-edit state on focus and record a single undo step when the field loses focus — so typing a whole field undoes once, not per character — while discrete actions (add/delete/move/status/date/columns) record immediately. Undo/redo restore the snapshot, cancel any pending autosave, and re-save the restored state.
- **Focus-aware shortcuts**: keyboard undo/redo is intercepted in the **main process** (`before-input-event`, gated by a `planner:set-edit-active` flag driven by the editor's focus) because the app menu's `undo`/`redo` roles swallow `⌘Z` before the renderer can act. This keeps the markdown editor, chat input, and native text fields on their own undo behavior.

#### Planner — project schedules with working-day math

- **Planner tab**: a fourth sidebar tab (`mdiChartTimeline`) with a schedule list (filter, create, rename, delete) and a grid editor keyed to the active schedule. Schedules are JSON files under `<project>/planner/<slug>.json`; a shared `calendar.json` holds the project's working-day config.
- **Hierarchical task grid**: columns **No. · Title · Status · Owner · Duration · Plan Start · Plan End · Actual Start · Actual End · %Complete · Note**, with per-row actions to add a subtask, add a sibling, or delete (deleting a parent asks for confirmation because it removes its children). Auto-saves ~800ms after edits (debounced, flushed on unmount).
- **Working-day engine** (`src/shared/planner.ts`, shared by main + renderer + tests): `planEnd = start + duration − 1` working days skipping weekends and project holidays; editing a plan start/end/duration recomputes the other field (end-date-fixed). Parent tasks roll up children — plan dates (min/max), duration, %complete (duration-weighted), and status. `On Hold` is manual-only; other statuses are derived from %complete. Actual dates are free-form and never computed.
- **Calendar modal**: edit the project week (start/end weekday) and holiday list (add/remove); saving re-rolls all schedules so parent durations reflect the new calendar.
- **AI planner tools** (20th–26th): `list_schedules`, `read_schedule`, `create_schedule`, `update_schedule` (rename), `add_task` (with optional parent nesting; planStart+duration or both dates — the missing value is computed), `update_task` (end-date-fixed date edits, status/percent handling; plan-field edits on parent tasks are rejected — they are derived from children; `parent`/`addAfter` move a task — and its subtree — to a new parent/position, cycle-safe), and `set_calendar` (week + holiday changes that re-roll schedules).
- **Tests**: `scripts/test-planner.mts` covers date math, holidays, status rules, rollups, service CRUD, calendar persistence, and all seven AI tools.

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
