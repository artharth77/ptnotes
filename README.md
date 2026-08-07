# PTNotes

Markdown notes + todo lists + AI assistant, organized by project. Electron + React + TypeScript.

## Features

- **Projects** — each project is a folder on disk with its own notes, todo list, and chat history. Create, rename, delete, and switch projects from the top bar.
- **Markdown notes** — TipTap WYSIWYG editor with markdown as the source of truth; auto-save ~800ms after edits. Notes are one `.md` file each, with create / rename / delete / refresh.
- **Todo lists** — markdown checklist per project with toggle, progress counts, **Show All** toggle, **Delete completed**, and drag & drop reorder.
- **AI chat assistant** — collapsible right-side drawer with real-time streaming replies. Works with any OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, LM Studio, Ollama, …); base URL, API key, and model configured in-app.
- **AI tools** — the assistant can create/update/read/delete/search notes, manage todos, search the web (DuckDuckGo, keyless), and read pages locally. Destructive actions (like note deletion) require your confirmation.
- **File attachments** — drag & drop files into the chat; supported files (any text file plus PDFs, detected by content) are copied locally to the project and can be reused via `#` mentions. The assistant reads them locally with the `read_file` tool.
- **Chat mentions** — type `@` to insert a note, `!` to insert a todo, `#` to attach a project file; the AI can link to your notes with clickable `[name](note:name)` links.
- **Chat history** — each session is auto-saved to a JSON file; **New Chat** archives the current thread and a history picker lets you reopen, rename, or delete old sessions.
- **Reasoning models** — `<think>` reasoning blocks (e.g. DeepSeek-R1) render in a separate collapsed-by-default bubble; a **Stop** button interrupts a running reply.
- **Missing projects** — projects whose folders were deleted externally still appear in the list (marked in red) and can be recreated in place.
- **Settings & storage** — a two-panel **Settings** dialog configures the project root (movable, with confirmation) and your AI provider, including an editable model combobox fed by `GET /models`.

## Tech stack

- Electron + electron-vite + React 19 + TypeScript
- TipTap v3 for the WYSIWYG markdown editor
- `openai` SDK (OpenAI-compatible endpoints) for the AI chat
- cheerio for local page reading
- Plain CSS, no UI framework

## Storage

Data lives under `~/Documents/PTNotes/`:

```
~/Documents/PTNotes/
└── <ProjectName>/
    ├── notes/*.md          (one file per note)
    ├── TODO.md             (markdown checklist)
    ├── files/*             (attachments dropped into the chat)
    └── chat/*.json         (one file per chat session)
```

The folder on disk is the source of truth, and the project root is configurable via **Settings → Storage** (changing it moves all data). App AI configuration (base URL, API key, model) is stored in Electron's `userData/ai-provider.json`, restricted to the owner's read/write and never bundled into the renderer.

## Commands

- `npm run dev` — development with HMR
- `npm run test` — service / AI tools / chat session / markdown tests
- `npm run typecheck` — TypeScript checks (main + renderer)
- `npm run lint` — ESLint
- `npm run build` — typecheck + electron-vite production build

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS (arm64: DMG + zip)
$ npm run build:mac

# For Linux
$ npm run build:linux
```

Packaged artifacts are written to `dist/` (e.g. `dist/ptnotes-0.2.0.dmg`).
