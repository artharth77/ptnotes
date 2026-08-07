# Changelog

All notable changes to PTNotes are documented in this file.

## [0.2.0] — 2026-08-07

### Added

#### Settings dialog & configurable project root
- General **Settings** dialog (two-panel: **Storage** + **AI Settings**); top-bar button renamed from *AI Settings* to **Settings**.
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
