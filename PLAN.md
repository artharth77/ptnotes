# PLAN — v0.6.0

This file tracks the implementation plan for the upcoming release. Once work is
complete and the release ships, the relevant notes are folded into `CHANGELOG.md`
and this file is updated/cleared.

## Goal 1: About category in Settings dialog

Add a new read-only **About** pane to the Settings dialog showing the app icon,
name, version, description + tech stack, and runtime versions.

### Changes

1. **`package.json`** — bump `"version"` from `0.5.2` to `0.6.0`.
2. **`src/shared/types.ts`** — add `AboutInfo` interface (`name`, `version`,
   `electron`, `chrome`, `node`).
3. **`src/main/ipc/settings.ts`** — add `settings:getAbout` handler returning:
   - `app.getName()` → `"PTNotes"`, `app.getVersion()` → version from `package.json`
   - `process.versions.electron` / `.chrome` / `.node`
4. **`src/preload/index.ts`** — expose `settings.getAbout(): Promise<AboutInfo>`
   (invoke `settings:getAbout`); add `AboutInfo` to the type imports.
5. **`src/renderer/src/store/useAppStore.ts`** — widen the `settingsCategory` union
   to `'storage' | 'ai' | 'modules' | 'about'` (interface, `setSettingsCategory`,
   `openSettings`).
6. **`src/renderer/src/components/SettingsDialog.tsx`** —
   - New `AboutPane` component: fetches `AboutInfo` on mount, renders the app icon
     (imported from `resources/icon.png` via Vite asset), `PTNotes` name + version,
     the one-line description, a short tech-stack blurb, and labeled rows for
     Electron / Chromium / Node versions.
   - Add an **About** button to the `settings-nav` and a `category === 'about'`
     branch in the pane (no Save/Cancel actions — read-only).
7. **`src/renderer/src/assets/main.css`** — add `.about-*` styles: centered icon
   header, description, and a key/value list for the version rows, matching
   existing settings-pane spacing.
8. **`CHANGELOG.md`** — add a `## [0.6.0]` section with an **Added** entry for the
   About pane.

### Notes

- All version data flows through IPC from the main process (renderer never touches
  `process.versions` directly — respects the security invariant).
- Icon renders via bundled asset (allowed by CSP `img-src 'self'`).

### Verify

- `npm run typecheck`
- `npm run lint`

## Goal 2: Move `chat`/`modules` into `<project>/.data/`

Move the per-project `chat/` and `modules/` folders under a new dot-directory
`<project>/.data/`. The system must verify the existence of the legacy folders
(`chat`/`modules`) at the project root upon startup; if found, migrate them to the
new `.data` path before proceeding.

### Changes

1. **`src/main/service/PTNotesService.ts`** — new layout + startup migration:
   - Add `private dataDir(name)` → `<project>/.data`.
   - Repoint `chatDir()` → `.data/chat` and `modulesDir()` → `.data/modules` (so
     `moduleTempDir` → `.data/modules/temp` automatically).
   - Update comments referencing `<project>/modules/` and `<project>/modules/temp/`.
   - Add `async migrateLegacyFolders(): Promise<void>`:
     - Iterate project dirs under `rootDir` (skip dot-dirs, matching `listProjects`).
     - For each project, if `<project>/chat` or `<project>/modules` exists as a
       directory, move it into `<project>/.data/`:
       - `.data` is created first; if the target `.data/chat` / `.data/modules`
         doesn't exist → `fs.rename` the whole folder (fast, atomic).
       - If the target already exists (partial/duplicate) → **recursive merge**:
         walk the legacy dir, moving each file/dir into the target; nested dirs
         (e.g. `modules/temp`) are merged recursively; on a leaf-file collision
         keep both (suffix the incoming file `-2`, matching the codebase's
         collision pattern). Then remove the empty legacy dir.
       - Skip if the legacy entry isn't a directory.
     - Idempotent (safe to call repeatedly).
   - Call `await this.migrateLegacyFolders()` at the end of `changeRootDir()` so a
     fresh root that contains legacy folders is also migrated immediately (not just
     on next launch).
2. **`src/main/index.ts`** — startup hook: after `const service =
   new PTNotesService(...)` and before `register*Ipc` / `createWindow()`, call
   `await service.migrateLegacyFolders()` (satisfies "verify legacy folders upon
   startup and migrate before proceeding").
3. **Tool descriptions** — update temp path strings in
   `src/main/modules/shared/createChartTools.ts`, `createDiagramTools.ts`,
   `createInfographicTools.ts`: `"<project>/modules/temp/<slug>…"` →
   `"<project>/.data/modules/temp/<slug>…"`.
4. **Tests**:
   - `scripts/test-service.mts` — add a migration section: create a project,
     manually create legacy `<proj>/chat/a.json` and `<proj>/modules/<id>.json` +
     `modules/temp/x.png`, call `service.migrateLegacyFolders()`; assert legacy
     dirs are gone and files now live under `.data/chat` / `.data/modules/temp`;
     assert `listChatSessions()` / `listStoredModuleRuns()` read migrated data;
     add a merge case (pre-create `.data/modules` + legacy `modules` both present
     → merged, no data lost).
   - `scripts/test-docx.mts` line 186 — change `tempDir` to
     `join(ROOT, PROJECT, '.data', 'modules', 'temp')`.
   - `scripts/test-modules.mts` `/modules/temp/` substring checks still pass
     (`.data/modules/temp` contains `/modules/temp/`) — no change.
5. **Docs**:
   - `AGENTS.md` — update on-disk layout (`chat/*.json`, `modules/*.json`,
     `modules/temp/*` now under `<project>/.data/`) and add a note about the
     startup migration.
   - `README.md` — update the Storage layout block.
   - `CHANGELOG.md` — fold into the existing `## [0.6.0]` section (Added: About
     pane; Changed: chat/modules moved to `.data` with automatic startup
     migration).
   - `PLAN.md` — this section.

### Notes

- `files/`, `notes/`, `TODO.md` stay at the project root (only `chat` + `modules`
  move, per the goal).
- Persisted run JSONs referencing old absolute temp paths go stale after
  migration, but temp files are deleted post-build and `outputFiles` live in
  `files/` (unmoved), so no functional impact.
- `.data` is dot-prefixed, so it's already excluded from project listing and the
  `#` file picker.

### Verify

- `npm run typecheck`
- `npm run lint`
- `npm run test`

## Goal 3: Skills support in AI chat

Skills are named instruction documents (markdown) the AI can load on demand.
**Global** skills live at `<root>/.skills/`; **project** skills at
`<project>/.data/skills/`. The system prompt lists skill names + descriptions; the
model calls `read_skill` to load full content when relevant. Managed via chat tools
and a new **Settings ▸ Skills** pane.

### Changes

1. **`src/shared/types.ts`** — add:
   - `type SkillScope = 'global' | 'project'`
   - `interface SkillMeta { scope: SkillScope; name: string; description: string }`
   - `interface SkillList { global: SkillMeta[]; project: SkillMeta[] }`
   - `interface SkillContent extends SkillMeta { content: string }`
2. **`src/main/service/PTNotesService.ts`** — add `globalSkillsDir()` →
   `<root>/.skills` and `projectSkillsDir(project)` → `<project>/.data/skills`
   (reuses Goal 2's `dataDir`); CRUD with slugified names (like notes):
   - `listSkills(project): Promise<SkillList>` — reads `*.md` in both dirs,
     parsing YAML `description:` front-matter.
   - `readSkill(project, scope, name): Promise<SkillContent | null>`
   - `saveSkill(project, scope, name, { description, content }): Promise<SkillMeta>`
     — upsert, writes markdown with front-matter.
   - `deleteSkill(project, scope, name): Promise<boolean>`
   - `renderSkillsIndex(project): Promise<string>` — prompt block (global +
     project, `name — description` each).
   - **`changeRootDir`**: also relocate `<root>/.skills` alongside the registry,
     since global skills live beside project data.
3. **`src/main/ai/chatSession.ts`** — system prompt gains a **Skills** section
   (names + descriptions from `renderSkillsIndex`); `buildSystemPrompt` takes the
   rendered index; `ensureSystemPrompt` becomes async and **refreshes** the system
   message on every `send()` (so mid-session skill changes apply); `uploadPdf`
   path updated the same way.
4. **`src/main/ai/tools.ts`** — add 3 tools (13 → 16):
   - `create_skill` — `{ scope, name, description, content }`, optional `project`
     (defaults active); upsert; returns `{ ok, action: 'created'|'updated', name }`.
   - `read_skill` — `{ scope, name, project? }` → full content or not-found error.
   - `delete_skill` — `{ scope, name, project? }`; requires confirmation like
     `delete_note`.
   - No separate `list_skills` (index is already in the system prompt).
5. **IPC + preload** — new `src/main/ipc/skills.ts` →
   `registerSkillsIpc(service)` with `skills:list(project)`,
   `skills:read(project, scope, name)`,
   `skills:save(project, scope, name, { description, content })`,
   `skills:delete(project, scope, name)`; register in `src/main/index.ts`; expose
   `window.ptnotes.skills.*` in `src/preload/index.ts`.
6. **Settings ▸ Skills pane** —
   - `useAppStore.ts`: widen `settingsCategory` union to `'skills'`.
   - `SettingsDialog.tsx`: add **Skills** nav button + `SkillsPane` listing global
     + project skills (name, description, edit ✏️ / delete 🗑, click-to-expand
     content); create/edit via a modal (scope, name, description, content
     textarea) reusing `Modal`/`TextField`; delete confirms.
   - `main.css`: `.skills-*` styles matching the settings pane.
7. **Tests**:
   - `scripts/test-ai.mts` — skill tools: create global + project skill, upsert
     (update), read, delete, and assert `renderSkillsIndex` output.
   - `scripts/test-service.mts` — skill CRUD + `.skills` moves during
     `changeRootDir`.
8. **Docs** — `AGENTS.md` (on-disk layout, tool table, IPC surface, chat feature
   section), `README.md` (feature bullet + Settings section), `CHANGELOG.md` (fold
   into `## [0.6.0]`), `PLAN.md` (this section).

### Notes

- Tool count hits 16 (AGENTS.md prefers ~10); acceptable tradeoff for the feature.
- Skill files are human-editable markdown with a one-line `description:`
  front-matter.
- Module subagent prompts are out of scope (skills apply to the main chat only).

### Verify

- `npm run typecheck`
- `npm run lint`
- `npm run test`
