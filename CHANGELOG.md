# Changelog

All notable changes to PTNotes are documented in this file.

## [0.6.0] — 2026-08-13

### Changed

- **Chat/module data moved into `<project>/.data/`**: per-project `chat/` and
  `modules/` folders (including `modules/temp/`) now live under the dot-directory
  `<project>/.data/`, keeping app-internal data out of the project root and the
  `#` file picker. Legacy folders found at the project root are migrated
  automatically on startup (and after changing the storage root) — whole-folder
  move when the target is free, recursive merge otherwise, with colliding files
  kept as `-2` copies. The migration is idempotent.

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
