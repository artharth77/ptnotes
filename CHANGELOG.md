# Changelog

All notable changes to PTNotes are documented in this file.

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

### Changed

- Chat sessions now accept an extended tool list: the module `start_module` tool is merged on top of the 12 base tools (base tool behavior unchanged).

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
