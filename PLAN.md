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

## Goal 2: In-process graph toolset for PPTX embedding

### Goal

Give the **pptx** module the ability to render a graph (diagram / knowledge map) and place it on a slide as a rasterized PNG picture. Graph rendering is **pure in-process**: no external API calls, no CLI `exec`/`spawn`, no headless browser/apps. Layout math + SVG emission happen in TS; PNG rasterization uses `@resvg/resvg-js` (already a dependency); output files are written through the existing `PTNotesService` fs helpers. Built as a **shared tool-pack** (`createGraphTools()`) that the pptx module opts into — no core/framework changes required (the runner already merges `module.tools`).

### Decisions (locked in)

| Decision | Choice |
| --- | --- |
| Graph kind | Model-authored diagram only (subagent passes a graph JSON design, like `create_pptx_file`) |
| Deliverables | `<project>/files/<slug>.svg`, `.png`, and `.json` (raw graph + computed positions + metadata) |
| Embedding | Rasterized PNG picture on the slide via `slide.addImage({ path })` (PowerPoint-reliable; the Goal 1 SVG-in-PowerPoint 2016+ caveat does not apply) |
| Layouts | `hierarchy` (tree — levels by longest path from roots) and `layered` (DAG layering, graceful cycle fallback); `top-down` / `left-to-right` |
| Node icons | Optional per-node `icon` (Lucide canonical name) inlined into the SVG via the existing `getLucideIconSvg` shared util |
| Sharing | Opt-in composition: `createGraphTools(): PTTool[]` in `src/main/modules/shared/`; the pptx module merges it into its own `tools` |
| Not chosen | Separate `graph` module (user asked to keep the toolset inside the PPTX module); external data sources / CLI layout engines (graphviz) / headless rendering |
| Tool surface | `graph_layout` (dry-run preview, writes nothing) **and** `render_graph` (renders SVG + PNG + JSON, returns the PNG path for slide embedding) |
| Run `outputFile` | `render_graph` deliberately omits the `{ path, file }` pair the runner's `captureOutput` watches, so a pptx run's `outputFile` is the final `.pptx`, not the intermediate graph PNG |

### Dependencies

- None new. Reuses `@resvg/resvg-js` (already unpacked for Goal 1) and `getLucideIconSvg` from `src/main/modules/shared/lucideIcons.ts`.

### Files

#### New: `src/main/modules/shared/graph.ts`
Framework-agnostic graph engine (pure, no I/O):

- Types: `GraphNode { id, label?, color?, shape?('box'|'ellipse'), icon?, width?, height? }`, `GraphEdge { source, target, label?, dashed? }`, `GraphDesign { title?, layout?('hierarchy'|'layered'), direction?('top-down'|'left-to-right'), nodes, edges? }`, resolved layout (per-node coordinates + bounding box + edge paths).
- `validateGraph(design)` — unique non-empty node ids; ≤ 200 nodes; edges reference existing nodes; ≤ 500 edges; label/title length caps.
- `layoutHierarchy` / `layoutLayered` — deterministic in-process layout (longest-path levels, no-crossing ordering; layered degrades gracefully on cycles).
- Node sizing approximated from label length (no external text measurement); optional `icon` inlined via `getLucideIconSvg`.
- `renderGraphSvg(layout)` → SVG string (arrow markers, box/ellipse nodes, curved edges, labels, theme colors); `renderGraphPng(svg, widthPx)` → PNG buffer via `Resvg` (same pattern as `lucideIcons`).

#### New: `src/main/modules/shared/createGraphTools.ts`
`createGraphTools(): PTTool[]`:

- `graph_layout` (`{ graph, layout?, direction? }`) → `{ ok: true, nodeCount, edgeCount, width, height, nodes: [{ id, x, y }] }` — preview only, no file write.
- `render_graph` (`{ graph, layout?, direction?, filename?, pixelWidth? }`) → validates, lays out, writes `<project>/files/<slug>.svg` + `.png` + `.json` via `service.uniqueOutputPath`, returns `{ ok: true, png, svg, json, width, height, nodeCount, edgeCount }`. No `path`/`file` fields on purpose (see `outputFile` decision).
- Tool descriptions state local/in-process only so the model does not attempt external renderers.

#### Edit: `src/main/modules/pptx/builder.ts`
- Add `'graph'` to `SlideLayout`; `PptxGraphSpec { png?: string; x?; y?; w?; h? }`; `PptxSlideSpec.graph?`.
- New `graph` layout case: `slide.addImage({ path: png, x, y, w, h, altText })` with greedy default centered fill of the body area (title header on top). Missing `png` file → `{ ok: false, error: '…' }` so the subagent self-corrects.

#### Edit: `src/main/modules/pptx/index.ts`
- `tools: [...createGraphTools(), ...createLucideIconTools(), createPptxFileTool]`.
- `DESIGN_SCHEMA` documents `layout: "graph"` + `graph: { png, x?, y?, w?, h? }`.
- `systemPrompt`: instruct the subagent — build the graph JSON, call `graph_layout` to preview, call `render_graph` to get the PNG path, then set the slide `graph` field with that path; remind that rendering is local-only (no network/CLI/headless).

### Verification

```bash
npm run typecheck
npm run lint
npm run test
```

---

## Goal 3: Diagram / data flow toolset for PPTX embedding (separate toolset, shared engine)

### Goal

Give the **pptx** module the ability to render **flow / data flow diagrams** (process boxes, decision diamonds, start/end stadiums, I/O parallelograms, orthogonal connectors) and place them on a slide as a rasterized PNG picture — while **Goal 2's node–edge graph toolset stays untouched**. The diagram capability is a **second shared tool-pack** (`createDiagramTools()`) built **on top of the same shared graph engine** (`graph.ts`) so validation, layout, SVG emission and PNG rasterization are not duplicated. Still **pure in-process**: no external API, no CLI `exec`/`spawn`, no headless browser/apps.

### Decisions (locked in)

| Decision | Choice |
| --- | --- |
| Toolset relation | New toolset, shared engine: `createDiagramTools()` reuses the `graph.ts` validation/layout/SVG/PNG guts; Goal 2's `graph_layout`/`render_graph` surface is unchanged |
| Shapes | `process` (rectangle), `decision` (diamond), `stadium` (start/end pill), `io` (parallelogram); node auto-sizes from label length; optional Lucide `icon` per node |
| Edge routing | **Orthogonal (elbow/right-angle) connectors** with arrowheads by default; curved Béziers remain the graph toolset default |
| Layouts | New `flow` layout (longest-path linear chain, branch/merge ordering, back-edge loop) plus reuse of `hierarchy`/`layered`; `top-down` / `left-to-right` |
| Deliverables | `<project>/files/<slug>.svg`, `.png`, `.json` (same scheme as Goal 2) |
| Embedding | Rasterized PNG picture on the slide via `slide.addImage({ path })`; the pptx module opts into both toolsets |
| Sharing | Opt-in composition: `createDiagramTools(): PTTool[]` in `src/main/modules/shared/`; pptx module merges it into its own `tools` |
| Not chosen | Merging diagram features into Goal 2's toolset (keeps `render_graph` focused); external layout engines (graphviz) / headless rendering |

### Dependencies

- None new. Reuses `@resvg/resvg-js` and the Goal 2 engine helpers.

### Files

#### Edit: `src/main/modules/shared/graph.ts`
Backward-compatible extensions (Goal 2 unchanged):

- `shape` gains `process | decision | stadium | io` alongside `box`/`ellipse`.
- Rendering primitives for polygon (diamond), stadium (pills), parallelogram (I/O).
- Orthogonal (elbow) edge path generator (diagram-mode default); Goal 2's curved Béziers stay the default for `render_graph`.
- New `flow` layout: longest-path ranking from sources, ordered branches/merges, and a back-edge pass to route loops.
- Re-exported entry points so `createDiagramTools` composes without touching `createGraphTools`.

#### New: `src/main/modules/shared/createDiagramTools.ts`
`createDiagramTools(): PTTool[]`:

- `diagram_layout` (`{ diagram, layout?: 'flow'|'hierarchy'|'layered', direction? }`) → dry-run preview: `{ ok, nodeCount, edgeCount, width, height, nodes: [{ id, shape, x, y }] }`.
- `render_diagram` (`{ diagram, layout?, direction?, filename?, pixelWidth? }`) → renders `<project>/files/<slug>.svg` + `.png` + `.json` via `service.uniqueOutputPath`, returns `{ ok, png, svg, json, width, height, nodeCount, edgeCount }` and deliberately omits the `{ path, file }` pair so a pptx run keeps `outputFile` = final `.pptx`.
- Tool docs state local/in-process only (no network, CLI, headless).

#### Edit: `src/main/modules/pptx/builder.ts`
- Add `'diagram'` to `SlideLayout` (second picture-slot layout alongside `graph`), `PptGraphSpec`-style `slide.diagram: { png?, x?, y?, w?, h? }`, and a `diagram` case: `slide.addImage({ path, x, y, w, h, altText })` with a greedy centered body fill; missing file → clear `{ ok: false, error }`.

#### Edit: `src/main/modules/pptx/index.ts`
- `tools: [...createGraphTools(), ...createDiagramTools(), ...createLucideIconTools(), createPptxFileTool]`.
- `DESIGN_SCHEMA` documents `layout: "diagram"` + `diagram: { png, x?, y?, w?, h? }`.
- `systemPrompt`: for flow/process content instruct the subagent — author the diagram JSON, `diagram_layout` to preview, `render_diagram` for the PNG path, then set the slide `diagram` field; remind local-only rendering.

### Verification

```bash
npm run typecheck
npm run lint
npm run test
```
