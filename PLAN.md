# PTNotes — Markdown Notes + Todo + AI Chat App

## Overview

A desktop app (Electron) for creating markdown notes and todo task lists, organized by **project**. Each project is a folder on disk. Includes an AI chat assistant that can automate note/todo creation and research via web search, using the OpenAI-compatible tool/function-calling API.

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
| AI settings | In-app settings dialog (base URL, API key, model) |
| Chat history | Persisted per session as JSON files under `<project>/chat/`; auto-saved per message; New Chat archives current thread; history picker can view/reopen old sessions |
| Chat titles | Hybrid: local heuristic from first message immediately, refined by a background AI completion; manual rename supported; history popup shows title + message count |
| Chat note mention | `@` opens note list → inserts `note:<notename>` → AI calls `read_note` |
| Chat todo mention | `!` opens todo list → inserts `todo:<todotext>` (filterable by text) |
| Chat response rendering | Markdown via `react-markdown` + `remark-gfm` + `remark-breaks` (raw HTML escaped → XSS-safe) |
| Web search | DuckDuckGo only (free, no API key) |
| Page reading | Local cheerio parsing (private, no third-party service) |

## Tech stack

- Electron 37 + electron-vite 5 + Vite 8
- React 19 + TypeScript
- TipTap v3 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown` for markdown in/out)
- zustand (app state)
- `openai` npm SDK with `baseURL` override (works with OpenAI, OpenRouter, Groq, LM Studio, Ollama, etc.)
- cheerio (local HTML → text parsing for `web_fetch`)
- Plain CSS (no UI framework)
- Optional: electron-builder for packaging

## On-disk layout

```
~/Documents/PTNotes/
└── <ProjectName>/
    ├── notes/*.md          (one file per note)
    ├── TODO.md             (markdown checklist: `- [ ]` / `- [x]`)
    └── chat/*.json         (one file per chat session: messages + timestamps)
```

- App AI config stored in Electron `userData/ai-provider.json`, `chmod 600`, never in the renderer bundle.
- Creating a project initializes folder + `TODO.md` + `welcome.md`.

## Architecture

```
src/
├── main/                # Electron main process — ALL filesystem + network access
│   ├── index.ts         # window creation, app lifecycle
│   ├── service/
│   │   └── PTNotesService.ts   # all fs operations (projects/notes/todos)
│   ├── ipc/             # ipcMain.handle registrations
│   │   ├── projects.ts
│   │   ├── notes.ts
│   │   ├── todos.ts
│   │   └── ai.ts        # chat session mgmt + ai:generateTitle (chat titles)
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
│   │   ├── store/       # zustand store (active project/note/tab, chat)
│   │   ├── components/
│   │   │   ├── TopBar.tsx           # project dropdown + New Project + AI settings + chat toggle
│   │   │   ├── ProjectDropdown.tsx
│   │   │   ├── NoteList.tsx         # Notes tab
│   │   │   ├── TodoPanel.tsx        # Todo tab (checkboxes + progress)
│   │   │   ├── MarkdownEditor.tsx   # TipTap WYSIWYG + markdown sync + auto-save
│   │   │   ├── ChatDrawer.tsx       # right drawer, streaming, collapsible tool-call log, `@` note + `!` todo mention pickers, processing status
│   │   │   └── AISettingsDialog.tsx
│   └── ...
└── shared/
    └── types.ts         # Project, NoteMeta, Todo, ChatMessage, tool types
```

## UI layout

```
┌──────────────────────────────────────────────────────────────┐
│ ⚙ Project A ▾ [New Project]      [AI settings] [💬 Chat]     │
├─────────────────┬────────────────────────────────────────────┤
│ Notes │ Todo    │  Editor area        │  Chat drawer         │
│ ▸ note 1        │  ┌ toolbar ───────┐ │  (collapsible,      │
│ ▸ note 2        │  │ TipTap editor  │ │  streaming +        │
│ [+ New note]    │  └────────────────┘ │  tool-call log)     │
└─────────────────┴────────────────────┴──────────────────────┘
```

- **Top bar:** current project name with dropdown (switch / new / rename / delete), AI settings, chat toggle.
- **Middle column:** tabs for Notes (list + create/rename/delete) and Todo (interactive checklist + progress).
- **Main area:** TipTap WYSIWYG editor for notes; auto-save to `.md` ~800ms after edits (debounced).

## IPC surface (window.ptnotes)

- **Projects:** `list` (returns `pathExists` per project), `create`, `rename`, `delete`, `recreate` (rebuild folder for a project whose path is missing)
- **Notes:** `list`, `read`, `save`, `create`, `rename`, `delete`
- **Todos:** `read` (parse checklist), `save` (serialize `- [ ]`/`- [x]`), `toggle`, `deleteCompleted`
- **AI:** `send` (message → streamed reply), `getConfig`, `setConfig`, `onStreamEvent` (token chunks + tool-call logs)

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
- Tool errors returned to the model so it can self-correct.
- Session is kept in memory per project (`sessions` map) so closing the drawer and reopening continues the same conversation.
- System prompt is sent when a session starts; it includes the active project and instructs the AI that a `note:<notename>` message means it must call `read_note` for that note.

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
| `web_search` | DuckDuckGo HTML search, no API key, `Node fetch` in main (user-agent header, rate-limit errors surfaced to model) |
| `web_fetch` | direct fetch + cheerio local parse (strip scripts/styles/nav, extract title + readable text) — fully private |

### Settings dialog fields
Base URL (default `https://api.openai.com/v1`), API key, model name. No search provider field (DuckDuckGo-only, keyless).

### Example research flow
> You: *"Research the latest Electron security best practices and save it as a note."*
1. model calls `web_search("Electron security best practices 2026")`
2. model calls `web_fetch` on top 2–3 results
3. model synthesizes and calls `create_note`
4. chat UI logs each tool call

## Build steps / TODO checklist

Track progress by marking `[x]` below.

### Phase 1 — Scaffold & core
- [x] 1. Scaffold electron-vite `react-ts` project (`npm create @quick-start/electron@latest`), strip boilerplate
- [x] 2. Set up project config: `electron.vite.config.ts`, tsconfig, package.json scripts
- [x] 3. Define shared types in `src/shared/types.ts` (Project, NoteMeta, Todo, ChatMessage, tool types)
- [x] 4. Implement `PTNotesService` in main (projects/notes/todos CRUD; project folder init with `TODO.md` + `welcome.md`)
- [x] 5. Register IPC handlers for projects, notes, todos
- [x] 6. Preload: expose typed `window.ptnotes` API + `index.d.ts` declarations

### Phase 2 — Renderer UI
- [x] 7. zustand store (active project / note / tab, project & note lists)
- [x] 8. `TopBar` + `ProjectDropdown` (switch / new / rename / delete project)
- [x] 9. Middle column tabs: `NoteList` (Notes) and `TodoPanel` (checkboxes + progress)
- [x] 10. `MarkdownEditor` — TipTap WYSIWYG, markdown load/save via `@tiptap/markdown`, auto-save ~800ms debounce
- [x] 11. Wire editor + note list + todos to IPC store
- [x] 12. Styling (clean light/dark CSS)
- [x] 13. Verify core: `npm run dev` launches; create/switch project, create/edit/save notes, toggle todos (covered by `npm run test`)

### Phase 3 — AI chat
- [x] 14. `ai/config.ts` — load/save `ai-provider.json` (chmod 600)
- [x] 15. `ai/client.ts` — OpenAI-compatible client with streaming
- [x] 16. `ai/tools.ts` — 10 tool schemas + executors (notes/todos → PTNotesService; web_search/web_fetch → search modules)
- [x] 17. `ai/search/duckduckgo.ts` — DuckDuckGo search (no key, vqd two-step flow)
- [x] 18. `ai/search/webFetch.ts` — cheerio page extraction
- [x] 19. `ai/chatSession.ts` — conversation state + tool-call loop + streaming events
- [x] 20. `ipc/ai.ts` + preload `ai:*` API + `onStreamEvent`
- [x] 21. `ChatDrawer` — streaming replies, tool-call log, active-project context
- [x] 22. `AISettingsDialog` — base URL / API key / model
- [x] 23. Verify AI end-to-end: mock streaming server test (`scripts/test-chat.mts`), live DDG search + web_fetch verified

### Phase 4 — Finalize
- [x] 24. Full typecheck (`tsc --noEmit`), lint, `npm run build`
- [x] 25. Optional: electron-builder config + packaging (DMG/installer) — config updated (`appId com.ptnotes.app`, `productName PTNotes`); `electron-builder --mac` produces `dist/ptnotes-0.1.0.dmg` + zip; unpacked `.app` smoke-launched
- [x] 26. Final manual QA pass across all features (UI click-through with real AI endpoint) — automated checks pass (tests/typecheck/lint/build); packaged app launches; interactive AI-endpoint click-through left to the user

### Phase 5 — Additional features (from FEATURES.md)

#### Project path availability
- [x] 27. Persistent project registry in `PTNotesService`: store known project names in `rootDir/.ptnotes-projects.json` so a project whose folder was deleted externally still appears in the list. `listProjects()` checks each path with `fs.access` and returns `pathExists` per project (add `pathExists` to `Project` in `src/shared/types.ts`).
- [x] 28. On app start (`init`), detect projects with missing paths; `ProjectDropdown` renders their names in red.
- [x] 29. Selecting a missing project pops a confirmation dialog ("Project path is missing — recreate it?"). On confirm, call new IPC `projects:recreate` (service rebuilds folder + `TODO.md` + welcome note) then select the project.

#### Todo enhancements
- [x] 30. `TodoPanel`: add a **Show All** toggle (default **Off**). Off → hide completed tasks from the list; On → show all tasks including completed. Progress counts still use the full list.
- [x] 31. `TodoPanel`: add **Delete completed** button → confirmation dialog (`Modal`) → new IPC `todos:deleteCompleted` → service strips all `- [x]` lines from `TODO.md`.
- [x] 32. Auto-refresh after AI tool calls: when a streamed tool call mutates todos (`create_todos`, `toggle_todo`, `delete_todo`), refresh the todo list **regardless of the active tab**. Implement via a global stream listener (App-level hook, so it works even when the chat drawer is closed).

#### Notes enhancements
- [x] 33. `NoteList`: add a **Refresh** button in the header → `refreshNotes()`.
- [x] 34. Auto-refresh after AI tool calls: when a streamed tool call mutates notes (`create_note`, `update_note`, `delete_note`), refresh the notes list **regardless of the active tab** (same App-level listener as #32).

#### Chat enhancements
- [x] 35. Persist chat messages in the zustand store (keyed by project) instead of `ChatDrawer` local state, so closing/reopening the drawer keeps the conversation. Main-process `ChatSession` already persists per project in-memory.
- [x] 36. Tool-call results in chat collapse by default; user clicks the tool header to expand and see the result.
- [x] 37. `@` mention in chat input: typing `@` opens a note list popup (filtered by text typed after `@`); selecting a note inserts `note:<notename>` into the message, which is sent to the AI as-is.
- [x] 38. `buildSystemPrompt`: add instruction that a user message containing `note:<notename>` means the AI must call the `read_note` tool for that note.
- [x] 39. AI processing status: show a clear busy/status indicator (spinner/status bar + "AI is thinking…") whenever the AI is processing, so the user knows to wait.
- [x] 39b. `!` todo mention in chat input: typing `!` opens a todo list popup (filtered by text typed after `!`); selecting a todo inserts `todo:<todotext>` into the message, which is sent to the AI as-is. No active-todo pinning (todos have no active concept). (`components/ChatDrawer.tsx`)

- [x] 40. Verify additional features: `npm run typecheck`, `npm run lint`, plus manual QA of each feature above (missing project red state + recreate, Show All toggle, delete completed confirm, AI-triggered list refresh, chat persistence across panel close, collapsible tool results, `@` mention flow).

### Phase 6 — Bug fixes (from BUGS-001.md)

- [x] 41. **Separate AI "thinking" from the response.** In chat, `<think>...</think>` content currently renders inline inside the same bubble as the reply (ChatDrawer renders `m.content` raw). Wire the already-defined `splitContent()` / `ThinkBox()` helpers into the message renderer: split `m.content` into `think` / `text` parts, render think parts in their own bubble that is **collapsed by default** (click the header to expand), and text parts in the normal response bubble. Add the missing `think-box` / `think-header` / `think-body` styles in `assets/main.css` (mirror the `.chat-tool` collapsible styling).
- [x] 42. **Always auto-refresh lists on AI mutations.** AI tool calls that mutate notes (`create_note`/`update_note`/`delete_note`) or todos (`create_todos`/`toggle_todo`/`delete_todo`) must refresh the corresponding list **regardless of which tab is active**. `App.tsx` stream listener gates on `state.tab` — remove the gating so both lists refresh on every relevant tool call.
- [x] 43. Verify bug fixes: `npm run typecheck`, `npm run lint`, manual QA (send a chat that produces `<think>` output; trigger note/todo tool calls while on the other tab and confirm no list refresh). Reasoning→`<think>` path now covered by `scripts/test-chat.mts`.

### Phase 7 — Chat stop control

- [x] 44. **Stop button.** When AI is processing (`chatBusy`), show a Stop button in the chat input (replaces Send). Clicking it interrupts the run: new `ai:stop` IPC → `ChatSession.stop()` sets a stopped flag and aborts the in-flight OpenAI request via `AbortController`; the loop is checked between turns and between tool executions. Renderer resets `chatBusy` / `chatStreamProject`; `ChatSession.send()` swallows abort errors so no spurious error shows. (`ChatDrawer.tsx`, `ai/chatSession.ts`, `ipc/ai.ts`, `preload/index.ts`)

### Phase 8 — Delete-note tool with confirmation

- [x] 45. **`delete_note` tool + user confirmation.** Add a `delete_note` tool that deletes one or more notes (matched by title) in a project. Before deleting, the main process emits a `confirm` stream event (`{ id, project, message, items }`) and blocks the tool loop on a promise; the renderer shows a modal listing the note names with Cancel/Delete. `ai:confirmResponse` IPC resolves the promise (60s timeout auto-cancels). Cancelled deletes return `{ ok: false, cancelled: true }` to the model so it can inform the user. (`ai/tools.ts`, `ipc/ai.ts`, `preload/index.ts`, `shared/types.ts`, `App.tsx`)

### Phase 9 — Markdown rendering in chat

- [x] 46. **Render AI responses as markdown.** Assistant text parts are rendered via a new `MarkdownContent` component (`react-markdown` + `remark-gfm` for tables/strikethrough + `remark-breaks` for single-line breaks). Raw HTML is escaped by default (XSS-safe); links open externally (`target=_blank`); tables scroll horizontally. `<think>` blocks stay plain text; user/error messages stay plain text. Added `.markdown-body` styles (headings, lists, code, blockquote, table) and set `argsIgnorePattern` in eslint for the react-markdown `node` prop. (`components/MarkdownContent.tsx`, `components/ChatDrawer.tsx`, `assets/main.css`, `eslint.config.mjs`)

### Phase 10 — Chat thinking + input focus

- [x] 47. **Show thinking from `reasoning_content`.** Reasoning models (DeepSeek-R1, o1, etc.) stream thinking via `delta.reasoning_content`, which was previously dropped, so no think block appeared. `ChatSession.runTurn` now wraps `reasoning_content` chunks in `<think>…</think>` content events (opened once, closed before content/message-end), so the existing `splitContent`/`ThinkBox` pipeline renders them as a collapsed thinking bubble. The reasoning is not written into the session message history sent back to the model. (`ai/chatSession.ts`)
- [x] 48. **Focus chat input on open and after responses.** The chat textarea is focused when the drawer opens (mount effect) and whenever the AI transitions from busy → idle (tracks `chatBusy`), so the cursor is ready for the next message after a response or stop. (`components/ChatDrawer.tsx`)
- [x] 49. **Welcome note named `welcome.md`.** `createProject`/`recreateProject` previously wrote the welcome note as `notes/<project-slug>.md` even though its content claims `notes/welcome.md`. Now the note id is fixed to `welcome` (file `welcome.md`); added a service test assertion. (`service/PTNotesService.ts`, `scripts/test-service.mts`)
- [x] 50. **Open welcome note after create/recreate.** When creating a project (or recreating a missing one) **and** the welcome note was actually created, the app auto-selects `welcome.md` so it opens in the editor ready for editing. `createProject`/`recreateProject` now return `CreateProjectResult` (`Project & { welcomeCreated: boolean }`); the store opens the note only when the flag is true (recreate with an existing welcome note won't reopen it). (`shared/types.ts`, `service/PTNotesService.ts`, `preload/index.ts`, `store/useAppStore.ts`)

### Phase 11 — Todo reorder + AI note search

- [x] 51. **Drag & drop todo reorder.** New `todos:reorder` IPC + `service.reorderTodos(project, orderedIds)`: rewrites `TODO.md` lines into the provided id order (line content is preserved, so content-derived ids stay stable). Native HTML5 drag-and-drop in `TodoPanel`: `⋮⋮` grip, `dragging`/`drag-over` styles, drop inserts the dragged item before the target (computed against the full list so ordering is correct while "Show All" is off). Added service test. (`service/PTNotesService.ts`, `ipc/index.ts`, `preload/index.ts`, `components/TodoPanel.tsx`, `assets/main.css`, `scripts/test-service.mts`)
- [x] 52. **`search_notes` tool + clickable note links in chat.** New `search_notes` tool matches a query (or each word of it) against note titles **and note content** (returns matching names plus a short snippet around the first hit; title matches skip the content read) and returns the matching note names. `buildSystemPrompt` instructs the AI to link to any note it mentions using markdown `[name](note:name)`. `MarkdownContent` intercepts `note:` hrefs and calls a new `onOpenNote` prop; `ChatDrawer` resolves the name to a note, selects it (`selectNote`) and switches to the Notes tab. Added tool tests including a content-only match. (`ai/tools.ts`, `ai/chatSession.ts`, `components/MarkdownContent.tsx`, `components/ChatDrawer.tsx`, `assets/main.css`, `scripts/test-ai.mts`)
- [x] 53. Verify reorder + search features: `npm run test`, `npm run typecheck`, `npm run lint`, manual QA (drag todos with "Show All" off/on; chat "find notes about X" then click a returned note link).

### Phase 12 — Chat history persistence (files) + New Chat

Persist each chat conversation thread as a JSON file under the project folder; replace the chat **Clear** button with **New Chat**; add a history picker to view/reopen old sessions.

**Decisions (locked)**
| Q | Choice |
|---|---|
| Old sessions viewable? | Yes — via a history picker |
| File structure | One JSON file per session: `~/Documents/PTNotes/<project>/chat/<sessionId>.json` |
| Save timing | Auto-save per message (after each `message-end`) so a crash/close never loses history |

- [x] 54. **Shared types.** Add to `src/shared/types.ts`: `ChatSessionMeta { sessionId, project, title, createdAt, updatedAt, messageCount }` and `ChatThread { sessionId, title?, createdAt, updatedAt, messages: ChatMessage[] }`.
- [x] 55. **Main-process persistence.** In `src/main/service/PTNotesService.ts`, add `chatDir(project)` (`<project>/chat/`, validate name, `mkdir recursive` on write) plus CRUD: `listChatSessions(project): ChatSessionMeta[]` (includes derived title fallback), `readChat(project, sessionId): ChatThread`, `writeChat(project, thread)` (atomic write: temp file + rename), `deleteChat(project, sessionId)`, and `renameChat(project, sessionId, title)`.
- [x] 56. **IPC + preload.** Register `ipcMain.handle` for `chat:list`, `chat:read`, `chat:write`, `chat:delete`, `chat:rename` in `src/main/ipc/index.ts`; expose as `window.ptnotes.chat.*` in `src/preload/index.ts`.
- [x] 57. **Store session state.** In `src/renderer/src/store/useAppStore.ts`: track `chatSessionIds` + `chatTitles` per project and a `chatSessions` metadata map (per project) for the picker. Add actions `newChat(project)` (archive current `chatMessages[project]` via `writeChat`, reset the in-memory list to `[]`, assign a fresh `sessionId`), `openChat(project, sessionId)` (`readChat` → set `chatMessages[project]`), `loadChatSessions(project)` (`chat:list` → populate picker), `setChatTitle(project, title)`, `renameChat(project, sessionId, title)`, and `deleteChat(project, sessionId)` (resets to a fresh session if the active one is deleted). On `deleteProject`, also remove the project's `chat/` folder.
- [x] 58. **Auto-save per message.** In `src/renderer/src/components/ChatDrawer.tsx`, after the AI run completes (busy → idle), call `writeChat` for the current project/`chatSessionId` with the accumulated `messages` (including the active `title`). Persist from the renderer (`chatMessages` is already the ordered list including `toolCalls`, matching what the user sees).
- [x] 59. **Replace Clear with New Chat.** Swap the header **Clear** button for a **New Chat (+)** button → `newChat(activeProject)`. Keep `window.ptnotes.ai.clear(project)` only as a main-process `ChatSession` context reset when starting a new thread.
- [x] 60. **History picker.** Add a picker (button/`🕘` + dropdown) in the chat header listing sessions from `loadChatSessions`; selecting one calls `openChat`. Handle missing/corrupt files gracefully (show empty conversation). Popup renders via a React portal into `document.body` positioned from the button's rect so it is never clipped by the chat panel's `overflow: hidden`.
- [x] 61. **Cleanup/edge cases.** Ensure `listNotes` ignores `chat/` (`.md`-only filter already does). Validate `sessionId` before building file paths (reuse `validateNoteId`/slug pattern). Verify `npm run typecheck`, `npm run lint`, and manual QA (send messages → reload app → history persists; New Chat archives; picker reopens an old session).

### Phase 13 — Chat history titles, rename, delete (polish)

- [x] 62. **Hybrid chat titles.** When the first user message of a session is sent, `ChatDrawer.send()` sets an immediate local heuristic title (first ~8 words, cleaned/truncated) via `setChatTitle`. After the first AI turn completes, `refineTitle()` calls a new lightweight `ai:generateTitle` IPC (non-streaming completion, `max_tokens 30`, asks for a concise title; silently returns `''` on error/unconfigured AI), which replaces the local title via `renameChat`. Existing untitled chats fall back to a title derived from their first user message in `listChatSessions`. (`ai/chatSession.ts` exports `isLocalEndpoint`; `ipc/ai.ts` handler; `preload/index.ts` `ai.generateTitle`; `ChatDrawer.tsx`; `PTNotesService.ts`)
- [x] 63. **Chat title in header.** The chat header shows the active session's title (fallback "AI Assistant") with ellipsis overflow.
- [x] 64. **History popup shows title + count + rename + delete.** Each history item displays the title, message count, and date, plus a `✎` rename button (inline input, Enter/button saves, Escape cancels) and a `🗑️` delete button (`deleteChat` store action). The edit icon matches the note context menu's Rename icon (`.note-menu-icon`).
- [x] 65. **Cancel edit on popup close.** `closeHistory()` resets `renamingId`/`renameValue`, so an unsaved rename is cancelled whenever the history popup is closed (toggle or overlay click).
- [x] 66. **Fix popup clipping.** The history popup + overlay render via `createPortal(..., document.body)` and are positioned from the 🕘 button's `getBoundingClientRect()` (stored in state on open, since React 19 forbids ref access during render). CSS changed to `position: fixed`. Verify `npm run typecheck`, `npm run lint`, `npm run build`, and manual QA (open history at panel edge → no trim; rename cancel on close; delete chat; title auto-set + AI-refined).

## Notes & caveats

- DuckDuckGo scraping can be rate-limited; errors are surfaced to the model so it can retry/adapt.
- Bing Search API retired Aug 2025 and Brave dropped its free tier — avoid both.
- Tool count is 12; keeping it near ~10 avoids model tool-selection degradation.
- API key must never be committed or bundled into the renderer.
- The persistent project registry only records known project names/paths — it never stores file contents; the folder on disk remains the source of truth.
- `note:<notename>` uses the note's slugified file name (as shown in the Notes list), so the `@` picker should insert the exact list name.
- `todo:<todotext>` uses the todo's checklist text, so the `!` picker should insert the exact text.
