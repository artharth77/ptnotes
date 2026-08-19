# AGENTS.md

Guidance for AI coding agents working in this repository. The full technical design lives in
`docs/ARCHITECTURE.md` — read it on demand when a task touches architecture, on-disk layout,
IPC, AI/chat features, module rendering, or the UI.

## Project

PTNotes is a desktop app (Electron) for markdown notes, todo task lists, project schedules/planner, and an AI chat assistant, organized by **project** — each project is a folder on disk.

## Stack

- Electron 39 + electron-vite 5 + Vite 7
- React 19 + TypeScript
- TipTap v3 (markdown in/out via `@tiptap/markdown`)
- zustand (app state)
- `openai` npm SDK with `baseURL` override (works with OpenAI, OpenRouter, Groq, LM Studio, Ollama, etc.)
- cheerio (local HTML → text parsing for `web_fetch`)
- `isomorphic-mermaid` (in-process module diagram rendering)
- `@antv/infographic` (in-process module infographic rendering)
- `docx` (in-process module Word-document rendering)
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

## Security invariants (do not break)

- The renderer must **never** access the network or filesystem; all I/O goes through IPC to the main process.
- The AI API key lives only in `userData/ai-provider.json` (chmod 600), read by the main process — never bundle it in the renderer.
- Chat HTML is rendered via `react-markdown` with raw HTML escaped (XSS-safe).
- Chart/diagram/infographic rasterization must stay isolated in Electron **utility processes** — module tools must call `renderChartIsolated` / `renderDiagramIsolated` / `renderInfographicIsolated`, never render on the main process. Full rules: `docs/ARCHITECTURE.md` → Security invariants.

## Conventions

- Follow existing patterns in neighboring files (store actions, IPC handler shapes, component style).
- Project names and note/chat ids are slugified and validated before building file paths (see `validateNoteId` / `chatDir` in `PTNotesService`). Planner schedule ids use `validateScheduleId` (same guard).
- Todo storage is a markdown checklist file (`TODO.md`, `- [ ]` / `- [x]`); the line content derives the id.
- Planner schedules are JSON in `<project>/planner/<slug>.json` with a shared `calendar.json` working-day config. The pure date/rollup engine lives in `src/shared/planner.ts` and must stay shared (main + renderer + tests) — do not duplicate the math.
- Planner UI: the store's `scheduleContent` is the single source of truth for the editor; parents' plan fields are rolled up from children (read-only in the UI), `On Hold` is manual-only, and actual dates are never computed.
- Planner undo/redo history lives in the store as per-schedule stacks (`plannerUndo`/`plannerRedo`). Text/number field edits are captured on focus and recorded as a single undo step when the field loses focus (blur); discrete actions (add/delete/move/status/date/columns) record immediately in `commit()`. Keyboard interception (`before-input-event`) is gated by a main-process `planner:set-edit-active` flag so it never hijacks the markdown/chat/native undo.
- Use existing utilities; do not add new dependencies without checking `package.json`.
- Do not add comments unless necessary.

## Reference

For the full technical design — product decisions, on-disk layout, source tree, security
invariants, UI layout, IPC surface (`window.ptnotes`), AI chat feature (flow, tools, module
orchestration, raw AI trace, PDF attachments, chat UI, slash commands, settings dialog), and
notes & caveats — read `docs/ARCHITECTURE.md`.

## Docs

- `README.md` — user-facing overview, features, and commands.
- `CHANGELOG.md` — versioned change log.
