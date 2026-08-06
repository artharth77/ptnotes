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

| Area | Decision |
|---|---|
| Interface | Desktop GUI (Electron) |
| Editor | WYSIWYG rich text (TipTap) with markdown as source of truth |
| Todo storage | Markdown checklist file (`TODO.md`) |
| Stack | Electron + electron-vite + React 19 + TypeScript |
| Project selector | Top bar: current project name dropdown + New Project button |
| Project registry | Persistent known-project list so folders deleted externally still show (missing paths marked red) |
| Chat placement | Collapsible right-side drawer |
| AI streaming | Yes (real-time) |
| Settings dialog | Two-panel dialog: **Storage** (project root path) + **AI Settings** (base URL, API key, model) |
| Project root | Configurable via settings; default `~/Documents/PTNotes`; changing it moves all data + registry to the new location after confirmation |
| Chat history | Persisted per session as JSON files under `<project>/chat/`; auto-saved per message; New Chat archives current thread; history picker can view/reopen old sessions |
| Chat titles | Hybrid: local heuristic from first message immediately, refined by a background AI completion; manual rename supported; history popup shows title + message count |
| Chat note mention | `@` opens note list → inserts `note:<notename>` → AI calls `read_note` |
| Chat todo mention | `!` opens todo list → inserts `todo:<todotext>` (filterable by text) |
| Chat response rendering | Markdown via `react-markdown` + `remark-gfm` + `remark-breaks` (raw HTML escaped → XSS-safe) |
| Web search | DuckDuckGo only (free, no API key) |
| Page reading | Local cheerio parsing (private, no third-party service) |

## On-disk layout

```
~/Documents/PTNotes/
└── <ProjectName>/
    ├── notes/*.md          (one file per note)
    ├── TODO.md             (markdown checklist: `- [ ]` / `- [x]`)
    └── chat/*.json         (one file per chat session: messages + timestamps)
```

- App AI config stored in Electron `userData/ai-provider.json`, `chmod 600`, never in the renderer bundle.
- App settings (project root path) stored in Electron `userData/ptnotes-settings.json`, `chmod 600`.
- Creating a project initializes folder + `TODO.md` + `welcome.md`.
- `.ptnotes-projects.json` in the root dir is the persistent project registry so externally-deleted folders still show (missing paths flagged `pathExists: false`).

## Architecture

```
src/
├── main/                # Electron main process — ALL filesystem + network access
│   ├── index.ts         # window creation, app lifecycle
│   ├── settings.ts      # SettingsStore (userData/ptnotes-settings.json → project root)
│   ├── service/
│   │   └── PTNotesService.ts   # all fs operations (projects/notes/todos/chats) + changeRootDir
│   ├── ipc/             # ipcMain.handle registrations
│   │   ├── projects.ts
│   │   ├── notes.ts
│   │   ├── todos.ts
│   │   ├── chat.ts      # chat history persistence (list/read/write/delete/rename)
│   │   ├── ai.ts        # chat session mgmt + ai:generateTitle (chat titles)
│   │   └── settings.ts  # settings:get / settings:chooseRoot / settings:changeRoot
│   └── ai/
│       ├── client.ts    # OpenAI-compatible client (streaming)
│       ├── tools.ts     # tool JSON schemas + executors (bind to PTNotesService)
│       ├── chatSession.ts   # conversation state + tool-call loop
│       ├── config.ts    # ai-provider.json load/save
│       └── search/
│           ├── duckduckgo.ts  # web_search (no key)
│           └── webFetch.ts    # cheerio page extraction
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
│   │   │   ├── MarkdownContent.tsx  # react-markdown chat rendering + note: link handling
│   │   │   ├── ChatDrawer.tsx       # right drawer, streaming, mentions, history, titles
│   │   │   └── SettingsDialog.tsx  # two-panel Settings (Storage + AI Settings)
│   └── ...
└── shared/
    └── types.ts         # Project, NoteMeta, Todo, ChatMessage, tool types
```

### Security invariants (do not break)

- The renderer must **never** access the network or filesystem; all I/O goes through IPC to the main process.
- The AI API key lives only in `userData/ai-provider.json` (chmod 600), read by the main process — never bundle it in the renderer.
- Chat HTML is rendered via `react-markdown` with raw HTML escaped (XSS-safe); `<think>` blocks and user/error messages stay plain text.

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
- **AI:** `send` (message → streamed reply), `getConfig`, `setConfig`, `generateTitle`, `stop`, `clear`, `confirmResponse`, `onStreamEvent` (token chunks + tool-call logs + confirm events)
- **Settings:** `get` (returns `{ rootDir }`), `chooseRoot` (native folder picker), `changeRoot` (moves data + persists + returns new `{ rootDir }`)

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
- System prompt is sent when a session starts; it includes the active project and instructs the AI that a `note:<notename>` message means it must call `read_note` for that note.
- A `!` todo mention inserts `todo:<todotext>` which is sent to the model as-is.

### Tools (12 total)
| Tool | Action |
|---|---|
| `create_note` | new `.md` in project `notes/` |
| `update_note` | overwrite / rename existing note |
| `list_notes` | model context |
| `read_note` | model context |
| `search_notes` | search note titles + content, return matching names + snippet |
| `delete_note` | delete one or more notes (requires user confirmation dialog) |
| `create_todos` | append `- [ ]` items to `TODO.md` |
| `toggle_todo` | toggle a checklist item |
| `delete_todo` | remove an item |
| `list_todos` | model context |
| `web_search` | DuckDuckGo HTML search, no API key, Node fetch in main (user-agent header, rate-limit errors surfaced to model) |
| `web_fetch` | direct fetch + cheerio local parse (strip scripts/styles/nav, extract title + readable text) — fully private |

### Settings dialog
Two-panel dialog (`.settings-layout` with `.settings-nav` + `.settings-pane`):
- **Storage:** shows the current project root path (read-only) + **Change…** button that opens a native
  folder picker. Selecting a new root prompts for explicit confirmation ("Move all project data…")
  before `PTNotesService.changeRootDir` moves every project dir + `.ptnotes-projects.json`, and the
  settings store persists the new root.
- **AI Settings:** Base URL (default `https://api.openai.com/v1`), API key, model. No search provider
  field (DuckDuckGo-only, keyless).

### Example research flow
> You: *"Research the latest Electron security best practices and save it as a note."*
1. model calls `web_search("Electron security best practices 2026")`
2. model calls `web_fetch` on top 2–3 results
3. model synthesizes and calls `create_note`
4. chat UI logs each tool call

## Notes & caveats

- DuckDuckGo scraping can be rate-limited; errors are surfaced to the model so it can retry/adapt.
- Bing Search API retired Aug 2025 and Brave dropped its free tier — avoid both.
- Tool count is 12; keeping it near ~10 avoids model tool-selection degradation.
- API key must never be committed or bundled into the renderer.
- The persistent project registry only records known project names/paths — it never stores file contents; the folder on disk remains the source of truth.
- `note:<notename>` uses the note's slugified file name (as shown in the Notes list), so the `@` picker should insert the exact list name.
- `todo:<todotext>` uses the todo's checklist text, so the `!` picker should insert the exact text.

## Docs

- `README.md` — user-facing overview, features, and commands.
- `CHANGELOG.md` — versioned change log.