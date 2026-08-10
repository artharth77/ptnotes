# PLAN

## Goal 1: Shared Lucide icon tools + PPTX embedding

### Goal

Give the **pptx** module the ability to search the Lucide icon library and load icons into generated `.pptx` slides. Because future modules will want the same capability, the icon functionality is built as a **shared tool-pack** any module can opt into — no core/framework changes required (the runner already merges `module.tools` at `src/main/modules/runner.ts:110`).

### Decisions (locked in)

| Decision | Choice |
| --- | --- |
| Icon source | `lucide-static` (3500+ icons as SVG strings, PascalCase exports) + `tags.json` keyword index |
| Embedding | Rasterize SVG → PNG in the main process via `@resvg/resvg-js`, embed via `slide.addImage` (PptxGenJS cannot rasterize SVG in Node — its PNG fallback preview is broken, so raw-SVG embedding only renders in PowerPoint 2016+) |
| Sharing | Opt-in composition: `createLucideIconTools(): PTTool[]` in `src/main/modules/shared/`; each module merges it into its own `tools` |
| Not chosen | Injecting icon tools into `baseTools` (would force icons on the main chat + every module, tool-creep per AGENTS.md) |
| Tool surface | `search_lucide_icons` (keyword → names/tags) **and** `get_lucide_icon` (name → SVG string or PNG data URI) |
| Icon placement (pptx) | `section`/`statement`: big centered icon above text; `title`: small centered icon below subtitle; other layouts: top-right icon with header title width shrunk |

### Dependencies

- `lucide-static` ^1.30.0
- `@resvg/resvg-js` ^2.6.2 (N-API prebuilt binaries; works in Electron main and the plain-Node tsx test runner; no rebuild needed since `electron-builder.yml` has `npmRebuild: false`)

### Packaging

- `electron-builder.yml` → `asarUnpack`: append `**/node_modules/@resvg/**` so the native `.node` loads in the packaged app.

### Files

#### New: `src/main/modules/shared/lucideIcons.ts`
Framework-agnostic icon library used by any module or builder:

- `loadCatalog()` — lazy-loads `tags.json` via `fs.readFileSync(require.resolve('lucide-static/tags.json'))` (avoids `resolveJsonModule`), falling back to name-only matching if the read fails. Maps kebab-name → PascalCase export.
- `searchLucideIcons(query, limit = 20)` → `{ name, tags }[]`, scoring icon names + tags.
- `getLucideIconSvg(name, color)` → SVG string with `stroke="currentColor"` replaced by `stroke="#hex"` (resvg does not resolve `currentColor`), `fill="none"` kept.
- `lucideIconPngDataUri(name, { color, sizePx = 256 })` → async; `Resvg.render().asPng()` → `data:image/png;base64,...`.
- Unknown names → `{ ok: false, error }` so modules surface the error to the model.

#### New: `src/main/modules/shared/createLucideIconTools.ts`
`createLucideIconTools(): PTTool[]`:

- `search_lucide_icons` (`{ query, limit? }`) → `{ ok: true, query, results: [{ name, tags }] }`.
- `get_lucide_icon` (`{ name, format: 'svg' | 'png', color?, sizePx? }`) → `{ ok: true, name, svg? | png?, tags }`. Tool docs: prefer `svg` unless the module needs pixels (SVG ~1KB vs heavier PNG base64 in model context).

#### Edit: `src/main/modules/pptx/index.ts`
- `tools: [...createLucideIconTools(), createPptxFileTool()]`.
- `DESIGN_SCHEMA` documents per-slide `icon`: `{ name, size?, x?, y?, color? }` or a bare `"rocket"` string.
- `systemPrompt`: instruct the subagent to call `search_lucide_icons` for section/statement/title slides and include `icon` in the slide JSON.

#### Edit: `src/main/modules/pptx/builder.ts`
- `PptxSlideSpec.icon`.
- Resolve each slide icon to a PNG data URI (shared helper) before `writeFile`; `placeIcon()` per layout (see placement decisions above).
- Unknown icon name → `{ ok: false, error: 'Unknown icon "<name>". Use search_lucide_icons…' }` so the subagent self-corrects.

#### Edit: `scripts/test-modules.mts`
- Shared-layer units: `searchLucideIcons('chart')` matches; `getLucideIconSvg('rocket')` yields an SVG with the injected stroke color; PNG data URI has PNG magic bytes.
- Builder: slide with `icon: 'trending-up'` builds with the correct `slideCount`; unknown icon → `{ ok: false }`.

#### Edit: `docs/module-development.md`
- New "Shared tools" section: reuse `createLucideIconTools` so future modules get search/get icons with zero framework changes (runner already merges `module.tools`).

### Future module reuse

```ts
// Any module:
tools: [...createLucideIconTools(), createSomeFileTool()]
```

Consumers get the SVG via `getLucideIconSvg(...)` or a PNG data URI via `lucideIconPngDataUri(...)` — the shared layer is format-agnostic, so a future HTML/report module can embed SVG directly.

### Verification

```bash
npm run typecheck
npm run lint
npm run test
```

---

## Goal 2: In-process chart toolset for PPTX embedding

### Goal

Give the **pptx** module the ability to render a **data chart** (bar, line, pie, doughnut, radar, polar area, scatter, bubble) and place it on a slide as a rasterized PNG picture. Chart rendering is **pure in-process**: no external API calls, no CLI `exec`/`spawn`, no headless browser/apps. The chart is drawn by **Chart.js** (pure JS) onto a Skia canvas via **`@napi-rs/canvas`** (prebuilt N-API native, zero system dependencies — the same packaging pattern as `@resvg/resvg-js`); PNG bytes are written through the existing `PTNotesService` fs helpers. Built as a **shared tool-pack** (`createChartTools()`) that the pptx module opts into — no core/framework changes required (the runner already merges `module.tools`).

> This **replaces** the original Goal 2 "node–edge graph (diagram / knowledge map)" toolset. In practice the LLM reached for the graph tool to draw *data charts*, but the hand-rolled hierarchy/layered node-layout engine produced diagrams, not charts — so the toolset was renamed (`graph` → `chart`) and rebuilt around Chart.js, which owns all axis/scale/layout math itself. The old `graph.ts` / `createGraphTools.ts` files are deleted; **Goal 3 is re-baselined accordingly** (see note there).

### Decisions (locked in)

| Decision | Choice |
| --- | --- |
| Chart kind | Model-authored Chart.js-style design JSON (subagent passes `{ type, data: { labels?, datasets }, options?, width?, height? }`, like `create_pptx_file`) |
| Renderer | `chart.js` ^4 (pure JS, ~50 KB) drawn onto `@napi-rs/canvas` ^1 (Skia via Node-API, prebuilt binaries; works in Electron main and the plain-Node tsx test runner — no electron-rebuild needed since `electron-builder.yml` has `npmRebuild: false`) |
| Not chosen | `chartjs-node-canvas`, whose dependency is the native `canvas` (node-canvas) addon — requires rebuilding against Electron's ABI plus system libs (cairo/pango), breaking the prebuilt-N-API-only packaging invariant |
| Chart types | `bar`, `line`, `pie`, `doughnut`, `radar`, `polarArea`, `scatter`, `bubble` |
| Deliverables | `<project>/files/<slug>.png` + `.json` (chart type, dims, dataset/point counts). No `.svg` — Chart.js rasterizes to pixels only, and the pptx slide only consumes the PNG |
| Embedding | Rasterized PNG picture on the slide via `slide.addImage({ path })` (PowerPoint-reliable) |
| Canvas sizing | `width`/`height` in the chart JSON (px, default 1200×675 to match 16:9), clamped 120–4000 |
| Sharing | Opt-in composition: `createChartTools(): PTTool[]` in `src/main/modules/shared/`; the pptx module merges it into its own `tools` |
| Tool surface | `chart_preview` (in-memory dry run, writes nothing) **and** `render_chart` (renders PNG + JSON, returns the PNG path for slide embedding) |
| Run `outputFile` | `render_chart` deliberately omits the `{ path, file }` pair the runner's `captureOutput` watches, so a pptx run's `outputFile` is the final `.pptx`, not the intermediate chart PNG |

### Dependencies

- `chart.js` ^4.4.0 (runtime)
- `@napi-rs/canvas` ^1.0.0 (runtime; prebuilt Node-API ≥ 8 binary, no rebuild needed since `electron-builder.yml` has `npmRebuild: false`)

### Packaging

- `electron-builder.yml` → `asarUnpack`: append `**/node_modules/@napi-rs/**` so the native `.node` loads in the packaged app (same handling as `@resvg`).

### Files

#### New: `src/main/modules/shared/chart.ts`
Framework-agnostic chart engine (pure, no I/O):

- Types: `ChartType` (`'bar' | 'line' | 'pie' | 'doughnut' | 'radar' | 'polarArea' | 'scatter' | 'bubble'`), `ChartDataset { label?, data: (number | {x,y} | {x,y,r})[], color?, ... }`, `ChartDesign { type, data: { labels?, datasets }, options?, width?, height? }`.
- `validateChart(raw)` — known chart type; non-empty `datasets`; ≤ 10 datasets; ≤ 500 points/dataset (≤ 50 for pie/doughnut/polarArea); data entries numeric (scatter/bubble use `{x,y}` / `{x,y,r}` object form); `width`/`height` clamped 120–4000.
- `renderChartPng(design, { width?, height? }) → Buffer` — `createCanvas` → `getContext('2d')` → `new Chart(ctx, { ...data, options: { responsive:false, animation:false, devicePixelRatio:1, ...options } })` → `canvas.toBuffer('image/png')` → `chart.destroy()`. Throws on failure — the tool surfaces the error to the model.

#### New: `src/main/modules/shared/createChartTools.ts`
`createChartTools(): PTTool[]`:

- `chart_preview` (`{ chart }`) → `{ ok: true, chartType, width, height, datasetCount, pointCount }` — dry-run preview only, no file write.
- `render_chart` (`{ chart, filename?, outWidth?, outHeight? }`) → validates, renders, writes `<project>/files/<slug>.png` + `.json` via `service.uniqueOutputPath`, returns `{ ok: true, png, json, chartType, width, height, datasetCount, pointCount }`. No `path`/`file` fields on purpose (see `outputFile` decision).
- Tool descriptions list the 8 chart types and state local/in-process only so the model does not attempt external renderers.

Example subagent flow:

```ts
// 1. preview (no files written)
chart_preview({ chart: { type: 'bar', data: { labels: ['Q1','Q2','Q3'], datasets: [{ label: 'Sales', data: [4, 7, 3] }] } } })
// → { ok: true, chartType: 'bar', width: 1200, height: 675, datasetCount: 1, pointCount: 3 }

// 2. render (writes revenue-chart.png + .json)
render_chart({ chart: { type: 'pie', data: { labels: ['A','B','C'], datasets: [{ data: [3, 5, 2] }] } }, filename: 'revenue-chart' })
// → { ok: true, png: '/abs/<project>/files/revenue-chart.png', json: '/abs/<project>/files/revenue-chart.json', chartType: 'pie', width: 1200, height: 675, datasetCount: 1, pointCount: 3 }
```

#### Edit: `src/main/modules/pptx/builder.ts`
- Replace `'graph'` with `'chart'` in `SlideLayout`; `PptxGraphSpec` → `PptxChartSpec { png?: string; x?; y?; w?; h? }`; `PptxSlideSpec.graph?` → `.chart?`.
- `parseGraphSpec` → `parseChartSpec`; new `chart` layout case: `slide.addImage({ path: png, x, y, w, h, altText })` with greedy default centered fill of the body area (title header on top). Missing `png` file → `{ ok: false, error: '…' }` so the subagent self-corrects.

#### Edit: `src/main/modules/pptx/index.ts`
- `tools: [...createChartTools(), ...createLucideIconTools(), createPptxFileTool]`.
- `DESIGN_SCHEMA` documents `layout: "chart"` + `chart: { png, x?, y?, w?, h? }`.
- `systemPrompt`: for data/comparison content instruct the subagent — author the Chart.js chart JSON (type, labels, datasets), call `chart_preview` to sanity-check, call `render_chart` to get the PNG path, then set the slide `chart` field with that path; remind that rendering is local-only (no network/CLI/headless).

#### Edit: `scripts/test-modules.mts`
- Shared-layer units: `validateChart` accepts valid bar/line/pie and rejects unknown types / empty datasets / oversize point counts; `renderChartPng` for bar + pie yields PNG magic bytes.
- Tools: `chart_preview` returns dims + counts without writing; `render_chart` writes `.png` + `.json`, returns the `png` path, omits `path`/`file`, rejects invalid charts.
- Builder: slide with `layout: 'chart'` + the rendered PNG builds; missing/relative png → `{ ok: false }`.

#### Edit: `docs/module-development.md`
- "Shared tools" section entry: reuse `createChartTools` (`chart.js` + `@napi-rs/canvas` deps) so future modules get preview/render charts with zero framework changes.

### Verification

```bash
npm run typecheck
npm run lint
npm run test
```

---

## Goal 3: Diagram / data flow toolset for PPTX embedding (separate toolset, shared engine)

> **Note (re-baselined):** This section originally built on Goal 2's `graph.ts` node–edge engine. Goal 2 was since rebuilt as the Chart.js **chart** toolset and the node–edge engine was removed. When Goal 3 starts, the shared engine (validation / layout / SVG / PNG) must either be **restored from git history** (the deleted `src/main/modules/shared/graph.ts`) or rebuilt from scratch — the surface contract below (`createDiagramTools()`, `flow`/`hierarchy`/`layered` layouts, orthogonal edge routing, `.svg` + `.png` + `.json` deliverables) is otherwise unchanged, and the chart toolset stays untouched.

### Goal

Give the **pptx** module the ability to render **flow / data flow diagrams** (process boxes, decision diamonds, start/end stadiums, I/O parallelograms, orthogonal connectors) and place them on a slide as a rasterized PNG picture — a **second shared tool-pack** (`createDiagramTools()`) distinct from Goal 2's chart toolset. Built on a shared node–edge engine so validation, layout, SVG emission and PNG rasterization are not duplicated. Still **pure in-process**: no external API, no CLI `exec`/`spawn`, no headless browser/apps.

### Decisions (locked in)

| Decision | Choice |
| --- | --- |
| Toolset relation | New toolset, shared engine: `createDiagramTools()` reuses the restored node–edge engine's validation/layout/SVG/PNG guts; the Goal 2 `chart_preview`/`render_chart` chart toolset is untouched |
| Shapes | `process` (rectangle), `decision` (diamond), `stadium` (start/end pill), `io` (parallelogram); node auto-sizes from label length; optional Lucide `icon` per node |
| Edge routing | **Orthogonal (elbow/right-angle) connectors** with arrowheads by default; curved Béziers remain the diagram engine's default |
| Layouts | New `flow` layout (longest-path linear chain, branch/merge ordering, back-edge loop) plus reuse of `hierarchy`/`layered`; `top-down` / `left-to-right` |
| Deliverables | `<project>/files/<slug>.svg`, `.png`, `.json` (same scheme as the old Goal 2) |
| Embedding | Rasterized PNG picture on the slide via `slide.addImage({ path })`; the pptx module opts into both toolsets |
| Sharing | Opt-in composition: `createDiagramTools(): PTTool[]` in `src/main/modules/shared/`; pptx module merges it into its own `tools` |
| Not chosen | Merging diagram features into Goal 2's chart toolset (keeps `render_diagram` focused); external layout engines (graphviz) / headless rendering |

### Dependencies

- None new. Reuses `@resvg/resvg-js` and the restored node–edge engine helpers.

### Files

#### Edit: `src/main/modules/shared/graph.ts`
Backward-compatible extensions (the Goal 2 chart toolset is untouched):

- `shape` gains `process | decision | stadium | io` alongside `box`/`ellipse`.
- Rendering primitives for polygon (diamond), stadium (pills), parallelogram (I/O).
- Orthogonal (elbow) edge path generator (diagram-mode default); curved Béziers stay the default for `render_diagram`.
- New `flow` layout: longest-path ranking from sources, ordered branches/merges, and a back-edge pass to route loops.
- Re-exported entry points so `createDiagramTools` composes without any coupling to the Goal 2 chart toolset.

#### New: `src/main/modules/shared/createDiagramTools.ts`
`createDiagramTools(): PTTool[]`:

- `diagram_layout` (`{ diagram, layout?: 'flow'|'hierarchy'|'layered', direction? }`) → dry-run preview: `{ ok, nodeCount, edgeCount, width, height, nodes: [{ id, shape, x, y }] }`.
- `render_diagram` (`{ diagram, layout?, direction?, filename?, pixelWidth? }`) → renders `<project>/files/<slug>.svg` + `.png` + `.json` via `service.uniqueOutputPath`, returns `{ ok, png, svg, json, width, height, nodeCount, edgeCount }` and deliberately omits the `{ path, file }` pair so a pptx run keeps `outputFile` = final `.pptx`.
- Tool docs state local/in-process only (no network, CLI, headless).

#### Edit: `src/main/modules/pptx/builder.ts`
- Add `'diagram'` to `SlideLayout` (second picture-slot layout alongside `chart`), `PptxChartSpec`-style `slide.diagram: { png?, x?, y?, w?, h? }`, and a `diagram` case: `slide.addImage({ path, x, y, w, h, altText })` with a greedy centered body fill; missing file → clear `{ ok: false, error }`.

#### Edit: `src/main/modules/pptx/index.ts`
- `tools: [...createChartTools(), ...createDiagramTools(), ...createLucideIconTools(), createPptxFileTool]`.
- `DESIGN_SCHEMA` documents `layout: "diagram"` + `diagram: { png, x?, y?, w?, h? }`.
- `systemPrompt`: for flow/process content instruct the subagent — author the diagram JSON, `diagram_layout` to preview, `render_diagram` for the PNG path, then set the slide `diagram` field; remind local-only rendering.

### Verification

```bash
npm run typecheck
npm run lint
npm run test
```
