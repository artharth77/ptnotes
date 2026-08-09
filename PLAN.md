# PLAN: Shared Lucide icon tools + PPTX embedding

## Goal

Give the **pptx** module the ability to search the Lucide icon library and load icons into generated `.pptx` slides. Because future modules will want the same capability, the icon functionality is built as a **shared tool-pack** any module can opt into — no core/framework changes required (the runner already merges `module.tools` at `src/main/modules/runner.ts:140`).

## Decisions (locked in)

| Decision | Choice |
| --- | --- |
| Icon source | `lucide-static` (3500+ icons as SVG strings, PascalCase exports) + `tags.json` keyword index |
| Embedding | Rasterize SVG → PNG in the main process via `@resvg/resvg-js`, embed via `slide.addImage` (PptxGenJS cannot rasterize SVG in Node — its PNG fallback preview is broken, so raw-SVG embedding only renders in PowerPoint 2016+) |
| Sharing | Opt-in composition: `createLucideIconTools(): PTTool[]` in `src/main/modules/shared/`; each module merges it into its own `tools` |
| Not chosen | Injecting icon tools into `baseTools` (would force icons on the main chat + every module, tool-creep per AGENTS.md) |
| Tool surface | `search_lucide_icons` (keyword → names/tags) **and** `get_lucide_icon` (name → SVG string or PNG data URI) |
| Icon placement (pptx) | `section`/`statement`: big centered icon above text; `title`: small centered icon below subtitle; other layouts: top-right corner with header title width shrunk |

## Dependencies

- `lucide-static` ^1.30.0
- `@resvg/resvg-js` ^2.6.2 (N-API prebuilt binaries; works in Electron main and the plain-Node tsx test runner; no rebuild needed since `electron-builder.yml` has `npmRebuild: false`)

## Packaging

- `electron-builder.yml` → `asarUnpack`: append `**/node_modules/@resvg/**` so the native `.node` loads in the packaged app.

## Files

### New: `src/main/modules/shared/lucideIcons.ts`
Framework-agnostic icon library used by any module or builder:

- `loadCatalog()` — lazy-loads `tags.json` via `fs.readFileSync(require.resolve('lucide-static/tags.json'))` (avoids `resolveJsonModule`), falling back to name-only matching if the read fails. Maps kebab-name → PascalCase export.
- `searchLucideIcons(query, limit = 20)` → `{ name, tags }[]`, scoring icon names + tags.
- `getLucideIconSvg(name, color)` → SVG string with `stroke="currentColor"` replaced by `stroke="#hex"` (resvg does not resolve `currentColor`), `fill="none"` kept.
- `lucideIconPngDataUri(name, { color, sizePx = 256 })` → async; `Resvg.render().asPng()` → `data:image/png;base64,...`.
- Unknown names → `{ ok: false, error }` so modules surface the error to the model.

### New: `src/main/modules/shared/createLucideIconTools.ts`
`createLucideIconTools(): PTTool[]`:

- `search_lucide_icons` (`{ query, limit? }`) → `{ ok: true, query, results: [{ name, tags }] }`.
- `get_lucide_icon` (`{ name, format: 'svg' | 'png', color?, sizePx? }`) → `{ ok: true, name, svg? | png?, tags }`. Tool docs: prefer `svg` unless the module needs pixels (SVG ~1KB vs heavier PNG base64 in model context).

### Edit: `src/main/modules/pptx/index.ts`
- `tools: [...createLucideIconTools(), createPptxFileTool()]`.
- `DESIGN_SCHEMA` documents per-slide `icon`: `{ name, size?, x?, y?, color? }` or a bare `"rocket"` string.
- `systemPrompt`: instruct the subagent to call `search_lucide_icons` for section/statement/title slides and include `icon` in the slide JSON.

### Edit: `src/main/modules/pptx/builder.ts`
- `PptxSlideSpec.icon`.
- Resolve each slide icon to a PNG data URI (shared helper) before `writeFile`; `placeIcon()` per layout (see placement decisions above).
- Unknown icon name → `{ ok: false, error: 'Unknown icon "<name>". Use search_lucide_icons…' }` so the subagent self-corrects.

### Edit: `scripts/test-modules.mts`
- Shared-layer units: `searchLucideIcons('chart')` matches; `getLucideIconSvg('rocket')` yields an SVG with the injected stroke color; PNG data URI has PNG magic bytes.
- Builder: slide with `icon: 'trending-up'` builds with the correct `slideCount`; unknown icon → `{ ok: false }`.

### Edit: `docs/module-development.md`
- New "Shared tools" section: reuse `createLucideIconTools` so future modules get search/get icons with zero framework changes (runner already merges `module.tools`).

## Future module reuse

```ts
// Any module:
tools: [...createLucideIconTools(), createSomeFileTool()]
```

Consumers get the SVG via `getLucideIconSvg(...)` or a PNG data URI via `lucideIconPngDataUri(...)` — the shared layer is format-agnostic, so a future HTML/report module can embed SVG directly.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
```
