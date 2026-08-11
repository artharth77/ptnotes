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
- **Background modules** — the assistant can launch long-running background subagents (Modules, e.g. PPTX/PowerPoint, Word/DOCX, or Infographic) that plan steps and generate a deliverable file autonomously. A **Modules** tab shows live status and per-step progress; click the 💬 button on any run to open a read-only overlay of the module's full conversation (its system prompt, tool calls, and reasoning). Just ask e.g. *"make a PowerPoint about…"*, *"write a Word document about…"*, or *"make an infographic about…"* to start one.
- **Reasoning models** — `<think>` reasoning blocks (e.g. DeepSeek-R1) render in a separate collapsed-by-default bubble; a **Stop** button interrupts a running reply.
- **Missing projects** — projects whose folders were deleted externally still appear in the list (marked in red) and can be recreated in place.
- **Settings** — a category-based **Settings** dialog covers storage, AI provider (with an editable model combobox fed by `GET /models`), and modules. See [Settings](#settings).

## Tech stack

- Electron + electron-vite + React 19 + TypeScript
- TipTap v3 for the WYSIWYG markdown editor
- `openai` SDK (OpenAI-compatible endpoints) for the AI chat and modules
- `pdf-parse` for extracting text from PDFs (chat files, modules)
- `pptxgenjs` for generating PowerPoint deliverables (modules)
- `docx` for generating Word document deliverables (modules)
- Chart.js + `@napi-rs/canvas` for in-process chart rendering (modules)
- Mermaid + `isomorphic-mermaid` for in-process diagram rendering (modules)
- `@antv/infographic` for in-process infographic rendering (modules)
- `@resvg/resvg-js` for PNG rasterization (charts, diagrams & infographics)
- `lucide-static` icon catalog for slide icons (modules)
- `react-markdown` + `remark-gfm` + `remark-breaks` for rendering chat responses
- cheerio for local page reading
- zustand for state management
- electron-builder for packaging
- Plain CSS, no UI framework

## Storage

Data lives under `~/Documents/PTNotes/`:

```
~/Documents/PTNotes/
└── <ProjectName>/
    ├── notes/*.md          (one file per note)
    ├── TODO.md             (markdown checklist)
    ├── files/*             (attachments dropped into the chat, module outputs)
    ├── modules/*.json      (module run state + prompts)
    ├── modules/*.chat.json (per-run module conversation transcript)
    └── chat/*.json         (one file per chat session)
```

The folder on disk is the source of truth, and the project root is configurable via **Settings → Storage** (changing it moves all data). App AI configuration (base URL, API key, model) is stored in Electron's `userData/ai-provider.json`, restricted to the owner's read/write and never bundled into the renderer.

## Settings

The **Settings** page (⚙ icon in the top bar) is organized by category:

- **Storage** — shows the current project root and lets you change where all project data lives (with confirmation). Every project folder, notes, todos, chats, and the project registry are moved to the new location.
- **AI Settings** — connects the assistant to any OpenAI-compatible provider: base URL, API key, and model (editable combobox of available models), plus an optional **PDF upload** toggle for sending PDFs as raw file attachments.
- **Modules** — lists the installed background modules and their enable/disable toggles. Disabling a module hides it from the AI assistant and prevents it from being started; the toggles apply immediately.

## Commands

- `npm run dev` — development with HMR
- `npm run test` — service / AI tools / chat session / markdown / modules tests
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
