# Plan 0.2.0 — Settings Redesign, Configurable Project Root & PDF Chat Attachments

## Goal 1 — Settings dialog redesign & configurable project root

Replace the current standalone **AI Settings** dialog with a general **Settings** dialog that
hosts multiple setting categories. Introduce a **General** category that lets the user change the
project root path (the folder where all projects live, currently hardcoded to
`~/Documents/PTNotes`). Changing the root path requires explicit user confirmation before the app
moves **all existing project data** to the new location.

## Current state

- The only settings entry point is the **AI Settings** button in `TopBar.tsx` (`setSettingsOpen(true)`).
- It renders `AISettingsDialog.tsx`, a single-panel `Modal` with three fields (Base URL / API key /
  Model) backed by `ai:getConfig` / `ai:setConfig`.
- The project root path is hardcoded in `PTNotesService`:
  `this.rootDir = join(app.getPath('documents'), 'PTNotes')`, and is read-only (`root` getter).
- The service is constructed in `main/index.ts` as `new PTNotesService()` with no stored root.
- Renderer state tracks only `settingsOpen` (boolean).

## Proposed design

### 1. Settings dialog (renderer)

- Rename top-bar button to **Settings** (keep the `⚙` icon); keep store key `settingsOpen`.
- Replace `AISettingsDialog.tsx` with a new `SettingsDialog.tsx` that has a **two-panel layout**:
  - **Left panel:** list of categories (`General`, `AI Settings`). Selecting a category switches the
    right panel.
  - **Right panel:** the form for the selected category.
  - Wrap in the existing `Modal` component; add a small two-column CSS layout
    (`.settings-layout` with `.settings-nav` + `.settings-pane`).
- Current AI settings move **unchanged** under the **AI** category (Base URL / API key / Model,
  same save/cancel + `ai:getConfig`/`ai:setConfig` wiring).
- First category is **General** (see below).

### 2. General category — project root path

- Show the current root path in a text field / read-only display.
- A **Change…** / **Browse** button opens a native folder picker (`dialog.showOpenDialog` in main).
- On change:
  1. Validate the new path is different, non-empty, and not inside the current root.
  2. Ask the user for confirmation via `Modal` (explicit, matching existing confirm pattern):
     _“Move all project data from `<oldRoot>` to `<newRoot>`?”_ — wording must be unambiguous.
  3. On confirmation, main process moves every project folder, `TODO.md`, `notes/`, `chat/`, and the
     project registry (`.ptnotes-projects.json`) from old root to new root.
  4. Persist the new root in a settings store.
  5. Refresh the project list in the renderer and reselect the active project so the UI reflects the
     new paths.

### 3. Settings store (project root)

- New `SettingsStore` in `main/` (mirroring `AIConfigStore`):
  - File: `userData/ptnotes-settings.json`, `chmod 600` like `ai-provider.json`.
  - Default root = `join(app.getPath('documents'), 'PTNotes')` (current behavior).
  - `load()` / `save()` for a `GeneralSettings { rootDir: string }`.
- `PTNotesService` reads `rootDir` from the store instead of the hardcoded default. Because the
  service is constructed before `app` is fully ready, resolve the root lazily or pass the loaded
  value in `main/index.ts` at startup.

### 4. Moving data (root relocation)

- Add `PTNotesService.changeRootDir(newRoot: string)`:
  - Ensure old root exists; create new root (`fs.mkdir recursive`).
  - Move each known project directory and `.ptnotes-projects.json`.
  - Preserve `pathExists` behaviour — registry is moved alongside so every previously known project
    is retained.
  - Do not move anything inside the current root (reject nesting).
- Add IPC `settings:getRootDir`, `settings:setRootDir`, and `settings:moveData` (or a combined
  `settings:changeRoot` that performs confirmable move).

### 5. IPC + preload surface

- `main/ipc/settings.ts` registers:
  - `settings:get` → `{ rootDir }`
  - `settings:changeRoot(newRoot)` → moves data + persists + returns new `{ rootDir }`
- Preload exposes `window.ptnotes.settings.{ get, changeRoot }`.
- Types added to `shared/types.ts`:

```ts
export interface GeneralSettings {
  rootDir: string
}
export interface AppSettings {
  general: GeneralSettings
  ai: AIProviderConfig
}
```

### 6. Renderer wiring

- `SettingsDialog.tsx` loads `app settings` on mount (`get`), caches category selection locally.
- Store: keep `settingsOpen`; on successful root change call `refreshProjects()` and
  re-`selectProject(activeProject)`.
- Confirm-modal reuse: follow `ConfirmDeleteDialog` pattern in `App.tsx` for the move confirmation.

## Affected files

- `src/renderer/src/components/AISettingsDialog.tsx` → replaced by `SettingsDialog.tsx`
- `src/renderer/src/components/TopBar.tsx` (button → general settings)
- `src/renderer/src/App.tsx` (mount `SettingsDialog`; confirm flow)
- `src/renderer/src/store/useAppStore.ts` (settings refresh on root change)
- `src/renderer/src/assets/*.css` or global CSS (two-panel layout)
- `src/main/ipc/settings.ts` (new) + `src/main/ipc/index.ts` / `ai.ts` (reuse)
- `src/main/service/PTNotesService.ts` (root from store + `changeRootDir`)
- `src/main/settings.ts` or `src/main/ai/config.ts` sibling (new `SettingsStore`)
- `src/main/index.ts` (wire store + bootstrap root)
- `src/preload/index.ts`, `src/preload/index.d.ts`
- `src/shared/types.ts`

## Validation

- `npm run typecheck`
- `npm run lint`
- Manual: change root path → confirm move → projects + todos + notes + chat all reopen from new
  location; `listProjects` reports correct `path` of the new root; switching back is not required.

---

## Goal 2 — Drag & drop PDF files into the Chat panel

### User flow

1. User drags a `.pdf` file onto the chat panel (chat drawer).
2. A small modal prompts the user to choose how to send it:
   - **Extract text (default):** PDF parsed locally, text sent to AI.
   - **Upload PDF** — raw PDF sent to the AI provider as a file attachment (only when the
     configured model/endpoint supports PDF attachments; otherwise disabled with a hint).
   - The choice is remembered for the next drop.
3. The file is copied into the project under `<project>/files/<slug>.pdf` for reference.
4. The extracted text (or uploaded file) is sent to the AI. An **optional additional prompt** can
   be supplied for the PDF content (e.g. _"Summarize this PDF"_ / _"Extract action items"_); if left
   blank a sensible default instruction is used.
5. The attached PDF is surfaced in the chat UI as a distinct attachment message with a link to the
   saved `files/` copy.

### Decisions (locked)

- Mode selection: **ask on every drop**; remember the last chosen mode as default.
- Extract parser: **`pdf-parse`** (lightweight, no extra heavyweight deps).
- **No OCR** in 0.2.0 — scanned/image-only PDFs produce a clear _"No text found; try Upload mode"_
  error.
- Long PDFs (over context window): **truncate + warn** the user that the tail was cut off.
- Storage: the PDF is **copied into the project** under `<project>/files/` for reference.

### Technical design

- **New dependency:** `pdf-parse` (main process only).
- Main process gains PDF handling (keeps the "renderer never reads files" invariant):
  - `extractPdf(path)` → `{ text, pageCount, charCount }` via `pdf-parse`.
  - `uploadPdf(path)` → sends raw bytes to the configured provider as a PDF attachment.
- **IPC:**
  - `pdf:extract(path)` → extracted text + metadata.
  - `pdf:upload(project, path)` → attachment send.
  - `pdf:copyToProject(project, sourcePath)` → copies into `<project>/files/`, returns saved path.
  - `pdf:supportsUpload()` → whether configured model/endpoint supports PDF attachments.
- **Preload:** expose `window.ptnotes.pdf.*`; deliver the dropped file path to main (drag & drop
  yields a `File` in the renderer; use Electron's `webUtils.getPathForFile` in preload, **not**
  `File.path` which is deprecated/removed).
- **Chat integration:**
  - A dropped PDF creates an attachment message (role `user`, with `attachment` metadata) so the
    history/replay flow (`readChat` / `writeChat`) round-trips it.
  - Extract → the user message sent to `ai:send` is prefixed with the extracted text wrapped in a
    system-style instruction plus the user's option prompt.
  - Upload → goes through the upload path; if unsupported, the app falls back with a message
    suggesting Extract mode.
- **Types (`shared/types.ts`):** add `Attachment` shape and extend `ChatMessage` with optional
  `attachments` for persistence.
- **UI:** small modal (reuse `Modal`) for mode + optional prompt; attachment chip in the chat
  message list linked to the `files/` copy.

### Affected files

- `src/main/ai/client.ts` (upload request path)
- `src/main/ipc/pdf.ts` (new)
- `src/main/service/PTNotesService.ts` (new `files` dir helpers)
- `src/main/index.ts` (register pdf IPC; wire `pdf-parse`)
- `src/preload/index.ts`, `src/preload/index.d.ts`
- `src/renderer/src/components/ChatDrawer.tsx` (drop target, attachment chip, mode dialog)
- `src/shared/types.ts`

### Validation

- `npm run typecheck` / `npm run lint`.
- Manual: drop a text PDF → extract mode → AI answers with content; drop a scanned PDF → clear
  "no text" message; upload mode disabled when provider unsupported.

### Out of scope

- OCR for scanned PDFs.

---

## Goal 3 — Multi-file drag & drop (.pdf, .md, .txt)

Extend chat drag & drop to accept **multiple files** with **markdown (`.md`) and plain text
(`.txt`)** support alongside PDFs.

### Supported formats

- `.pdf` → copied to `<project>/files/`; text extracted locally via `pdf-parse` (`read_file`).
- `.md`  → copied to `<project>/files/`; read as plain text (`read_file`).
- `.txt` → copied to `<project>/files/`; read as plain text (`read_file`).

### Drop behavior (multi-file)

- Dropping **multiple files in one gesture** is supported.
- If **at least one** file is a supported type: every supported file is copied silently into
  `<project>/files/` (**no popup**); unsupported files are skipped. All dropped supported files are
  referenced in the chat input via `#` mentions (`file:<filename>`), one per file.
- If **no** file in the drop is supported: show a popup alert to the user (no files copied, no
  mention inserted).

### `read_file` tool text extraction

- `read_file` accepts `.pdf`, `.md`, and `.txt` passed via the `#` / `file:<filename>` mention.
- `.pdf` → local `pdf-parse` extraction (existing).
- `.md` / `.txt` → read the file's raw text directly (no PDF parsing). Same `MAX_PDF_CHARS`
  truncation + `truncated` warning applies.

### Implementation notes

- Rename/generalize existing `pdf:copyToProject` / `pdf:extract` behind a generic `files:*` (or keep
  `pdf:` prefix) IPC that accepts any supported extension.
- `files:list` already globs `*` — update it to surface `.md`/`.txt` alongside `.pdf` for the `#`
  picker.
- Copy slugging stays Unicode-safe (see `slugify`); collisions reuse existing files by size + SHA-256.

### Affected files

- `src/main/ipc/pdf.ts` (multi-file copy + `.md`/`.txt` handling) — possibly rename to `files.ts`
- `src/main/ai/tools.ts` (`read_file` supports `.md`/`.txt`)
- `src/main/ai/pdf.ts` (text extraction for `.md`/`.txt`, or a shared reader)
- `src/renderer/src/components/ChatDrawer.tsx` (multi-file drop handling + alert when nothing supported)
- `src/preload/index.ts`, `src/preload/index.d.ts`

### Validation

- `npm run typecheck` / `npm run lint`.
- Manual: drop multiple files mixing `.pdf`/`.md`/`.txt` → all copied, all `#`-mentioned, no popup;
  drop only unsupported files → alert shown, nothing copied.
