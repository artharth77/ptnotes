# PTNotes Architecture Reference

Companion to `AGENTS.md`. This document holds the full technical design. `AGENTS.md` keeps
the always-needed rules (project, stack, commands, security invariants, conventions) and
points here for details. Read this file **on demand** when a task touches architecture,
on-disk layout, IPC, AI/chat features, module rendering, or the UI.

## Table of contents

Read the section(s) relevant to your task rather than the whole file when possible:

| Section                                                                 | Read when touching                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Decisions (locked in)](#decisions-locked-in)                           | Any feature work — product decisions that must not be reverted           |
| [On-disk layout](#on-disk-layout)                                       | Filesystem paths, `.data/`, project root, storage/config files           |
| [Architecture](#architecture)                                           | Finding where code lives (main/preload/renderer/shared)                  |
| [Security invariants (do not break)](#security-invariants-do-not-break) | **Always read** — hard constraints (renderer isolation, render workers)  |
| [UI layout](#ui-layout)                                                 | Editor, toolbar, format helper, find & replace, top bar                  |
| [IPC surface (window.ptnotes)](#ipc-surface-windowptnotes)              | Preload/renderer ↔ main IPC handler shapes                               |
| [AI chat feature](#ai-chat-feature)                                     | Chat session, tools, module orchestration, trace, PDF, chat UI, settings |
| [Notes & caveats](#notes--caveats)                                      | Behavioral constraints (tool scoping, mention semantics)                 |

---

## Project

PTNotes is a desktop app (Electron) for markdown notes, todo task lists, and an AI chat assistant, organized by **project** — each project is a folder on disk.

## Stack

- Electron 39 + electron-vite 5 + Vite 7
- React 19 + TypeScript
- TipTap v3 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown` for markdown in/out)
- zustand (app state)
- `openai` npm SDK with `baseURL` override (works with OpenAI, OpenRouter, Groq, LM Studio, Ollama, etc.)
- `@modelcontextprotocol/sdk` (v1.30) in-process MCP server + client over `InMemoryTransport` for browser toolset
- `playwright-core` (drives installed Chrome/Edge; no bundled Chromium)
- `zod` (v4, peer dep of MCP SDK; input-schema validation for registered tools)
- cheerio (local HTML → text parsing for `web_fetch`)
- `isomorphic-mermaid` (mermaid v11 + jsdom/svgdom/dompurify DOM shim) for in-process module diagram rendering (flowchart/sequence/state/ER/pie/gantt DSL → SVG)
- `@antv/infographic` (SSR entry via `linkedom`) for in-process module infographic rendering (DSL/JSON design → SVG, ~276 built-in templates)
- `docx` (pure-JS OOXML builder) for in-process module Word-document rendering (JSON block design → .docx)
- Plain CSS (no UI framework), `react-markdown` + `remark-gfm` + `remark-breaks` for chat rendering
- electron-builder for packaging (optional)

## Commands

```bash
npm run dev          # development with HMR
npm run test         # service / AI tools / chat session / markdown tests (tsx scripts/)
npm run typecheck    # tsc --noEmit (node + web)
npm run lint         # eslint --cache .
npm run format       # prettier --write .
npm run build        # typecheck + electron-vite build
npm run build:win    # electron-vite build + electron-builder --win
npm run build:mac    # electron-vite build + electron-builder --mac (DMG + zip)
npm run build:linux  # electron-vite build + electron-builder --linux
```

Run `npm run typecheck` and `npm run lint` after any change.

## Decisions (locked in)

| Area              | Decision                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface         | Desktop GUI (Electron)                                                                                                                                                                                                              |
| Editor            | WYSIWYG rich text (TipTap) with markdown as source of truth                                                                                                                                                                         |
| Todo storage      | Markdown checklist file (`TODO.md`)                                                                                                                                                                                                 |
| Stack             | Electron + electron-vite + React 19 + TypeScript                                                                                                                                                                                    |
| Project selector  | Top bar: current project name dropdown + New Project button                                                                                                                                                                         |
| Project registry  | Persistent known-project list so folders deleted externally still show (missing paths marked red)                                                                                                                                   |
| Chat placement    | Collapsible right-side drawer, shared with the **Module** panel (top-bar toggles, one view at a time)                                                                                                                               |
| AI streaming      | Yes (real-time)                                                                                                                                                                                                                     |
| Settings dialog   | Two-panel dialog: **Storage** (project root path) + **AI Settings** (profile set: active selector, per-profile base URL/API key/model with endpoint presets, global PDF toggle) + Modules + Skills + About                          |
| Project root      | Configurable via settings; default `~/Documents/PTNotes`; changing it moves all data + registry to the new location after confirmation                                                                                              |
| Chat history      | Persisted per session as JSON files under `<project>/.data/chat/`; auto-saved per message; New Chat archives current thread; history picker can view/reopen old sessions                                                            |
| Chat titles       | Hybrid: local heuristic from first message immediately, refined by a background AI completion; manual rename supported; history popup shows title + message count                                                                   |
| Chat note mention | `@` opens note list → inserts `note:<notename>` → AI calls `read_note`                                                                                                                                                              |
| Chat todo mention | `!` opens todo list → inserts `todo:<todotext>` (filterable by text)                                                                                                                                                                |
| Chat file mention | `#` opens project file list (`files:list` → `<project>/files/*` for PDF + Excel + text) → inserts `file:<filename>` → AI calls `read_file` (content-based: pdf-parse for PDFs, exceljs for .xlsx/.xlsm, raw text for any text file) |

| Chat file drop | Multi-file drag & drop into the chat: every supported file is copied silently to `<project>/files/` (no popup) and referenced via `#` mentions; support is **content-based** (any text file plus PDFs, detected by content not extension) — non-PDF binary files are rejected; if none are added, an alert is shown |
| Chat response rendering | Markdown via `react-markdown` + `remark-gfm` + `remark-breaks` (raw HTML escaped → XSS-safe) |
| Web search | DuckDuckGo only (free, no API key) |
| Page reading | Local cheerio parsing (private, no third-party service) |

## On-disk layout

```
~/Documents/PTNotes/
├── .skills/             (global skills: `<skill>/SKILL.md` with OpenAI skill-guide front-matter (`name:` + `description:`), shared by all projects)
└── <ProjectName>/
    ├── notes/*.md          (one file per note)
    ├── TODO.md             (markdown checklist: `- [ ]` / `- [x]`)
    ├── files/*.{pdf,md,txt,json,log,yaml,yml} (attachments copied on chat drop) + module deliverables (.pptx, .svg/.png, .docx)
    ├── planner/            (project schedules + calendar)
    │   ├── <slug>.json     (one file per schedule: id, name, timestamps, nested task tree)
    │   └── calendar.json   (shared working-day calendar: weekStart/weekEnd + holidays)
    └── .data/              (app-internal data; dot-prefixed so it stays out of the # file picker)
        ├── modules/*.json        (module run state + prompts)
        ├── modules/*.chat.json   (per-run subagent transcript, read-only history overlay)
        ├── modules/*.trace.jsonl (per-run raw AI trace, JSONL: header record first, then one record per line; append-only)
        ├── modules/temp/*.{png,svg,json}  (temp module/shared-tool output; deleted once the deck is built)
        ├── skills/*/SKILL.md (project skills — same OpenAI skill-guide layout (`<skill>/SKILL.md` with `name:` + `description:` front-matter) as global skills, scoped to one project)
        ├── chat/*.json         (one file per chat session: messages + timestamps)
        └── chat/*.trace.jsonl  (one raw AI trace per chat session, JSONL: header record first, then one record per line; append-only)
```

- On startup (and after `changeRootDir`), legacy per-project `chat/` and `modules/`
  folders found at the project root are migrated into `<project>/.data/` automatically
  (whole-folder `rename` when the target is free, recursive merge — keeping both files
  on collision with a `-2` suffix — otherwise). The migration is idempotent.

- App AI config stored in Electron `userData/ai-provider.json`, `chmod 600`, never in the renderer bundle. Shape: `{ version, profiles: [{id,name,baseUrl,apiKey,model}], activeProfileId, uploadPdfEnabled }` — a set of named profiles plus the active one and a global PDF toggle. Legacy flat configs migrate into a single "Profile 1".
- App settings (project root path + `disabledModules` module toggles) stored in Electron `userData/ptnotes-settings.json`, `chmod 600`.
- Creating a project initializes folder + `TODO.md` + `welcome.md`.
- `.ptnotes-projects.json` in the root dir is the persistent project registry so externally-deleted folders still show (missing paths flagged `pathExists: false`).

## Architecture

```
src/
├── main/                # Electron main process — ALL filesystem + network access
│   ├── index.ts         # window creation, app lifecycle
│   ├── settings.ts      # SettingsStore (userData/ptnotes-settings.json → project root)
│   ├── service/
│   │   └── PTNotesService.ts   # all fs operations (projects/notes/todos/chats/skills) + changeRootDir
│   ├── ipc/             # ipcMain.handle registrations
│   │   ├── projects.ts
│   │   ├── notes.ts
│   │   ├── todos.ts
│   │   ├── planner.ts  # planner:list/read/save/create/rename/delete/getCalendar/saveCalendar/set-edit-active/undo-redo
│   │   ├── chat.ts      # chat history persistence (list/read/write/delete/rename)
│   │   ├── ai.ts        # chat session registry + ai:generateTitle (chat titles)
│   │   ├── files.ts     # files:* attach/extract/list/reveal + pdf:upload (multi-file drop: .pdf/.xlsx/.xlsm/.md/.txt)
│   │   ├── skills.ts    # skills:list/read/save/delete (global + project)
│   │   └── settings.ts  # settings:get / settings:chooseRoot / settings:changeRoot
│   └── ai/
│       ├── client.ts    # OpenAI-compatible client (streaming)
│       ├── tools.ts     # tool JSON schemas + executors (bind to PTNotesService)
│       ├── chatSession.ts   # conversation state + tool-call loop (static system prompt + skills index; active note/schedule sent as user-message context suffix)
│       ├── config.ts    # ai-provider.json load/save (profile set + legacy migration)
│       ├── reader.ts     # readFileAsText + detectFileKind: content-based (pdf-parse for PDFs, exceljs for .xlsx/.xlsm, raw text for any text file) + MAX_PDF_CHARS truncation
│       └── search/
│           ├── duckduckgo.ts  # web_search (no key)
│           └── webFetch.ts    # cheerio page extraction
│   └── modules/
│       ├── registry.ts   # module registry (extensible)
│       ├── runs.ts       # ModuleRunManager: start/list/stop + event broadcast + readChat/readTrace (live in-memory or persisted .chat.json/.trace.jsonl) + waitForRuns (multi-module waiting for the main chat)
│       ├── runner.ts     # subagent loop; persists a read-only transcript + raw AI trace to <project>/.data/modules/<runId>.chat.json and .trace.jsonl each turn (removed on run delete/retry); submit_result tool for expectResult runs; injects the enabled-skills index into the module system prompt and offers read_skill/read_skill_file (create_skill/delete_skill excluded)
│       ├── tool.ts       # start_module tool (with expect result spec) + wait_modules tool (main chat → module run)
│       ├── subagent/     # general-purpose long-run agent (base tools only, no output file; maxIterations 60)
│       ├── pptx/         # PowerPoint module (design schema → buildPptx)
│       ├── infographic/  # standalone infographic module (design schema → create_infographic_file; reuses the shared tool-pack)
│       ├── docx/         # Word document module (design schema → buildDocx; reuses the shared tool-pack)
│       ├── xlsx/         # Excel module (create_xlsx_file, edit_xlsx_file, read_values, read_styles, list_sheets)
│       └── shared/
│           ├── chart.ts          # Chart.js design validation + in-process renderChartPng (@napi-rs/canvas)
│           ├── chart-render-worker.ts  # utility-process entry (forks under Electron)
│           ├── chartRenderer.ts  # isolates rendering in an Electron utilityProcess (native crashes contained; plain-Node fallback)
│           ├── createChartTools.ts  # chart_preview + render_chart tools
│           ├── mermaid.ts        # mermaid DSL validation + renderMermaidSvg + svgToPng via @resvg (DOM shim; no headless browser)
│           ├── diagram-render-worker.ts # utility-process entry (forks under Electron)
│           ├── diagramRenderer.ts # isolates mermaid+DOM rendering in an Electron utilityProcess (failures contained; plain-Node fallback)
│           ├── createDiagramTools.ts # diagram_preview + render_diagram tools
│           ├── infographic.ts    # @antv/infographic DSL/JSON validation + renderInfographicSvg + svgToPng via @resvg (linkedom SSR; no network)
│           ├── infographic-render-worker.ts # utility-process entry (forks under Electron)
│           ├── infographicRenderer.ts # isolates infographic SSR+DOM rendering in an Electron utilityProcess (failures contained; plain-Node fallback)
│           └── createInfographicTools.ts # list_infographic_templates + infographic_preview + render_infographic tools
├── preload/             # contextBridge: window.ptnotes typed API + index.d.ts
├── renderer/            # React app
│   ├── src/
│   │   ├── App.tsx
│   │   ├── store/useAppStore.ts    # zustand store (active project/note/tab, chat)
│   │   ├── components/
│   │   │   ├── TopBar.tsx           # project dropdown + New Project + Settings + chat toggle
│   │   │   ├── ProjectDropdown.tsx
│   │   │   ├── NoteList.tsx         # Notes tab
│   │   │   ├── TodoPanel.tsx        # Todo tab (checkboxes + progress)
│   │   │   ├── PlannerPanel.tsx     # Planner tab (schedule list + create/rename/delete)
│   │   │   ├── PlannerEditor.tsx    # schedule grid editor (hierarchical tasks, rollups, autosave, undo/redo history) + view toggle
│   │   │   ├── GanttChart.tsx       # planner Gantt view (day-grid timeline, draggable bars, bar popup)
│   │   │   ├── CalendarModal.tsx    # project working-day calendar editor (week + holidays)
│   │   │   ├── MarkdownEditor.tsx   # TipTap WYSIWYG + markdown sync + auto-save
│   │   │   ├── MarkdownContent.tsx  # react-markdown chat rendering + note:/skill: link handling
│   │   │   ├── ChatDrawer.tsx       # right drawer, streaming, mentions, history, titles
│   │   │   ├── ModuleHistoryOverlay.tsx # read-only transcript overlay for module runs (💬 button on ModuleCard)
│   │   │   └── SettingsDialog.tsx  # two-panel Settings (Storage + AI Settings)
│   └── ...
└── shared/
    ├── types.ts         # Project, NoteMeta, Todo, ChatMessage, tool types
    └── planner.ts       # pure planner engine (dates, status rules, rollups) shared by main + renderer + tests
```

### Security invariants (do not break)

- The renderer must **never** access the network or filesystem; all I/O goes through IPC to the main process.
- The AI API key lives only in `userData/ai-provider.json` (chmod 600), read by the main process — never bundle it in the renderer. Keys are plain text across all profiles (no encryption).
- Chat HTML is rendered via `react-markdown` with raw HTML escaped (XSS-safe); `<think>` blocks and user/error messages stay plain text.
- Chart rasterization (Chart.js onto `@napi-rs/canvas`/skia) must stay isolated in the Electron **utility process** (`chart-render-worker.js`, spawned by `chartRenderer.ts`): a native segfault there must only fail the in-flight render tool, never crash the app. Module chart tools must call `renderChartIsolated`, never `renderChartPng` on the main process. The worker is a second `main` entry in `electron.vite.config.ts`; `PTNOTES_CHART_WORKER` env overrides its path for tests.
- Diagram rendering (mermaid DSL → SVG via the jsdom/svgdom shim, rasterized by `@resvg/resvg-js`) must stay isolated in the Electron **utility process** (`diagram-render-worker.js`, spawned by `diagramRenderer.ts`): heavy DOM parsing and any native crash there must only fail the in-flight render tool, never crash the app. Module diagram tools must call `renderDiagramIsolated`, never render mermaid on the main process. The worker is a `main` entry in `electron.vite.config.ts`; `PTNOTES_DIAGRAM_WORKER` env overrides its path for tests. Mermaid is ESM-only, so it is always loaded via dynamic `import()`.
- Infographic rendering (`@antv/infographic` SSR entry onto a `linkedom` DOM shim, rasterized by `@resvg/resvg-js`) must stay isolated in the Electron **utility process** (`infographic-render-worker.js`, spawned by `infographicRenderer.ts`): the SSR renderer installs browser-like globals (`window`/`document`/DOM classes) that it never restores, so the shared renderer snapshots/restores those globals around every render, and a heavy SSR/DOM render or native crash must only fail the in-flight render tool, never crash the app. Module infographic tools must call `renderInfographicIsolated`, never render on the main process. The worker is a `main` entry in `electron.vite.config.ts`; `PTNOTES_INFOGRAPHIC_WORKER` env overrides its path for tests. The SSR renderer only completes when the design has a `data` block. Icons are the one resource the package would otherwise fetch remotely, so only local **`mdi/<name>`** icons render (resolved from the bundled `@mdi/js` catalog by a registered `registerResourceLoader` in `loadInfographic` that always returns an inline `<symbol>` and never null); `illus` fields are always stripped, non-`mdi/` icon sources are dropped, and items that omit an icon get a matching name auto-filled from the item label — so the worker never queries the package's remote icon service.

### Conventions

- Follow existing patterns in neighboring files (store actions, IPC handler shapes, component style).
- Project names and note/chat ids are slugified and validated before building file paths (see `validateNoteId` / `chatDir` in `PTNotesService`).
- Todo storage is a markdown checklist file (`TODO.md`, `- [ ]` / `- [x]`); the line content derives the id.
- Use existing utilities; do not add new dependencies without checking `package.json`.
- Do not add comments unless necessary.

## UI layout

```
┌──────────────────────────────────────────────────────────────┐
│ ⚙ Project A ▾ [New Project]   [Settings] [🧩 Module] [💬 Chat]│
├─────────────────┬────────────────────────────────────────────┤
│ Notes│Todo│      │  Editor area        │  Module / Chat drawer│
│ Planner          │  ┌ toolbar ───────┐ │  (collapsible,       │
│ ▸ note 1        │  │ TipTap editor  │ │  one view at a time) │
│ ▸ note 2        │  └────────────────┘ │                      │
│ [+ New note]    │                     │                      │
└─────────────────┴────────────────────┴──────────────────────┘
```

- **Top bar:** current project name with dropdown (switch / new / rename / delete), Settings, and a **Chat / Module** segmented view toggle (`mdiChatProcessingOutline` / `mdiPuzzleOutline`). Both views share the collapsible right-side drawer, showing **Chat or Module one at a time**; the Module button is disabled when no project is open. Shortcuts: `⌘⇧C`/`Ctrl+Shift+C` toggles chat, `⌘⇧M`/`Ctrl+Shift+M` toggles modules.
- **Middle column:** tabs for Notes (list + create/rename/delete), Todo (interactive checklist + progress), and Planner (project schedules — see [Planner](#planner)).
  - **Main area:** TipTap WYSIWYG editor for notes; auto-save to `.md` ~800ms after edits (debounced). The toolbar includes an **underline** button (StarterKit v3 registers `Underline`; markdown round-trips as GitLab-style `++text++`). Links in the editor use a custom `<span>` implementation to disable default browser navigation; they require Cmd/Ctrl+click to navigate: external links open in the OS browser, while `note:`, `skill:`, and `file:` links open the note, skill editor, or reveal the file in Finder, respectively.

- **Format helper (bubble popup):** selecting text shows an icon-only bubble (`BubbleMenu` from `@tiptap/react/menus` — no new dependency) with **Bold / Italic / Underline / Strikethrough / Inline code** buttons (active states + tooltips); a circular `mdiCloseCircle` X button in its top-right corner closes it and turns the feature off. Enabled by default, persisted in `localStorage` (`ptnotes:formatHelper`), and toggled from a status-bar button on the right (icon + label).
- **Right-click format menu:** right-clicking in the editor (outside a table) always shows a `note-menu` with the same five actions — keeps the selection when the click is inside it, otherwise moves the cursor to the click point. Opening the menu hides the bubble popup (`setMeta('hide')`); closing it never re-shows the bubble (it only returns on a fresh selection). The table right-click menu is unchanged.
- **Show Raw toggle:** a second status-bar button (left of the Format helper button, label "RAW") swaps the toolbar + TipTap view for a plain markdown `<textarea>` (`editor-raw`: monospace, `spellCheck={false}`, `autoFocus`). Edits auto-save debounced ~800ms (reuses the editor's `saveTimer`); leaving raw mode re-syncs the TipTap doc via `setContent(rawText, { contentType: 'markdown', emitUpdate: false })`. The toggle is **component-local only** — never persisted and resets to off on every note change (the editor remounts via `key={activeNoteId}`).
- **Find & replace:** `Cmd/Ctrl+F` or the magnify toolbar button (left of Undo) opens a find bar: search input with a `current/total` counter, previous/next, match-case toggle, replace input, and **Replace** / **Replace all**. Highlights are pure **ProseMirror decorations** (never mutate the doc, so markdown round-trip/undo/auto-save are untouched). The engine is a custom `FindReplace` extension (`src/renderer/src/editor/findReplace.ts`) with the match algorithm kept as a pure, unit-tested function in `src/shared/find.ts` (`findMatchesInTextRuns`: regex-escaped literal query, `matchCase` flag, whitespace-only matches skipped). Text runs are grouped per block (`buildTextRuns`), so matches span inline marks (bold/link) but never cross paragraph boundaries. Typing/step/replace-current all select the match and scroll the editor to it via `view.coordsAtPos` + manual `.editor-content` scrolling (`scrollMatchIntoView` — ProseMirror's own `scrollToSelection` silently no-ops when DOM focus is in the find input, not the editor). `Escape` closes and refocuses the editor; the bar is hidden in raw mode.

## IPC surface (window.ptnotes)

- **Projects:** `list` (returns `pathExists` per project), `create`, `rename`, `delete`, `recreate` (rebuild folder for a project whose path is missing)
- **Notes:** `list`, `read`, `save`, `create`, `rename`, `delete`
- **Todos:** `read` (parse checklist), `save` (serialize `- [ ]`/`- [x]`), `toggle`, `deleteCompleted`, `reorder`
- **Planner:** `list` (schedule metas), `read` (full schedule or `null`), `save` (atomic tmp+rename), `create` (slugified id), `rename`, `delete`; `getCalendar` (defaults to Mon–Fri), `saveCalendar` (normalized). All ids validated with `validateScheduleId` (same rule as the note-id guard). Plus `setEditActive` (renderer→main `send`: gates the main-process `before-input-event` shortcut interception) and `onUndoRedo` (main→renderer: forwards `⌘Z`/`⇧⌘Z`/`Ctrl+Y` to the planner editor — see [Editor (PlannerEditor)](#editor-plannereditor)).
- **Chat history:** `list`, `read`, `write`, `delete`, `rename`, `readTrace` (raw AI trace `AiTraceFile` for a session, or `null`)
- **AI:** `send` (message → streamed reply; takes `sessionId` so the run is traced), `getConfig`, `setConfig`, `listModels(baseUrl, apiKey)`, `generateTitle` (takes `sessionId`; the title call is traced into the session's trace file), `stop`, `clear`, `confirmResponse`, `askResponse` (human-in-the-loop answers for `ask_user`), `onStreamEvent` (token chunks + tool-call logs + confirm events)
- **Settings:** `get` (returns `{ rootDir }`), `getAbout` (app name/version + Electron/Chromium/Node versions for the About pane), `chooseRoot` (native folder picker), `changeRoot` (moves data + persists + returns new `{ rootDir }`)
- **Skills:** `list(project)` (returns `{ global, project }` metas), `read(project, scope, name)` (full content), `save(project, scope, name, { description, content, enabled? })` (upsert → `SkillMeta`), `setEnabled(project, scope, name, enabled)` (toggle → `SkillMeta`), `move(project, scope, name, toScope)` (relocates the skill folder between scopes → `SkillMeta`), `delete(project, scope, name)` (→ boolean)
- **PDF:** `supportsUpload` (returns the AI settings `uploadPdfEnabled` toggle — user-controlled), `upload` (raw PDF via provider Responses API `input_file` — uploads base64 through the Files API, falling back to inline `file_data`; takes `sessionId` so the upload exchange is traced into the session's trace file)
- **Files:** `list` (`<project>/files/*` — PDF + any text file — for the chat `#` picker), `getPathForFile` (dropped file path via `webUtils`, never `File.path`), `copyToProject` (content-based: any text file + PDFs copied into `<project>/files/`; non-PDF binaries rejected), `extract` (local text → `{ text, pageCount, charCount, truncated }`; pdf-parse for `.pdf`, raw text for any text file), `reveal` (`shell.showItemInFolder`)
- **Modules:** `list`, `listAvailable`, `setEnabled`, `start`, `startModule`, `stop`, `retry`, `reveal` (optional `filePath` to reveal a specific file of a multi-file run; defaults to the primary `outputFile`), `deleteRun`, `clearHistory`, `readChat` (per-run subagent transcript: live in-memory for active runs, persisted `<project>/.data/modules/<runId>.chat.json` otherwise), `readTrace` (per-run raw AI trace `AiTraceFile`: live from the runner for active runs, else disk). A run records **every** deliverable in `outputFiles` (one 📄 reveal pill each on the card; the first is also `outputFile`); `deleteRun`/`clearHistory` with the delete-output option removes them all. A run may also carry a `result` payload (submitted via `submit_result`) and an `expectResult` spec (from `start_module`'s `expect` argument).

## AI chat feature

### Flow

```
ChatPanel (renderer) ──send──▶ Main process
   ▲                              │  chatSession
   │◀──── stream events ──────────┼─▶ OpenAI-compatible chat.completions (stream: true)
   │◀──── tool results ───────────┼─▶ tool executors → PTNotesService / search
```

- Renderer never calls the network; API key stays in main process.
- Tool-call loop: model requests tools → executor runs them → results fed back as `tool` messages → loop until final text reply.
- Chat operates on the **currently active project** by default.
- Tool errors are returned to the model so it can self-correct.
- Session is kept in memory per project (`sessions` map) so closing the drawer and reopening continues the same conversation.
- Each `ai:send` call receives the renderer's current thread as `history`; the session is re-seeded from it only when it has no in-memory messages yet (fresh session — e.g. after `ai:clear` on New Chat / opening a historical chat), so reopening a historical chat (or switching sessions) keeps the correct model context. Within a live conversation the in-memory messages are kept, so context annotations (below) persist across turns.
- The system prompt is kept **static** per project/date/skills (rebuilt each send only to refresh the skills index) — the active note/schedule are intentionally _not_ part of it, so providers can reuse their prompt-prefix cache across turns.
- Each `ai:send` also forwards the currently **active note** and **active schedule** (`activeNoteId` / `activeScheduleId` from the renderer store). Instead of the system prompt, the changed active context is appended as a **context suffix** to the user message — e.g. `[Context] Active note: "…".` / `[Context] Active schedule: "…".` — and only when it **changed** since the last send (the first message of a conversation always includes it). This keeps "this note", "the current note" or "the active note" working: the model learns the active note from the suffix and calls `read_note` **without a `title`**, which resolves to the note the user is viewing. The suffix is hidden from the chat bubble (the renderer displays its own raw user text) and visible only in the raw AI trace.
- The system prompt also lists available **enabled** skills (name + description per skill, global + project)
  and is **rebuilt on every `send()`** (`ensureSystemPrompt` → `renderSkillsIndex`), so skills
  created/edited/toggled in Settings apply mid-session. The model calls `read_skill` to load full content
  when a skill is relevant; disabled skills are excluded from the index and refused by `read_skill`.
- **Module subagents** get the same skills index injected into their (static) system prompt — but only
  when at least one skill is enabled. Modules are offered `read_skill` / `read_skill_file` from the base
  tool set, while `create_skill` / `delete_skill` are **excluded** so background modules can read skills
  but never mutate them.
- A `!` todo mention inserts `todo:<todotext>` which is sent to the model as-is.
- A `#` file mention inserts `file:<filename>`; the system prompt instructs the AI that a
  `file:<filename>` message means it must call `read_file` (content-based local extraction;
  `.pdf` via pdf-parse, any text file as raw text) before responding — so previously dropped
  files can be reused without re-dragging.
- The system prompt includes an orchestration guideline: delegate parallel deliverables to
  background modules via `start_module` (passing `expect` to specify the result payload), then
  call `wait_modules` with all runIds and continue with the returned results; never wait when the
  module output is not needed. When delegating, the main agent passes source material as inline
  references in the prompt — `note:<notename>`, `file:<filename>`, `plan:<schedule id or name>`
  — instead of reading them itself first; every module subagent's system prompt explains how to
  resolve these references (`read_note` / `read_file` / `list_schedules` + `read_schedule`).

### Module result + multi-module waiting

- A module run with an `expectResult` (set via the `expect` argument of `start_module`) requires
  the subagent to call `submit_result` before finishing; the payload is stored on
  `ModuleRun.result` and surfaced to the main chat via the `wait_modules` tool result.
- `ModuleRunManager.waitForRuns(project, runIds, timeoutMs?, isStopped?)` blocks (event-driven,
  default 600s timeout, ~500ms `isStopped` poll) until every listed run is terminal and returns
  `status` / `result` / `outputFiles` / `summary` / `error` per run in input order.
- The `'result'` module event broadcasts the submitted payload (also propagated on the `done`
  event); runs keep running independently if the chat is stopped — only the wait returns early.
- While the chat is inside `wait_modules`, a `'waiting'` stream event (with `runIds`) is emitted
  and the drawer shows "Waiting for N module run(s)…".

### Raw AI trace

- Every app↔provider exchange is persisted as a readable **JSONL** trace file (one record
  per line, appended — the file is never rewritten): chat
  `<project>/.data/chat/<sessionId>.trace.jsonl` and module
  `<project>/.data/modules/<runId>.trace.jsonl`. The first record is a **header**
  (`{ type: 'header', project, key, kind, startedAt }`); every following line is one
  `AiTraceEntry` — one per logical message, with `seq`, `role`
  (`system` / `user` / `assistant` / `tool`), `ts`, `durationMs`, and `content`:
  - `system` — the system prompt sent, written only once per trace file (the first send;
    later sends skip it, detected via `chatTraceMeta`).
  - `user` — a user prompt, including any auto-appended active note/schedule context suffix (PDF uploads also carry a `file: { filename, file_id }` reference).
  - `assistant` — an AI reply: `content` / `reasoning`, the `toolCalls` it issued (payload
    `{ id, name, args }`), `finishReason`, `usage`, plus `model` / `baseUrl` / `endpoint`.
  - `tool` — a tool response: `name`, `toolCallId`, `content` (the result), and `durationMs`.
    Auxiliary AI calls (PDF upload via the Responses API, background chat title generation)
    are traced into the current chat's trace file too.
- **Never logged:** the API key and the PDF base64 payload (only `file_id`/filename). Tracing
  is best-effort and non-fatal.
- Trace files live inside `<project>/.data/`, so they follow the delete (`deleteChat`,
  `deleteModuleRun`, `clearModuleHistoryRuns`), retry (trace cleared for a new run) and
  migration paths of their chat/module files. Legacy single-JSON `.trace.json` files are
  migrated to JSONL lazily on first read.
- Recording happens entirely in the main process (`AiTraceRecorder` in `src/main/ai/trace.ts`):
  `chatSession.ts` (`send`/`uploadPdf`/`runTurn`), `modules/runner.ts` (one entry per
  assistant reply / tool response, flushed alongside `persistChat()`; the runner's
  `toTranscript` stamps per-message timestamps). The recorder appends its records as JSONL
  lines (header record first when the file is new); `seq` stays monotonic per file via
  `initialSeq` (the existing entry count at recorder creation). The renderer only reads
  traces back over IPC (parsed back into an `AiTraceFile`).
- **Viewer:** a read-only modal (raw formatted JSON) with **Reveal in Finder** and
  **Copy JSON** — an AI-trace icon button (timeline-clock) on each chat-history item, a
  chat-panel header trace button for the active session (`chat.readTrace`), and an AI-trace
  icon button on the module run's transcript overlay (`modules.readTrace`). If no trace
  exists, the modal shows "No trace data found for this session." instead of loading.

### Tools (26 + 12 browser = 38 total)

| Tool              | Action                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_note`     | new `.md` in project `notes/`                                                                                                                                                                                                                                                                                                                                                 |
| `update_note`     | overwrite / rename existing note                                                                                                                                                                                                                                                                                                                                              |
| `list_notes`      | model context                                                                                                                                                                                                                                                                                                                                                                 |
| `read_note`       | model context; omit `title` to read the currently active note (the one the user is viewing)                                                                                                                                                                                                                                                                                   |
| `search_notes`    | search note titles + content, return matching names + snippet                                                                                                                                                                                                                                                                                                                 |
| `delete_note`     | delete one or more notes (requires user confirmation dialog)                                                                                                                                                                                                                                                                                                                  |
| `create_todos`    | append `- [ ]` items to `TODO.md`                                                                                                                                                                                                                                                                                                                                             |
| `toggle_todo`     | toggle a checklist item                                                                                                                                                                                                                                                                                                                                                       |
| `delete_todo`     | remove an item                                                                                                                                                                                                                                                                                                                                                                |
| `list_todos`      | model context                                                                                                                                                                                                                                                                                                                                                                 |
| `read_file`       | extract text of a project file locally via `readFileAsText` (pdf-parse for `.pdf`, exceljs for `.xlsx`/`.xlsm` with optional `query` — `workspace=<name\|n>` sheet filter or `list=workspace` index/name list, raw text for any text file)                                                                                                                                    |
| `create_skill`    | upsert a skill (`scope`: `global`/`project`) from name + description + content                                                                                                                                                                                                                                                                                                |
| `read_skill`      | load a skill's full content (skills are listed in the system prompt; no separate `list_skills`)                                                                                                                                                                                                                                                                               |
| `delete_skill`    | delete a skill (requires user confirmation dialog)                                                                                                                                                                                                                                                                                                                            |
| `web_search`      | DuckDuckGo HTML search, no API key, Node fetch in main (user-agent header, rate-limit errors surfaced to model)                                                                                                                                                                                                                                                               |
| `web_fetch`       | direct fetch + cheerio local parse (strip scripts/styles/nav, extract title + readable text) — fully private                                                                                                                                                                                                                                                                  |
| `ask_user`        | ask the user 1–8 choice/free-text questions in a wizard dialog (radio / checkboxes / free text); chat-only                                                                                                                                                                                                                                                                    |
| `start_module`    | chat-only; start a background module (with optional `expect` result spec); returns `runId` immediately                                                                                                                                                                                                                                                                        |
| `wait_modules`    | chat-only; block (event-driven, timeout + stop-cancel) until every listed run is terminal, return their `status`/`result`/`outputFiles`/`summary`/`error`                                                                                                                                                                                                                     |
| `submit_result`   | module-only; a module subagent submits its result payload (JSON/markdown/plain text) before finishing                                                                                                                                                                                                                                                                         |
| `list_schedules`  | model context (id, name, task count)                                                                                                                                                                                                                                                                                                                                          |
| `read_schedule`   | full task tree with rolled-up parent values; match schedule by id or name                                                                                                                                                                                                                                                                                                     |
| `create_schedule` | new empty schedule; returns id + name                                                                                                                                                                                                                                                                                                                                         |
| `update_schedule` | rename a schedule (match by id or name)                                                                                                                                                                                                                                                                                                                                       |
| `add_task`        | add a task (optional parent nesting); planStart+planEnd or planStart+duration — the missing value is computed; `addAfter` without `parent` infers the parent (sibling of the matched task)                                                                                                                                                                                    |
| `update_task`     | update a task's fields (match by id, task number or title); plan date edits re-derive the other value (end-date-fixed); plan-field edits on parents are rejected (derived from children); `parent`/`addAfter` moves the task (and its subtree) — `addAfter` without `parent` infers the parent (sibling of the matched task), explicit empty `parent` → top level, cycle-safe |
| `set_calendar`    | set week + holidays; re-rolls all schedules so parent durations reflect the new calendar                                                                                                                                                                                                                                                                                      |
| `browser_navigate`| navigate browser to URL; returns page title + content summary; chat-only, requires enabled Browser toolset                                                                                                                                                                                                                                                                     |
| `browser_navigate_back` | navigate browser back one page; chat-only                                                                                                                                                                                                                                                                                                                              |
| `browser_snapshot`| extract page text + all interactive elements (links, buttons, inputs, selects); primary way to see the page                                                                                                                                                                                                                                                                   |
| `browser_click`   | click an element by visible text or button label; chat-only                                                                                                                                                                                                                                                                                                                   |
| `browser_type`    | type text into a form input; optional `pressEnter`; chat-only                                                                                                                                                                                                                                                                                                                 |
| `browser_select_option` | select an option in a `<select>` dropdown; chat-only                                                                                                                                                                                                                                                                                                                  |
| `browser_press_key` | press a keyboard key (Enter, Escape, Tab, etc.); chat-only                                                                                                                                                                                                                                                                                                              |
| `browser_screenshot` | take a PNG screenshot; returns file path; chat-only                                                                                                                                                                                                                                                                                                                    |
| `browser_evaluate`| execute JavaScript on the page; chat-only                                                                                                                                                                                                                                                                                                                                     |
| `browser_wait_for`| wait for a CSS selector, text, or timeout; chat-only                                                                                                                                                                                                                                                                                                                         |
| `browser_set_mode`| switch headful/headless (relaunches browser); headless requires `ask_user` confirmation; chat-only                                                                                                                                                                                                                                                                           |
| `browser_close`   | close the browser and release resources; chat-only                                                                                                                                                                                                                                                                                                                           |

### PDF attachments (drag & drop into chat)

- Dropping one or more files onto the chat drawer copies each **supported** file (any text file —
  `.md`, `.txt`, `.json`, `.log`, `.yaml`, `.yml`, … — plus PDFs) silently into
  `<project>/files/<slug><ext>` (`copyFileToProject`) with no dialog, refreshes the file list, and
  inserts a `file:<filename>` mention per file into the chat input. Support is decided by **content**
  (`detectFileKind`) not extension: text files of any extension are accepted, binaries are accepted
  only if they are PDFs, and other binaries are rejected. Unsupported files in the drop are skipped;
  if **none** of the dropped files are supported, an alert is shown and nothing is copied. Chat
  messages containing `file:<filename>` are handled by the `read_file` tool (local `pdf-parse` for
  `.pdf`, raw text for any text file).
- If a file with the same name already exists in `files/` with the same size **and** SHA-256 hash,
  the existing file is reused instead of saving a new `-2` copy.
- Long files are truncated to `MAX_PDF_CHARS` with a `truncated` warning; scanned/image PDFs surface a
  clear "No text found" error.
- Renderer obtains each dropped file's path via preload `files.getPathForFile(file)` using Electron's
  `webUtils.getPathForFile` (never `File.path`).
- Drop turns share the same per-project `ChatSession`; `createSessionRegistry` in `ipc/ai.ts` owns the
  session map + confirm/stop wiring used by `ai:send`.

### Chat UI

- User chat bubbles longer than `USER_MSG_COLLAPSE_LIMIT` (400 chars) show only the head with a
  "… Show more" button; clicking toggles the full message ("Show less").
- In an assistant message, tool-call bubbles are rendered **above** the response content.
- `create_note` / `update_note` tool bubbles show a clickable `📄 <note>` pill in the header (CSS
  truncated, max-width 180px) that opens the note, whether the bubble is collapsed or expanded.
  Parsed from the tool result JSON (`{ ok, note }`) via `noteIdFromToolCall`.
- `ask_user` tool bubbles show a compact **Q&A summary** (question → answer lines) instead of raw
  JSON in the expanded result, mapping tool args (`questions`) to the tool result (`answers` by id);
  cancelled runs show a "Cancelled by user" line.
- Note slugs are Unicode-safe: non-Latin scripts (e.g. Thai) keep their characters, including combining
  marks (`\p{M}`); only Latin combining accents (`\u0300-\u036f`) are stripped (see `slugify`).
- **Keyboard shortcuts:** with the cursor in the chat input box, `Cmd/Ctrl+Shift+N` starts a new chat
  and `Cmd/Ctrl+Shift+H` toggles the chat history popup (Shift-modified to avoid the default menu's
  `Cmd+N` New Window / `Cmd+H` Hide accelerators — no main-process menu changes for chat; note that
  the app _does_ install a custom application menu, `buildAppMenu()` in `src/main/index.ts`, whose
  sole purpose is removing the default Edit→Find role so the renderer owns `Cmd/Ctrl+F` for the
  markdown editor's find/replace bar); opening via the
  shortcut blurs the input, closing refocuses it. Globally, `Cmd/Ctrl+Shift+C` toggles the chat
  panel and `Cmd/Ctrl+Shift+M` toggles the module panel (mirroring the top-bar Chat / Module
  buttons; handled by a window listener in `App.tsx`, which is always mounted so both work
  regardless of which drawer view is open); they are suppressed while any dialog/modal is open (a
  `.modal-overlay` or `.module-history-backdrop` present in the DOM), and `Cmd/Ctrl+Shift+M` is a
  no-op when no project is open. The history popup is
  keyboard-navigable: `↑`/`↓` move the active selector (highlighted via `.chat-history-item.active`,
  auto-scrolled into view), mouse move re-syncs the selector to the pointer,
  `Enter` opens the selected session, `Escape` closes and refocuses the input (nav keys skipped
  while renaming). While the chat
  input is focused, `Ctrl+Home`/`Ctrl+End` scroll the chat list to top/bottom and
  `Ctrl+PageUp`/`Ctrl+PageDown` page it (Ctrl on all platforms). Platform is detected via
  `window.electron.process.platform === 'darwin'`.
- **Slash commands:** typing `/` at the start of the chat input opens a popup of built-in commands
  (`/new` → new chat, `/models` → open AI Settings) and **enabled skills** (≤10 rows). Typing filters
  (name + description); **Tab** autocompletes the command + a trailing space to type args; **Enter**
  (or a mouse click) autocompletes and runs it immediately. Skill commands send
  `Use the skill "name" (scope: …): <prompt>` so the model calls `read_skill` first (enforced by a
  system-prompt rule). Registry lives in `src/shared/slash.ts` (pure logic + tests) and
  `src/renderer/src/commands.ts` (built-ins with actions); skills are merged in via
  `buildSkillCommandList` (built-ins win over same-named skills, project scope wins over global).

### Settings dialog

Two-panel dialog (`.settings-layout` with `.settings-nav` + `.settings-pane`):

- **Storage:** shows the current project root path (read-only) + **Change…** button that opens a native
  folder picker. Selecting a new root prompts for explicit confirmation ("Move all project data…")
  before `PTNotesService.changeRootDir` moves every project dir + `.ptnotes-projects.json`, and the
  settings store persists the new root.
- **AI Settings:** a set of **profiles** (each a named base URL / API key / model combination). The
  UI lets you pick the **active** profile (used by chat), create new profiles (auto id `profile-N`,
  editable name, not active), edit any profile, and delete non-active ones. The **Base URL** field
  is an editable input plus a preset dropdown of predefined endpoints (`AI_ENDPOINTS`). The **Model**
  field is an editable custom combobox: free-text `<input>` with a `Load models` button that calls
  `ai:listModels(baseUrl, apiKey)` (uses the edited profile's unsaved values) against
  `GET {baseUrl}/models`, then shows a scrollable dropdown (~10 rows) of fetched model ids filtered
  by typing; the typed value is never cleared on failure. The **PDF upload** toggle is global
  (applies to `AIConfig.uploadPdfEnabled`), rendered once outside the per-profile fields. Saving
  persists the whole `AIConfig` via `ai:saveProfiles`; the active profile is read back via
  `ai:getProfiles`. Editing a profile never changes which one is active. The AI Settings category is
  driven by store state (`settingsCategory`, opened via `openSettings('ai')`).
- **Modules:** a toggle per registered module. Disabled modules are excluded from the `start_module`
  tool description and refused by `ModuleRunManager.start`; the list comes from
  `modules:listAvailable` / `modules:setEnabled`, persisted as `disabledModules` in
  `ptnotes-settings.json`. Toggles apply immediately, no Save button.
- **Skills:** lists global + project skills (name, description, enabled state) with a per-skill
  enable/disable toggle and a `⋮` context menu (Edit skill, Move to Global/Project skills,
  Delete-with-confirm). Build-in skills (app-shipped, read-only) are also listed in a separate
  section with a toggle only. Create/edit happens in a modal (scope, name, description, content).
  Changes apply immediately — the chat system prompt re-renders its skills index on the next
  send. Disabled skills are excluded from the index and refused by `read_skill` (`enabled:`
  front-matter in `SKILL.md` or user override in `ptnotes-settings.json`, default enabled).
- Model downloads auto-load silently when the AI pane opens (best-effort; failures hidden until
  **Load models** is clicked).
- When the AI isn't configured (empty model, or no API key for a remote provider), the chat panel
  shows an **"AI not configured"** banner at the top with a button that opens **Settings → AI
  Settings** (`ai:getConfig` → `aiReady` check in `ChatDrawer`).

## Planner

Project schedules with hierarchical tasks, working-day date math, and parent rollups. Stored as
JSON in `<project>/planner/<slug>.json`; the whole feature is pure data — no markdown, no new deps.

### Data model

- `ScheduleTask`: `id`, `title`, `status` (`not-started` | `in-progress` | `completed` | `on-hold`),
  `owner`, `duration` (working days, `number|null`), `planStart`/`planEnd`/`actualStart`/`actualEnd`
  (`'YYYY-MM-DD'` or `null`), `percentComplete` (0–100), `note`, `children: ScheduleTask[]`.
- `ProjectCalendar`: `weekStart`/`weekEnd` (weekday 0=Sun..6=Sat, default Mon–Fri = 1..5) +
  `holidays: string[]` — the **shared project working-day config** used for all plan math.
- Dates are stored as local `YYYY-MM-DD` strings (no timezone); the outline **No.** column is
  derived at render time (`deriveTaskNo`), never persisted.

### Rules

- **Working-day math** (`computeEndDate`/`computeDuration`): `planEnd = start + duration - 1` working
  days (start counts as day 1); weekends and `calendar.holidays` are skipped. Applies to **plan**
  dates only — actual dates are free-form and never computed.
- **Date rule** (`applyDateRule`): editing `planStart` or `duration` keeps `duration` fixed and
  recomputes `planEnd` (`start + duration - 1` working days) — but when no `duration` is assigned
  and a `planEnd` is set, a `planStart` edit keeps `planEnd` fixed and recomputes `duration`.
  Editing `planEnd` recomputes `duration`.
- **Status rules** (`deriveStatus`): `On Hold` is manual only — never auto-changed. Otherwise
  `%Complete ≤ 0` → Not Started, `< 100` → In Progress, `100` → Completed. Derived on every recompute.
- **Parent rollup** (`rollupChildren`): `planStart` = min child, `planEnd` = max child,
  `duration` = working days between them, `%Complete` = duration-weighted mean (plain average when
  children have no durations), `status` = derived (on-hold preserved). `rollupScheduleTasks` recurses
  bottom-up; the editor and AI tools recompute the whole tree after every edit.
- **Leaf fields are manual**: title, owner, duration, plan dates, actuals, %complete, note. Parent
  plan/duration/% fields are read-only in the UI (show the rolled-up values); title/owner/actuals/
  note and status (for on-hold) remain editable.

### Editor (PlannerEditor)

- Grid with columns: **No. · Title · Status · Owner · Duration · Plan Start · Plan End · Actual
  Start · Actual End · %Complete · Note**, plus per-row actions (add subtask, add sibling, delete —
  deleting a parent requires a child-confirmation modal).
- Single source of truth is the store's `scheduleContent`; every edit recomputes the tree and
  auto-saves ~800ms debounced (flushed on unmount). Calendar button opens `CalendarModal` (week
  selects + holiday date list with add/remove).
- **Undo/redo**: toolbar Undo/Redo buttons plus `⌘Z` / `⇧⌘Z` (on Windows/Linux `Ctrl+Z` /
  `Ctrl+Shift+Z` or `Ctrl+Y`). History lives in the zustand store as per-schedule stacks
  (`plannerUndo` / `plannerRedo` keyed by schedule id, capped at 100 entries, pruned on delete).
  Discrete actions (add/delete/move/status/date/columns) record a deep-cloned pre-edit snapshot
  immediately in `commit()`. Text/number fields (title, owner, duration, %complete, note) capture
  the pre-edit snapshot on **focus** and record it as a single undo step when the field **loses
  focus**, so a typing session undoes once instead of per character. Undo/redo restore the snapshot
  into `scheduleContent`, cancel any pending autosave, and debounce-save the restored state.
  Keyboard interception is done in the **main process** via `before-input-event` (the app menu's
  `undo`/`redo` roles swallow `⌘Z` before the renderer sees it), gated by a `planner:set-edit-active`
  flag the editor updates from `focusin`/`focusout` — so the markdown editor, chat input, and native
  text fields keep their own undo behavior.
- Sidebar tab (`mdiChartTimeline`) → PlannerPanel (schedule list) → PlannerEditor (keyed by
  `activeScheduleId`); an empty-state "New Schedule" flow otherwise.
- **No. and Title are always visible**: both columns are always rendered (row/header/`colTemplate`
  guards removed) and are checked + disabled in the column modal (`disabledKeys`), so the grid
  always has a stable identity + label to anchor the Gantt view.

### Gantt view (GanttChart)

- Bottom status bar with a segmented **Grid View** / **Gantt Chart View** toggle. The view is
  component-local state (session-only — resets to Grid on schedule change); switching carries the
  scroll position between the grid and the Gantt body and clears that schedule's undo/redo history
  (`plannerClearHistory`). In Gantt mode the toolbar's add/delete/copy/indent/move, columns, and
  calendar buttons are disabled, and a day-width zoom slider (16–32 px, step 4) appears in the
  status bar.
- `GanttChart` renders the task tree itself (recursive `renderTree`, deriving No. numbering and
  honoring the shared `collapsed` set — consistent with the table view). The timeline
  (`buildTimeline`) auto-fits min `planStart` → max `planEnd` (+7-day padding, fallback today) and
  is rebuilt only when tasks change. Fixed left columns: collapse toggle (28px) + No. (46px) +
  Title (220px), indented by depth. Header: month band + a floating "current month" label that
  follows horizontal scroll, and a day axis (weekday + day number) where non-working days
  (`isWorkingDay`) are shaded gray and today is highlighted.
- **Bars**: leaves are draggable, parents are not (distinct color + `v───v` end arrows). Leaf bars
  expose left/right edge handles; pointer drags snap to whole days (`clampDelta` keeps the bar in
  the timeline and start ≤ end), preview locally in `drag` state (the store is untouched until
  release), and commit once on release with a non-zero delta via
  `onResize(id, start, end, mode)`:
  - `start` — sets `planStart`, keeps `planEnd` fixed, recomputes `duration` (deliberately **not**
    `applyDateRule`, which would preserve duration);
  - `end` — sets `planEnd`, keeps `planStart` fixed, recomputes `duration`;
  - `move` — shifts both dates by the same day delta (duration preserved).
- **Bar popup**: right-click any bar (parent or leaf) for No., Title, Plan Start, Plan End, and
  Duration (working days); closes on outside click / Escape / close button. Leaves with dates get
  a **Clear Plan** action (`planStart`/`planEnd` → null).
- **Day-cell click**: for date-less leaves, clicking a day cell sets `planStart` to that day and
  `planEnd = computeEndDate(date, duration, calendar)` (duration defaults to 1); settable cells
  show a hover hint, and date-less leaf titles are dimmed.
- All Gantt edits route through the editor's `editTask`/`commit`, so rollup, undo/redo, and
  debounce autosave behave exactly as in the table view.

## Notes & caveats

- DuckDuckGo scraping can be rate-limited; errors are surfaced to the model so it can retry/adapt.
- Tool count is 26 (a guideline; acceptable tradeoff for the skills + HITL + module orchestration + planner features).
- `ask_user` is **chat-only**: module subagents never receive it (filtered out of the module tool list), and `ToolContext.ask` is absent in module runs so it can never pop a dialog from a background run.
- `submit_result` is **module-only** and `start_module`/`wait_modules` are **chat-only**: module subagents never receive them (their tool list is `baseTools` minus `ask_user`, plus the module's own tools and `set_plan`/`update_step` — plus `submit_result` only when the run has an `expectResult`), so no module-nesting of module runs.
- API key must never be committed or bundled into the renderer.
- The persistent project registry only records known project names/paths — it never stores file contents; the folder on disk remains the source of truth.
- `note:<notename>` uses the note's slugified file name (as shown in the Notes list), so the `@` picker should insert the exact list name.
- `todo:<todotext>` uses the todo's checklist text, so the `!` picker should insert the exact text.
- The system prompt instructs the AI to link to skills it mentions as `[skill name](skill:skill name)`; the renderer renders these as clickable pills (book icon) that open **Settings → Skills** and load the skill into the editor (via `openSkillEditor` + the `skillEditRequest` store field).
- The **Browser toolset** (12 `browser_*` tools) is an in-process MCP server + client over `InMemoryTransport`, implemented in `src/main/mcp/`. The server registers tools via the MCP SDK's `registerTool` (zod schemas); the chat session wraps them as `PTTool` via `client.callTool`. The browser is launched from `playwright-core` driving installed Chrome/Edge (no bundled Chromium). Headful by default; headless mode requires `ask_user` confirmation via the system-prompt guard. Toolset is **chat-only** (never in module subagents) and toggled in Settings → Toolsets. Each enabled toolset adds tools to every chat turn — more tokens and higher chance of wrong tool selection.
- **Toolsets settings category** holds built-in toolsets (currently: Browser) and is designed for future external MCP connections. Persisted in `ptnotes-settings.json` as `disabledToolsets`.

## Docs

- `README.md` — user-facing overview, features, and commands.
- `CHANGELOG.md` — versioned change log.
