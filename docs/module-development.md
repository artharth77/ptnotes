# Building a PTNotes Module

This guide explains how to add a new background **module** (a "subagent") to PTNotes. Modules are self-registering plugins: they spawn an independent LLM loop in the main process that runs long, autonomous jobs (research, report generation, document creation, …) and produces a deliverable file while the user keeps using the app.

Read this document alongside the reference implementation: **`src/main/modules/pptx/`** (folder module) and **`src/main/modules/runner.ts`** (framework).

## How modules work — the big picture

```
User asks main chat agent for a deliverable
        │  e.g. "make a PowerPoint about our Q3 plans"
        ▼
Main chat agent (ChatSession) calls the `start_module` tool
        │  passes { id, title, prompt }  →  returns immediately
        ▼
ModuleRunManager.start()
        │  writes prompt JSON to <project>/.data/modules/
        │  builds a ModuleRun + emits status events to the UI
        ▼
ModuleRunner (background subagent, independent LLM loop)
        │  · mandatory first call: set_plan(steps)
        │  · then per step: update_step(index, status)
        │  · uses base chat tools + your module's tools
        │  · finishes with a text summary
        ▼
persisted <project>/.data/modules/<runId>.json  → viewable in Modules tab + chat card
```

Key rules enforced by the runner (`src/main/modules/runner.ts`):

- The **first** tool call must be `set_plan` (2–10 steps). If the model tries to skip it, the framework returns a tool error so the model self-corrects.
- Every planned step goes through `update_step` with a 1-based index. A step is marked `running` when started and `done`/`failed` when finished (with optional `detail`).
- The subagent gets **all base chat tools** (`create_note`, `list_notes`, `read_note`, `search_notes`, `update_note`, `create_todos`, `toggle_todo`, `list_todos`, `read_file`, `web_search`, `web_fetch`) **plus** the module's own tools (`module.tools`), **plus** the framework tools (`set_plan`, `update_step`).
- Destructive base tools (e.g. `delete_note`) run with `confirm: () => false`, i.e. auto-reject. Modules shouldn't perform destructive actions.
- The `ToolContext.activeProject` is the project the run was started in; module tools default to it.
- The module should eventually produce a real output file and return it from one of its tools **as JSON**:
  ```json
  { "ok": true, "path": "/abs/path/to/file.pptx", "file": "file.pptx" }
  ```
  The runner captures this as the run's `outputFile` (used by the reveal / clear-history / summary features). `ok:false` plus an `error` field is treated as a tool failure.
- A tool can produce **multiple deliverables** in one call by adding a `files` array alongside `path`/`file`:
  ```json
  { "ok": true, "path": "/abs/path/to/a.svg", "file": "a.svg", "files": ["/abs/path/to/a.svg", "/abs/path/to/a.png"] }
  ```
  Every entry lands in the run's `outputFiles` (the card shows one 📄 reveal pill per file; the first entry is the primary `outputFile`). `clearHistory`/`deleteRun` with the "delete output files" option removes all of them.

## Module interface

Every module is a `RegisteredModule` (`src/main/modules/types.ts`):

```ts
interface RegisteredModule {
  id: string // stable machine id, e.g. 'pptx' — used as start_module's `id` arg
  name: string // human-readable name, e.g. 'PowerPoint (PPTX)'
  summary: string // one-line UI summary
  description: string // LONG prompt shown to the main agent describing when/how to use this module
  systemPrompt: string // extra guidance injected into the module subagent's system prompt
  tools: PTTool[] // module-specific tools (PTTool from src/main/ai/tools.ts)
}
```

### `id`

Stable slug, never changes once shipped. If you change an id, existing run history becomes orphaned, so keep it stable.

### `description` (for the main agent)

This text is embedded verbatim into the `start_module` tool description presented to the **main** chat agent. Write it so the main agent knows:

- when it should use this module (keywords / user intents),
- what kind of **detailed prompt** it must author (goal, audience, outline/spec, `note:<name>` / `file:<name>` references),
- roughly what the subagent will do.

Be concrete and thorough — the main agent uses this to write the one-shot prompt that drives the whole run.

### `systemPrompt` (for the subagent)

Appended to the subagent's system prompt. Guide the domain-specific behavior here: output structure, layout/style rules, tool usage order, edge cases. Do **not** restate the mandatory `set_plan`/`update_step` workflow — that is added by `buildSystemPrompt` in `runner.ts`.

## Writing module tools

Tools follow the exact same `PTTool` shape as the base tools:

```ts
interface PTTool {
  definition: {
    type: 'function'
    function: {
      name: string
      description: string
      parameters: Record<string, unknown> // JSON-Schema-ish
    }
  }
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
}
```

Contract for `execute`:

- It MUST return a **JSON string**.
- Success shape (recommended): `{ ok: true, ...extra, path, file }` where `path` = absolute output path and `file` = the file name (used for display).
- Failure shape: `{ ok: false, error: '<message>' }` — the message is surfaced (bolded) as a tool error so the model can adapt.
- Parse `args` defensively. When the subagent passes a JSON blob inside a string field, `JSON.parse` it. Prefer short parameter descriptions; the model relies on them.

### Writing output files

- The output must land in the **project files** area so the file picker (`#`), `reveal`, and `create`/history can reuse it. Use the helper on the service:
  ```ts
  const outPath = await ctx.service.uniqueOutputPath(project, `${suggested}.pptx`)
  ```
  `uniqueOutputPath` slugifies the stem, rejects empty/unsafe names, and dedupes with `-2`, `-3`, … under the same `files/` folder.
- Clean up the file on a failed build before returning the error JSON (see the PPTX tool for the pattern: build → on error `unlink` + return `{ ok:false }`).

### Reusing shared tools

`src/main/modules/shared/createLucideIconTools.ts` exports a ready-made tool-pack any module can
opt into — no core/framework changes needed (the runner merges `module.tools`) and no duplication:

```ts
import { createLucideIconTools } from '../shared/createLucideIconTools'

// Module that works with icons:
tools: [...createLucideIconTools(), createSomeFileTool()]
```

It provides `search_lucide_icons` (keyword → canonical icon names + tags) and `get_lucide_icon`
(name → SVG string or PNG data URI). The backing library `src/main/modules/shared/lucideIcons.ts`
is format-agnostic: builders can call `getLucideIconSvg(...)` to embed SVG directly, or
`lucideIconPngDataUri(...)` for a raster (the PPTX builder embeds icons as PNG so they render
reliably in any slide viewer). Add `lucide-static` and `@resvg/resvg-js` to your module's deps
when you use it.

`src/main/modules/shared/createChartTools.ts` exports a chart tool-pack for data-visualization
modules:

```ts
import { createChartTools } from '../shared/createChartTools'

// Module that renders data charts:
tools: [...createChartTools(), createSomeFileTool()]
```

It provides `chart_preview` (dry-run, writes nothing) and `render_chart` (writes
temporary `<project>/.data/modules/temp/<slug>.png` + `.json` and returns the asset paths; the temp files
are deleted automatically once a deck using them is built). Charts are drawn by `chart.js`
(Chart.js-style config JSON: `{ type, data: { labels?, datasets }, options?, width?, height? }`)
onto `@napi-rs/canvas` (prebuilt Node-API Skia binding — same no-rebuild packaging pattern as
`@resvg/resvg-js`), isolated in an Electron utility process so a native crash can't take the app
down. Add `chart.js` and `@napi-rs/canvas` to your module's deps, and make sure the
app's `electron-builder.yml` `asarUnpack` includes `**/node_modules/@napi-rs/**`.

The backing library `src/main/modules/shared/chart.ts` is format-agnostic too: `validateChart(raw)`
normalizes/limits a design and `renderChartPng(design, size)` returns a PNG buffer, so a builder
can render charts without going through the AI tool surface at all.

`src/main/modules/shared/createDiagramTools.ts` exports a diagram tool-pack for flow/process
modules:

```ts
import { createDiagramTools } from '../shared/createDiagramTools'

// Module that renders flow / sequence / relationship diagrams:
tools: [...createDiagramTools(), createSomeFileTool()]
```

It provides `diagram_preview` (dry-run, writes nothing) and `render_diagram` (writes temporary
`<project>/.data/modules/temp/<slug>.png` + `.svg` + `.json` and returns the asset paths; the temp files
are deleted automatically once a deck using them is built). Diagrams are authored as **mermaid DSL
source text** (`flowchart TD/LR`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`, `erDiagram`,
`pie`, `gantt`) and rendered by mermaid v11 on a jsdom/svgdom DOM shim (`isomorphic-mermaid`; no headless
browser) in an isolated Electron utility process, rasterized by `@resvg/resvg-js`. Add
`isomorphic-mermaid` to your module's deps. The backing library `src/main/modules/shared/mermaid.ts`
is format-agnostic too: `validateMermaid(src)`, `renderMermaidSvg(src)`, `svgBounds(svg)` and
`svgToPng(svg, width)` let a builder render diagrams without the AI tool surface.

`src/main/modules/shared/createInfographicTools.ts` exports an infographic tool-pack for
one-pager/visual-report modules:

```ts
import { createInfographicTools } from '../shared/createInfographicTools'

// Module that renders infographics:
tools: [...createInfographicTools(), createSomeFileTool()]
```

It provides `list_infographic_templates` (the ~276 built-in catalog, filterable by
category/query, with per-category data-shape hints), `infographic_preview` (dry-run, writes
nothing) and `render_infographic` (writes temporary `<project>/.data/modules/temp/<slug>.png` +
`.svg` + `.json` and returns the asset paths; the temp files are deleted automatically once a
deck using them is built). Designs are authored as **@antv/infographic DSL text** (an
`infographic <template>` first line followed by `data` / `design` / `theme` blocks) or a JSON
`{ template, data, ... }` object, rendered by the package's node SSR entry
(`@antv/infographic/ssr` → `renderToString` on a `linkedom` DOM shim; no network — `icon` /
`illus` fields are stripped offline) in an isolated Electron utility process, rasterized by
`@resvg/resvg-js`. Add `@antv/infographic` to your module's deps. The backing library
`src/main/modules/shared/infographic.ts` is format-agnostic too: `parseInfographicDesign(raw)`,
`validateInfographicDesign(parsed)`, `renderInfographicSvg(parsed)`, `svgBounds(svg)` and
`svgToPng(svg, width)` let a builder render infographics without the AI tool surface.

## Registering the module

Registration happens only in **`src/main/index.ts`**:

```ts
const moduleRegistry = new ModuleRegistry()
moduleRegistry.register(createPptxModule()) // ← add yours here
moduleRegistry.register(createMyModule())
```

The main agent's `start_module` tool description is auto-generated from `registry.list()`, so **no other core code needs to change**.

## Recommended module folder layout

Mirror the pptx module:

```
src/main/modules/<id>/
├── index.ts      # create<Name>Module(): builds the RegisteredModule (description/systemPrompt/tools)
└── <builder>.ts  # pure "document builder"; JSON design → real file on disk
```

Keep the builder pure and deterministic so it is unit-testable without an LLM. The tool's `execute` handles only the AI-facing glue (parsing args, picking paths, dedupe).

## Testing

Add a scripted test wired into `npm run test`. See `scripts/test-modules.mts` for the established pattern:

1. **Builder unit test** — construct your design JSON, assert the resulting file exists / parses, size > 0, and that invalid designs return `{ ok: false, error }`.
2. **Full run simulation** — use a `fakeClientFactory` that replays a scripted sequence of completions:
   `set_plan` → `update_step` (running/done) ×N → your create tool → final text.
   Drive `ModuleRunManager.start()` and assert: `run.status === 'done'`, every step `done`, `outputFile` captured, the run JSON persisted under `<project>/modules/`, and the expected event types (`step`, `output`, `done`) broadcast.
3. **Manager edge cases** — unknown module, empty title/prompt → `{ ok: false }`; `clearHistory` removes just-finished runs.

`npm run test` runs `scripts/test-modules.mts` last.

## UI notes (no changes required)

The Modules tab and the chat card are **generic** — they render whatever the framework emits:

- Steps appear as a list with `✔` (done), `…` (running), `✕` (failed), `·` (pending).
- Progress bar reflects `done + failed` / total steps.
- A run's `summary` (set by the subagent's final text) and its output files (one 📄 reveal pill per file in `outputFiles`, falling back to `outputFile`) show in the expanded action area (click the card to toggle).
- `detail` on any step shows as collapsible text under that step.

If you need UI to differ per module, extend `ModuleCard`/the `ModuleEvent` shape — but prefer keeping the module logic backend-only.

## Checklist — building a new module

1. [ ] Folder `src/main/modules/<id>/` with `index.ts` (+ builder if producing a binary/text file).
2. [ ] `RegisteredModule` with stable `id`, accurate `description`, domain `systemPrompt`, and typed `tools`.
3. [ ] Each tool returns proper `{ ok, ... }` / `{ ok: false, error }` JSON.
4. [ ] Output written via `ctx.service.uniqueOutputPath(project, name)` (or another files-in-project path) and surfaced as `{ path, file }`.
5. [ ] Registered in `src/main/index.ts` via `moduleRegistry.register(...)`.
6. [ ] Builder unit tests + scripted full-run test in `scripts/test-modules.mts`.
7. [ ] `npm run typecheck` and `npm run lint` pass.

```

```
