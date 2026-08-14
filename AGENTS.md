# AGENTS.md

Guidance for AI coding agents working in this repository. This file is the developer/agent reference and preserves the full technical design formerly in `PLAN.md`.

## Project

PTNotes is a desktop app (Electron) for markdown notes, todo task lists, and an AI chat assistant, organized by **project** — each project is a folder on disk.

## Stack

- Electron 39 + electron-vite 5 + Vite 7
- React 19 + TypeScript
- TipTap v3 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown` for markdown in/out)
- zustand (app state)
- `openai` npm SDK with `baseURL` override (works with OpenAI, OpenRouter, Groq, LM Studio, Ollama, etc.)
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

| Area                    | Decision                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface               | Desktop GUI (Electron)                                                                                                                                                                                                                                                                                              |
| Editor                  | WYSIWYG rich text (TipTap) with markdown as source of truth                                                                                                                                                                                                                                                         |
| Todo storage            | Markdown checklist file (`TODO.md`)                                                                                                                                                                                                                                                                                 |
| Stack                   | Electron + electron-vite + React 19 + TypeScript                                                                                                                                                                                                                                                                    |
| Project selector        | Top bar: current project name dropdown + New Project button                                                                                                                                                                                                                                                         |
| Project registry        | Persistent known-project list so folders deleted externally still show (missing paths marked red)                                                                                                                                                                                                                   |
| Chat placement          | Collapsible right-side drawer                                                                                                                                                                                                                                                                                       |
| AI streaming            | Yes (real-time)                                                                                                                                                                                                                                                                                                     |
| Settings dialog         | Two-panel dialog: **Storage** (project root path) + **AI Settings** (base URL, API key, model)                                                                                                                                                                                                                      |
| Project root            | Configurable via settings; default `~/Documents/PTNotes`; changing it moves all data + registry to the new location after confirmation                                                                                                                                                                              |
| Chat history            | Persisted per session as JSON files under `<project>/.data/chat/`; auto-saved per message; New Chat archives current thread; history picker can view/reopen old sessions                                                                                                                                            |
| Chat titles             | Hybrid: local heuristic from first message immediately, refined by a background AI completion; manual rename supported; history popup shows title + message count                                                                                                                                                   |
| Chat note mention       | `@` opens note list → inserts `note:<notename>` → AI calls `read_note`                                                                                                                                                                                                                                              |
| Chat todo mention       | `!` opens todo list → inserts `todo:<todotext>` (filterable by text)                                                                                                                                                                                                                                                |
| Chat file mention       | `#` opens project file list (`files:list` → `<project>/files/*` for PDF + text) → inserts `file:<filename>` → AI calls `read_file` (content-based: pdf-parse for PDFs, raw text for any text file)                                                                                                                  |
| Chat file drop          | Multi-file drag & drop into the chat: every supported file is copied silently to `<project>/files/` (no popup) and referenced via `#` mentions; support is **content-based** (any text file plus PDFs, detected by content not extension) — non-PDF binary files are rejected; if none are added, an alert is shown |
| Chat response rendering | Markdown via `react-markdown` + `remark-gfm` + `remark-breaks` (raw HTML escaped → XSS-safe)                                                                                                                                                                                                                        |
| Web search              | DuckDuckGo only (free, no API key)                                                                                                                                                                                                                                                                                  |
| Page reading            | Local cheerio parsing (private, no third-party service)                                                                                                                                                                                                                                                             |

## On-disk layout

```
~/Documents/PTNotes/
├── .skills/             (global skills: `<skill>/SKILL.md` with OpenAI skill-guide front-matter (`name:` + `description:`), shared by all projects)
└── <ProjectName>/
    ├── notes/*.md          (one file per note)
    ├── TODO.md             (markdown checklist: `- [ ]` / `- [x]`)
    ├── files/*.{pdf,md,txt,json,log,yaml,yml} (attachments copied on chat drop) + module deliverables (.pptx, .svg/.png, .docx)
    └── .data/              (app-internal data; dot-prefixed so it stays out of the # file picker)
        ├── modules/*.json        (module run state + prompts)
        ├── modules/*.chat.json   (per-run subagent transcript, read-only history overlay)
        ├── modules/temp/*.{png,svg,json}  (temp module/shared-tool output; deleted once the deck is built)
        ├── skills/*/SKILL.md (project skills — same OpenAI skill-guide layout (`<skill>/SKILL.md` with `name:` + `description:` front-matter) as global skills, scoped to one project)
        └── chat/*.json         (one file per chat session: messages + timestamps)
```

- On startup (and after `changeRootDir`), legacy per-project `chat/` and `modules/`
  folders found at the project root are migrated into `<project>/.data/` automatically
  (whole-folder `rename` when the target is free, recursive merge — keeping both files
  on collision with a `-2` suffix — otherwise). The migration is idempotent.

- App AI config stored in Electron `userData/ai-provider.json`, `chmod 600`, never in the renderer bundle.
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
│   │   ├── chat.ts      # chat history persistence (list/read/write/delete/rename)
│   │   ├── ai.ts        # chat session registry + ai:generateTitle (chat titles)
│   │   ├── files.ts     # files:* attach/extract/list/reveal + pdf:upload (multi-file drop: .pdf/.md/.txt)
│   │   ├── skills.ts    # skills:list/read/save/delete (global + project)
│   │   └── settings.ts  # settings:get / settings:chooseRoot / settings:changeRoot
│   └── ai/
│       ├── client.ts    # OpenAI-compatible client (streaming)
│       ├── tools.ts     # tool JSON schemas + executors (bind to PTNotesService)
│       ├── chatSession.ts   # conversation state + tool-call loop (system prompt refreshed per send, includes skills index)
│       ├── config.ts    # ai-provider.json load/save
│       ├── reader.ts     # readFileAsText + detectFileKind: content-based (pdf-parse for PDFs, raw text for any text file) + MAX_PDF_CHARS truncation
│       └── search/
│           ├── duckduckgo.ts  # web_search (no key)
│           └── webFetch.ts    # cheerio page extraction
│   └── modules/
│       ├── registry.ts   # module registry (extensible)
│       ├── runs.ts       # ModuleRunManager: start/list/stop + event broadcast + readChat (live in-memory transcript or persisted .chat.json)
│       ├── runner.ts     # subagent loop; persists a read-only transcript to <project>/.data/modules/<runId>.chat.json each turn (removed on run delete/retry)
│       ├── tool.ts       # start_module tool (main chat → module run)
│       ├── pptx/         # PowerPoint module (design schema → buildPptx)
│       ├── infographic/  # standalone infographic module (design schema → create_infographic_file; reuses the shared tool-pack)
│       ├── docx/         # Word document module (design schema → buildDocx; reuses the shared tool-pack)
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
│   │   │   ├── MarkdownEditor.tsx   # TipTap WYSIWYG + markdown sync + auto-save
│   │   │   ├── MarkdownContent.tsx  # react-markdown chat rendering + note:/skill: link handling
│   │   │   ├── ChatDrawer.tsx       # right drawer, streaming, mentions, history, titles
│   │   │   ├── ModuleHistoryOverlay.tsx # read-only transcript overlay for module runs (💬 button on ModuleCard)
│   │   │   └── SettingsDialog.tsx  # two-panel Settings (Storage + AI Settings)
│   └── ...
└── shared/
    └── types.ts         # Project, NoteMeta, Todo, ChatMessage, tool types
```

### Security invariants (do not break)

- The renderer must **never** access the network or filesystem; all I/O goes through IPC to the main process.
- The AI API key lives only in `userData/ai-provider.json` (chmod 600), read by the main process — never bundle it in the renderer.
- Chat HTML is rendered via `react-markdown` with raw HTML escaped (XSS-safe); `<think>` blocks and user/error messages stay plain text.
- Chart rasterization (Chart.js onto `@napi-rs/canvas`/skia) must stay isolated in the Electron **utility process** (`chart-render-worker.js`, spawned by `chartRenderer.ts`): a native segfault there must only fail the in-flight render tool, never crash the app. Module chart tools must call `renderChartIsolated`, never `renderChartPng` on the main process. The worker is a second `main` entry in `electron.vite.config.ts`; `PTNOTES_CHART_WORKER` env overrides its path for tests.
- Diagram rendering (mermaid DSL → SVG via the jsdom/svgdom shim, rasterized by `@resvg/resvg-js`) must stay isolated in the Electron **utility process** (`diagram-render-worker.js`, spawned by `diagramRenderer.ts`): heavy DOM parsing and any native crash there must only fail the in-flight render tool, never crash the app. Module diagram tools must call `renderDiagramIsolated`, never render mermaid on the main process. The worker is a `main` entry in `electron.vite.config.ts`; `PTNOTES_DIAGRAM_WORKER` env overrides its path for tests. Mermaid is ESM-only, so it is always loaded via dynamic `import()`.
- Infographic rendering (`@antv/infographic` SSR entry onto a `linkedom` DOM shim, rasterized by `@resvg/resvg-js`) must stay isolated in the Electron **utility process** (`infographic-render-worker.js`, spawned by `infographicRenderer.ts`): the SSR renderer installs browser-like globals (`window`/`document`/DOM classes) that it never restores, so the shared renderer snapshots/restores those globals around every render, and a heavy SSR/DOM render or native crash must only fail the in-flight render tool, never crash the app. Module infographic tools must call `renderInfographicIsolated`, never render on the main process. The worker is a `main` entry in `electron.vite.config.ts`; `PTNOTES_INFOGRAPHIC_WORKER` env overrides its path for tests. The SSR renderer only completes when the design has a `data` block — `icon`/`illus` fields are stripped (offline validation) so the worker never queries the package's remote icon service.

### Conventions

- Follow existing patterns in neighboring files (store actions, IPC handler shapes, component style).
- Project names and note/chat ids are slugified and validated before building file paths (see `validateNoteId` / `chatDir` in `PTNotesService`).
- Todo storage is a markdown checklist file (`TODO.md`, `- [ ]` / `- [x]`); the line content derives the id.
- Use existing utilities; do not add new dependencies without checking `package.json`.
- Do not add comments unless necessary.

## UI layout

```
┌──────────────────────────────────────────────────────────────┐
│ ⚙ Project A ▾ [New Project]      [Settings] [💬 Chat]     │
├─────────────────┬────────────────────────────────────────────┤
│ Notes │ Todo    │  Editor area        │  Chat drawer         │
│ ▸ note 1        │  ┌ toolbar ───────┐ │  (collapsible,      │
│ ▸ note 2        │  │ TipTap editor  │ │  streaming +        │
│ [+ New note]    │  └────────────────┘ │  tool-call log)     │
└─────────────────┴────────────────────┴──────────────────────┘
```

- **Top bar:** current project name with dropdown (switch / new / rename / delete), Settings, chat toggle.
- **Middle column:** tabs for Notes (list + create/rename/delete) and Todo (interactive checklist + progress).
- **Main area:** TipTap WYSIWYG editor for notes; auto-save to `.md` ~800ms after edits (debounced).

## IPC surface (window.ptnotes)

- **Projects:** `list` (returns `pathExists` per project), `create`, `rename`, `delete`, `recreate` (rebuild folder for a project whose path is missing)
- **Notes:** `list`, `read`, `save`, `create`, `rename`, `delete`
- **Todos:** `read` (parse checklist), `save` (serialize `- [ ]`/`- [x]`), `toggle`, `deleteCompleted`, `reorder`
- **Chat history:** `list`, `read`, `write`, `delete`, `rename`
- **AI:** `send` (message → streamed reply), `getConfig`, `setConfig`, `listModels(baseUrl, apiKey)`, `generateTitle`, `stop`, `clear`, `confirmResponse`, `askResponse` (human-in-the-loop answers for `ask_user`), `onStreamEvent` (token chunks + tool-call logs + confirm events)
- **Settings:** `get` (returns `{ rootDir }`), `getAbout` (app name/version + Electron/Chromium/Node versions for the About pane), `chooseRoot` (native folder picker), `changeRoot` (moves data + persists + returns new `{ rootDir }`)
- **Skills:** `list(project)` (returns `{ global, project }` metas), `read(project, scope, name)` (full content), `save(project, scope, name, { description, content, enabled? })` (upsert → `SkillMeta`), `setEnabled(project, scope, name, enabled)` (toggle → `SkillMeta`), `move(project, scope, name, toScope)` (relocates the skill folder between scopes → `SkillMeta`), `delete(project, scope, name)` (→ boolean)
- **PDF:** `supportsUpload` (returns the AI settings `uploadPdfEnabled` toggle — user-controlled), `upload` (raw PDF via provider Responses API `input_file` — uploads base64 through the Files API, falling back to inline `file_data`)
- **Files:** `list` (`<project>/files/*` — PDF + any text file — for the chat `#` picker), `getPathForFile` (dropped file path via `webUtils`, never `File.path`), `copyToProject` (content-based: any text file + PDFs copied into `<project>/files/`; non-PDF binaries rejected), `extract` (local text → `{ text, pageCount, charCount, truncated }`; pdf-parse for `.pdf`, raw text for any text file), `reveal` (`shell.showItemInFolder`)
- **Modules:** `list`, `listAvailable`, `setEnabled`, `start`, `startModule`, `stop`, `retry`, `reveal` (optional `filePath` to reveal a specific file of a multi-file run; defaults to the primary `outputFile`), `deleteRun`, `clearHistory`, `readChat` (per-run subagent transcript: live in-memory for active runs, persisted `<project>/.data/modules/<runId>.chat.json` otherwise). A run records **every** deliverable in `outputFiles` (one 📄 reveal pill each on the card; the first is also `outputFile`); `deleteRun`/`clearHistory` with the delete-output option removes them all.

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
- Each `ai:send` call receives the renderer's current thread as `history` and the session is re-seeded from it, so reopening a historical chat (or switching sessions) keeps the correct model context — the AI never relies solely on in-memory accumulation.
- System prompt is sent when a session starts; it includes the active project and instructs the AI that a `note:<notename>` message means it must call `read_note` for that note.
- Each `ai:send` also forwards the currently **active note** (`activeNoteId` from the renderer store). The system prompt tells the AI that "this note", "the current note" or "the active note" means it should call `read_note` **without a `title`**, which resolves to the note the user is viewing.
- The system prompt also lists available **enabled** skills (name + description per skill, global + project)
  and is **rebuilt on every `send()`** (`ensureSystemPrompt` → `renderSkillsIndex`), so skills
  created/edited/toggled in Settings apply mid-session. The model calls `read_skill` to load full content
  when a skill is relevant; disabled skills are excluded from the index and refused by `read_skill`.
- A `!` todo mention inserts `todo:<todotext>` which is sent to the model as-is.
- A `#` file mention inserts `file:<filename>`; the system prompt instructs the AI that a
  `file:<filename>` message means it must call `read_file` (content-based local extraction;
  `.pdf` via pdf-parse, any text file as raw text) before responding — so previously dropped
  files can be reused without re-dragging.

### Tools (17 total)

| Tool           | Action                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `create_note`  | new `.md` in project `notes/`                                                                                   |
| `update_note`  | overwrite / rename existing note                                                                                |
| `list_notes`   | model context                                                                                                   |
| `read_note`    | model context; omit `title` to read the currently active note (the one the user is viewing)                    |
| `search_notes` | search note titles + content, return matching names + snippet                                                   |
| `delete_note`  | delete one or more notes (requires user confirmation dialog)                                                    |
| `create_todos` | append `- [ ]` items to `TODO.md`                                                                               |
| `toggle_todo`  | toggle a checklist item                                                                                         |
| `delete_todo`  | remove an item                                                                                                  |
| `list_todos`   | model context                                                                                                   |
| `read_file`    | extract text of a project file locally via `readFileAsText` (pdf-parse for `.pdf`, raw text for any text file)  |
| `create_skill` | upsert a skill (`scope`: `global`/`project`) from name + description + content                                  |
| `read_skill`   | load a skill's full content (skills are listed in the system prompt; no separate `list_skills`)                 |
| `delete_skill` | delete a skill (requires user confirmation dialog)                                                              |
| `web_search`   | DuckDuckGo HTML search, no API key, Node fetch in main (user-agent header, rate-limit errors surfaced to model) |
| `web_fetch`    | direct fetch + cheerio local parse (strip scripts/styles/nav, extract title + readable text) — fully private    |
| `ask_user`     | ask the user 1–8 choice/free-text questions in a wizard dialog (radio / checkboxes / free text); chat-only     |

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
- **AI Settings:** Base URL (default `https://api.openai.com/v1`), API key, model (default empty —
  placeholder only, must be chosen), PDF upload toggle. No search provider field (DuckDuckGo-only,
  keyless). The **Model** field is an editable custom combobox: free-text `<input>` with a
  `Load models` button that calls `ai:listModels(baseUrl, apiKey)` (uses the in-dialog unsaved
  values) against `GET {baseUrl}/models`, then shows a scrollable dropdown (~10 rows) of fetched
  model ids that is filtered by typing; the typed value is never cleared on failure. The AI Selected
  category is driven by store state (`settingsCategory`, opened via `openSettings('ai')`).
- **Modules:** a toggle per registered module. Disabled modules are excluded from the `start_module`
  tool description and refused by `ModuleRunManager.start`; the list comes from
  `modules:listAvailable` / `modules:setEnabled`, persisted as `disabledModules` in
  `ptnotes-settings.json`. Toggles apply immediately, no Save button.
- **Skills:** lists global + project skills (name, description, enabled state) with a per-skill
  enable/disable toggle and a `⋮` context menu (Edit skill, Move to Global/Project skills,
  Delete-with-confirm). Create/edit happens in a modal (scope, name, description, content).
  Changes apply immediately — the chat system prompt re-renders its skills index on the next
  send. Disabled skills are excluded from the index and refused by `read_skill` (`enabled:`
  front-matter in `SKILL.md`, default enabled).
- Model downloads auto-load silently when the AI pane opens (best-effort; failures hidden until
  **Load models** is clicked).
- When the AI isn't configured (empty model, or no API key for a remote provider), the chat panel
  shows an **"AI not configured"** banner at the top with a button that opens **Settings → AI
  Settings** (`ai:getConfig` → `aiReady` check in `ChatDrawer`).

### Example research flow

> You: _"Research the latest Electron security best practices and save it as a note."_

1. model calls `web_search("Electron security best practices 2026")`
2. model calls `web_fetch` on top 2–3 results
3. model synthesizes and calls `create_note`
4. chat UI logs each tool call

## Notes & caveats

- DuckDuckGo scraping can be rate-limited; errors are surfaced to the model so it can retry/adapt.
- Bing Search API retired Aug 2025 and Brave dropped its free tier — avoid both.
- Tool count is 17 (AGENTS.md's ~10 is a guideline; acceptable tradeoff for the skills + HITL features).
- `ask_user` is **chat-only**: module subagents never receive it (filtered out of the module tool list), and `ToolContext.ask` is absent in module runs so it can never pop a dialog from a background run.
- API key must never be committed or bundled into the renderer.
- The persistent project registry only records known project names/paths — it never stores file contents; the folder on disk remains the source of truth.
- `note:<notename>` uses the note's slugified file name (as shown in the Notes list), so the `@` picker should insert the exact list name.
- `todo:<todotext>` uses the todo's checklist text, so the `!` picker should insert the exact text.
- The system prompt instructs the AI to link to skills it mentions as `[skill name](skill:skill name)`; the renderer renders these as clickable pills (book icon) that open **Settings → Skills** and load the skill into the editor (via `openSkillEditor` + the `skillEditRequest` store field).

## Docs

- `README.md` — user-facing overview, features, and commands.
- `CHANGELOG.md` — versioned change log.
