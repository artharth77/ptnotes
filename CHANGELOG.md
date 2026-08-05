# Changelog

All notable changes to PTNotes are documented in this file.

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
