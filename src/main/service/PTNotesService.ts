import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import { app, shell } from 'electron'
import type {
  AiTraceEntry,
  AiTraceFile,
  AiTraceHeader,
  ChatSessionMeta,
  ChatThread,
  CreateProjectResult,
  NoteMeta,
  Project,
  ProjectCalendar,
  Schedule,
  ScheduleMeta,
  SkillContent,
  SkillList,
  SkillMeta,
  SkillScope
} from '@shared/types'
import type { ModuleChatMessage, ModuleInfo, ModuleRun } from '@shared/types'
import {
  defaultArchive,
  defaultBoard,
  findColumnByName,
  newCardId,
  normalizeArchive,
  normalizeBoard,
  type KanbanArchive,
  type KanbanArchiveMove,
  type KanbanBoard,
  type KanbanCard,
  type KanbanCardPatch,
  type NewKanbanCardInput
} from '@shared/kanban'
import { slugify } from '@shared/slug'
import { countTasks, defaultCalendar, normalizeCalendar, validateScheduleId } from '@shared/planner'
import { detectFileKind } from '../ai/reader'
import type { SettingsStore } from '../settings'

const WELCOME_ID = 'welcome'
const REGISTRY_FILE = '.ptnotes-projects.json'
const GLOBAL_SKILLS_DIR = '.skills'
const BUILTIN_SKILLS_DIR = 'builtin-skills'
const WELCOME_NOTE = `# Welcome to PTNotes

This is your first note. Everything you write here is stored as markdown in:

\`notes/welcome.md\`

## Getting started

- Click **+ New** in the **Notes** tab to create a new note.
- Use the **Kanban** tab to keep track of your tasks.
- Open the **AI assistant** (💬 chat icon, top-right) to create or update notes and kanban cards, or research the web and save the findings here.
`

export class PTNotesService {
  private rootDir: string
  private readonly builtinSkillsRoot: string
  private readonly settingsStore?: SettingsStore
  private builtinOverrides: Record<string, boolean> = {}
  private builtinOverridesLoaded = false

  constructor(rootDir?: string, builtinSkillsRoot?: string, settingsStore?: SettingsStore) {
    this.rootDir = rootDir ?? join(app.getPath('documents'), 'PTNotes')
    this.builtinSkillsRoot =
      builtinSkillsRoot ?? join(app.getAppPath(), 'resources', BUILTIN_SKILLS_DIR)
    this.settingsStore = settingsStore
  }

  get root(): string {
    return this.rootDir
  }

  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true })
  }

  async changeRootDir(newRoot: string): Promise<void> {
    const target = newRoot.trim()
    if (!target) throw new Error('New root path cannot be empty')
    if (target === this.rootDir) {
      throw new Error('New root path is the same as the current root')
    }
    if (isInside(target, this.rootDir) || isInside(this.rootDir, target)) {
      throw new Error('New root path cannot be inside the current root folder')
    }
    await fs.mkdir(target, { recursive: true })
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(this.rootDir, { withFileTypes: true })
    } catch {
      entries = []
    }
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    const registry = entries.find((e) => e.isFile() && e.name === REGISTRY_FILE)
    const skills = entries.find((e) => e.isDirectory() && e.name === GLOBAL_SKILLS_DIR)
    for (const entry of dirs) {
      const dest = join(target, entry.name)
      if (await this.pathExists(dest)) throw new Error(`A folder already exists at ${dest}`)
    }
    if (registry && (await this.pathExists(join(target, registry.name)))) {
      throw new Error(`A file already exists at ${join(target, registry.name)}`)
    }
    if (skills && (await this.pathExists(join(target, skills.name)))) {
      throw new Error(`A folder already exists at ${join(target, skills.name)}`)
    }
    for (const entry of dirs) {
      await fs.rename(join(this.rootDir, entry.name), join(target, entry.name))
    }
    if (registry) {
      await fs.rename(join(this.rootDir, registry.name), join(target, registry.name))
    }
    if (skills) {
      await fs.rename(join(this.rootDir, skills.name), join(target, skills.name))
    }
    this.rootDir = target
    await this.migrateLegacyFolders()
  }

  /**
   * Move legacy per-project `chat/` and `modules/` folders into
   * `<project>/.data/` on startup. Idempotent — safe to call repeatedly.
   */
  async migrateLegacyFolders(): Promise<void> {
    await this.ensureRoot()
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true })
    const projectNames = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
    for (const name of projectNames) {
      await this.migrateLegacyFolder(name, 'chat')
      await this.migrateLegacyFolder(name, 'modules')
    }
  }

  private async migrateLegacyFolder(project: string, folder: string): Promise<void> {
    const legacy = join(this.projectDir(project), folder)
    const stat = await fs.stat(legacy).catch(() => null)
    if (!stat?.isDirectory()) return
    const target = join(this.dataDir(project), folder)
    if (!(await this.pathExists(target))) {
      await fs.mkdir(this.dataDir(project), { recursive: true })
      await fs.rename(legacy, target)
      return
    }
    await mergeDir(legacy, target)
    await fs.rm(legacy, { recursive: true, force: true })
  }

  private projectDir(name: string): string {
    return join(this.rootDir, validateProjectName(name))
  }

  private notesDir(name: string): string {
    return join(this.projectDir(name), 'notes')
  }

  /** Per-project app-internal data dir (`chat`, `modules`, … live under it). */
  private dataDir(name: string): string {
    return join(this.projectDir(name), '.data')
  }

  private chatDir(name: string): string {
    return join(this.dataDir(name), 'chat')
  }

  private filesDir(name: string): string {
    return join(this.projectDir(name), 'files')
  }

  private modulesDir(name: string): string {
    return join(this.dataDir(name), 'modules')
  }

  /** Per-project browser screenshots dir (`<project>/.data/browser/`). */
  browserDataDir(project: string): string {
    return join(this.dataDir(project), 'browser')
  }

  /** Per-project screenshots dir (`<project>/screenshots/`). */
  screenshotsDir(project: string): string {
    return join(this.projectDir(project), 'screenshots')
  }

  private plannerDir(name: string): string {
    return join(this.projectDir(name), 'planner')
  }

  private schedulePath(project: string, id: string): string {
    return join(this.plannerDir(project), `${validateScheduleId(id)}.json`)
  }

  private calendarPath(project: string): string {
    return join(this.plannerDir(project), 'calendar.json')
  }

  /** Global skills dir (shared across all projects), next to the project registry. */
  private globalSkillsDir(): string {
    return join(this.rootDir, GLOBAL_SKILLS_DIR)
  }

  /** Per-project skills dir under the app-internal data dir. */
  private projectSkillsDir(name: string): string {
    return join(this.dataDir(name), 'skills')
  }

  /** Builtin (app-shipped, read-only) skills dir, packaged under `resources/builtin-skills`. */
  private builtinSkillsDir(): string {
    return this.builtinSkillsRoot
  }

  private skillsDir(scope: SkillScope, name: string): string {
    if (scope === 'builtin') return this.builtinSkillsDir()
    return scope === 'global' ? this.globalSkillsDir() : this.projectSkillsDir(name)
  }

  /** OpenAI skill-guide layout: each skill is a folder containing a SKILL.md manifest. */
  private skillDir(scope: SkillScope, project: string, name: string): string {
    return join(this.skillsDir(scope, project), validateNoteId(slugify(name)))
  }

  private skillManifestPath(scope: SkillScope, project: string, name: string): string {
    return join(this.skillDir(scope, project, name), 'SKILL.md')
  }

  /** Locate the manifest of a skill folder (`SKILL.md`, case-insensitive per the spec). */
  private async findSkillManifest(dir: string): Promise<string | null> {
    for (const name of ['SKILL.md', 'skill.md']) {
      const p = join(dir, name)
      if (await this.pathExists(p)) return p
    }
    return null
  }

  private chatPath(project: string, sessionId: string): string {
    return join(this.chatDir(project), `${validateNoteId(sessionId)}.json`)
  }

  private notePath(project: string, noteId: string): string {
    return join(this.notesDir(project), `${validateNoteId(noteId)}.md`)
  }

  private kanbanDir(project: string): string {
    return join(this.projectDir(project), 'kanban')
  }

  private kanbanPath(project: string): string {
    return join(this.kanbanDir(project), 'board.json')
  }

  private kanbanArchivePath(project: string): string {
    return join(this.kanbanDir(project), 'archive.json')
  }

  private registryPath(): string {
    return join(this.rootDir, REGISTRY_FILE)
  }

  private async loadRegistry(): Promise<string[]> {
    try {
      const raw = await fs.readFile(this.registryPath(), 'utf8')
      const data = JSON.parse(raw) as { projects?: unknown } | undefined
      if (Array.isArray(data?.projects)) {
        return data.projects.filter((n): n is string => typeof n === 'string')
      }
    } catch {
      // missing or corrupt registry — treated as empty
    }
    return []
  }

  private async saveRegistry(names: string[]): Promise<void> {
    const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b))
    const data = { version: 1, projects: sorted }
    await fs.writeFile(this.registryPath(), JSON.stringify(data, null, 2), 'utf8')
  }

  private async pathExists(path: string): Promise<boolean> {
    return fs
      .access(path)
      .then(() => true)
      .catch(() => false)
  }

  // ---- Projects ----

  async listProjects(): Promise<Project[]> {
    await this.ensureRoot()
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true })
    const onDisk = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
    const registered = await this.loadRegistry()
    const names = [...new Set([...registered, ...onDisk])]
    const projects: Project[] = []
    for (const name of names) {
      const path = this.projectDir(name)
      const exists = await this.pathExists(path)
      projects.push({
        name,
        path,
        noteCount: exists ? await this.countNotes(name) : 0,
        pathExists: exists
      })
    }
    projects.sort((a, b) => a.name.localeCompare(b.name))
    await this.saveRegistry(projects.map((p) => p.name))
    return projects
  }

  async createProject(name: string): Promise<CreateProjectResult> {
    await this.ensureRoot()
    const dir = this.projectDir(name)
    await fs.mkdir(join(dir, 'notes'), { recursive: true })
    await this.saveKanban(name, defaultBoard())
    await fs.writeFile(this.notePath(name, WELCOME_ID), WELCOME_NOTE, 'utf8')
    await this.addToRegistry(name)
    return { name, path: dir, noteCount: 1, pathExists: true, welcomeCreated: true }
  }

  async recreateProject(name: string): Promise<CreateProjectResult> {
    await this.ensureRoot()
    const dir = this.projectDir(name)
    await fs.mkdir(join(dir, 'notes'), { recursive: true })
    if (!(await this.pathExists(this.kanbanPath(name)))) {
      await this.saveKanban(name, defaultBoard())
    }
    let welcomeCreated = false
    if (!(await this.pathExists(this.notePath(name, WELCOME_ID)))) {
      await fs.writeFile(this.notePath(name, WELCOME_ID), WELCOME_NOTE, 'utf8')
      welcomeCreated = true
    }
    await this.addToRegistry(name)
    return {
      name,
      path: dir,
      noteCount: await this.countNotes(name),
      pathExists: true,
      welcomeCreated
    }
  }

  async renameProject(oldName: string, newName: string): Promise<Project> {
    await fs.rename(this.projectDir(oldName), this.projectDir(newName))
    const registered = await this.loadRegistry()
    const idx = registered.indexOf(oldName)
    if (idx !== -1) {
      registered[idx] = newName
    } else {
      registered.push(newName)
    }
    await this.saveRegistry(registered)
    return {
      name: newName,
      path: this.projectDir(newName),
      noteCount: await this.countNotes(newName),
      pathExists: true
    }
  }

  async deleteProject(name: string): Promise<void> {
    await fs.rm(this.projectDir(name), { recursive: true, force: true })
    const registered = await this.loadRegistry()
    const next = registered.filter((n) => n !== name)
    if (next.length !== registered.length) {
      await this.saveRegistry(next)
    }
  }

  private async addToRegistry(name: string): Promise<void> {
    const registered = await this.loadRegistry()
    if (!registered.includes(name)) {
      registered.push(name)
      await this.saveRegistry(registered)
    }
  }

  // ---- Notes ----

  private async countNotes(project: string): Promise<number> {
    try {
      const entries = await fs.readdir(this.notesDir(project))
      return entries.filter((f) => f.endsWith('.md')).length
    } catch {
      return 0
    }
  }

  async listNotes(project: string): Promise<NoteMeta[]> {
    const dir = this.notesDir(project)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return []
    }
    const notes: NoteMeta[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const id = entry.slice(0, -3)
      let updatedAt = 0
      try {
        updatedAt = (await fs.stat(join(dir, entry))).mtimeMs
      } catch {
        // ignore
      }
      notes.push({ id, name: id, updatedAt })
    }
    notes.sort((a, b) => a.name.localeCompare(b.name))
    return notes
  }

  async readNote(project: string, noteId: string): Promise<string> {
    try {
      return await fs.readFile(this.notePath(project, noteId), 'utf8')
    } catch {
      return ''
    }
  }

  async saveNote(project: string, noteId: string, content: string): Promise<void> {
    await fs.writeFile(this.notePath(project, noteId), content, 'utf8')
  }

  async createNote(project: string, title: string): Promise<NoteMeta> {
    const base = slugify(title)
    const id = await this.uniqueNoteId(project, base)
    await fs.writeFile(this.notePath(project, id), `# ${id}\n\n`, 'utf8')
    return { id, name: id, updatedAt: Date.now() }
  }

  async renameNote(project: string, noteId: string, newTitle: string): Promise<NoteMeta> {
    const base = slugify(newTitle)
    const newId = await this.uniqueNoteId(project, base, noteId)
    await fs.rename(this.notePath(project, noteId), this.notePath(project, newId))
    return { id: newId, name: newId, updatedAt: Date.now() }
  }

  async deleteNote(project: string, noteId: string): Promise<void> {
    await fs.unlink(this.notePath(project, noteId)).catch(() => {})
  }

  async revealNoteInFolder(project: string, noteId: string): Promise<void> {
    shell.showItemInFolder(this.notePath(project, noteId))
  }

  async revealScheduleInFolder(project: string, id: string): Promise<void> {
    shell.showItemInFolder(this.schedulePath(project, id))
  }

  // ---- Skills ----

  /** List global + project + builtin skills (folders with a SKILL.md manifest + `description:` front-matter). */
  async listSkills(project: string): Promise<SkillList> {
    const [global, projectSkills, builtin] = await Promise.all([
      this.readSkillsDir(this.globalSkillsDir(), 'global'),
      this.readSkillsDir(this.projectSkillsDir(project), 'project'),
      this.readSkillsDir(this.builtinSkillsDir(), 'builtin')
    ])
    return { global, project: projectSkills, builtin }
  }

  /**
   * User enable/disable choices for builtin skills, loaded once from the settings store
   * (and cached). Without a store (tests) the choices stay empty.
   */
  private async ensureBuiltinOverrides(): Promise<Record<string, boolean>> {
    if (!this.builtinOverridesLoaded) {
      this.builtinOverridesLoaded = true
      if (this.settingsStore) {
        const settings = await this.settingsStore.load()
        this.builtinOverrides = settings.builtinSkillOverrides ?? {}
      }
    }
    return this.builtinOverrides
  }

  /** Effective enabled flag: a user override wins over the developer's front-matter default. */
  private async applyBuiltinOverride(name: string, defaultEnabled: boolean): Promise<boolean> {
    const overrides = await this.ensureBuiltinOverrides()
    return Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : defaultEnabled
  }

  private async readSkillsDir(dir: string, scope: SkillScope): Promise<SkillMeta[]> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const skills: SkillMeta[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifest = await this.findSkillManifest(join(dir, entry.name))
      if (!manifest) continue
      const raw = await fs.readFile(manifest, 'utf8').catch(() => '')
      skills.push({
        scope,
        name: entry.name,
        description: parseSkillDescription(raw),
        enabled:
          scope === 'builtin'
            ? await this.applyBuiltinOverride(entry.name, parseSkillEnabled(raw))
            : parseSkillEnabled(raw)
      })
    }
    skills.sort((a, b) => a.name.localeCompare(b.name))
    return skills
  }

  async readSkill(project: string, scope: SkillScope, name: string): Promise<SkillContent | null> {
    try {
      const raw = await fs.readFile(this.skillManifestPath(scope, project, name), 'utf8')
      const slug = slugify(name)
      return {
        scope,
        name: slug,
        description: parseSkillDescription(raw),
        enabled:
          scope === 'builtin'
            ? await this.applyBuiltinOverride(slug, parseSkillEnabled(raw))
            : parseSkillEnabled(raw),
        content: stripSkillFrontMatter(raw).trim()
      }
    } catch {
      return null
    }
  }

  /**
   * Read a sibling file inside a skill's folder, referenced from its SKILL.md via a
   * relative link (e.g. `[FORMAT.md](./FORMAT.md)`, `[DOC.md](./doc/DOC.md)`). Only
   * relative paths that resolve within the skill folder are allowed; anything escaping
   * (traversal) or absolute is refused.
   */
  async readSkillFile(
    project: string,
    scope: SkillScope,
    skill: string,
    relPath: string
  ): Promise<{ path: string; content: string; absolutePath: string } | null> {
    if (scope !== 'global' && scope !== 'project' && scope !== 'builtin') return null
    const rel = relPath.replaceAll('\\', '/')
    if (!rel || rel.startsWith('/')) return null
    const base = this.skillDir(scope, project, skill)
    const full = resolve(base, rel)
    const relToBase = relative(base, full)
    if (
      !relToBase ||
      relToBase === '..' ||
      relToBase.startsWith(`..${sep}`) ||
      isAbsolute(relToBase)
    ) {
      return null
    }
    try {
      const stat = await fs.stat(full)
      if (!stat.isFile()) return null
      return { path: rel, content: await fs.readFile(full, 'utf8'), absolutePath: full }
    } catch {
      return null
    }
  }

  /** Upsert a skill: folder `<name>/SKILL.md` with OpenAI skill-guide front-matter. Builtin skills are read-only. */
  async saveSkill(
    project: string,
    scope: SkillScope,
    name: string,
    input: { description: string; content: string; enabled?: boolean }
  ): Promise<SkillMeta> {
    if (scope === 'builtin') throw new Error('Builtin skills are read-only')
    const slug = slugify(name)
    const dir = this.skillDir(scope, project, slug)
    await fs.mkdir(dir, { recursive: true })
    const enabled = input.enabled ?? true
    await fs.writeFile(
      join(dir, 'SKILL.md'),
      renderSkillFile(slug, input.description ?? '', input.content ?? '', enabled),
      'utf8'
    )
    return {
      scope,
      name: slug,
      description: (input.description ?? '').trim(),
      enabled
    }
  }

  async deleteSkill(project: string, scope: SkillScope, name: string): Promise<boolean> {
    if (scope === 'builtin') throw new Error('Builtin skills are read-only')
    const dir = this.skillDir(scope, project, name)
    if (!(await this.pathExists(dir))) return false
    await fs.rm(dir, { recursive: true, force: true })
    return true
  }

  /** Toggle whether a skill is offered to the AI, preserving its description and content. Builtin skills are read-only. */
  async setSkillEnabled(
    project: string,
    scope: SkillScope,
    name: string,
    enabled: boolean
  ): Promise<SkillMeta> {
    if (scope === 'builtin') throw new Error('Builtin skills are read-only')
    const existing = await this.readSkill(project, scope, name)
    if (!existing) throw new Error(`Skill "${name}" (${scope}) not found`)
    return this.saveSkill(project, scope, existing.name, {
      description: existing.description,
      content: existing.content,
      enabled
    })
  }

  /**
   * Toggle a builtin (app-shipped, read-only) skill. The choice is persisted in the
   * settings store (`builtinSkillOverrides`), never written to the packaged SKILL.md.
   */
  async setBuiltinSkillEnabled(name: string, enabled: boolean): Promise<SkillMeta> {
    const slug = slugify(name)
    const meta = await this.readSkill('', 'builtin', slug)
    if (!meta) throw new Error(`Builtin skill "${slug}" not found`)
    const overrides = await this.ensureBuiltinOverrides()
    overrides[slug] = enabled
    if (this.settingsStore) {
      const settings = await this.settingsStore.load()
      settings.builtinSkillOverrides = {
        ...(settings.builtinSkillOverrides ?? {}),
        [slug]: enabled
      }
      await this.settingsStore.save(settings)
    }
    return { ...meta, enabled }
  }

  /** Move a skill between scopes, relocating its whole folder. Builtin skills are read-only. */
  async moveSkill(
    project: string,
    fromScope: SkillScope,
    name: string,
    toScope: SkillScope
  ): Promise<SkillMeta> {
    if (fromScope === 'builtin' || toScope === 'builtin') {
      throw new Error('Builtin skills are read-only')
    }
    const slug = slugify(name)
    const fromDir = this.skillDir(fromScope, project, name)
    const toDir = this.skillDir(toScope, project, slug)
    if (fromDir === toDir) {
      const meta = await this.readSkill(project, fromScope, slug)
      if (!meta) throw new Error(`Skill "${slug}" (${fromScope}) not found`)
      return meta
    }
    if (!(await this.pathExists(fromDir))) {
      throw new Error(`Skill "${slug}" (${fromScope}) not found`)
    }
    if (await this.pathExists(toDir)) {
      throw new Error(`Skill "${slug}" already exists in ${toScope} skills`)
    }
    await fs.mkdir(this.skillsDir(toScope, project), { recursive: true })
    await fs.rename(fromDir, toDir)
    const moved = await this.readSkill(project, toScope, slug)
    if (!moved) throw new Error(`Skill "${slug}" not found after moving`)
    return moved
  }

  /** Prompt block listing enabled skills (global + project + builtin) for the system prompt. Disabled skills are excluded. */
  async renderSkillsIndex(project: string): Promise<string> {
    const { global, project: projectSkills, builtin } = await this.listSkills(project)
    const lines: string[] = []
    const enabledGlobal = global.filter((s) => s.enabled)
    const enabledProject = projectSkills.filter((s) => s.enabled)
    const enabledBuiltin = builtin.filter((s) => s.enabled)
    if (enabledGlobal.length > 0) {
      lines.push('Global skills:')
      for (const s of enabledGlobal)
        lines.push(`- ${s.name} — ${s.description || '(no description)'}`)
    }
    if (enabledProject.length > 0) {
      lines.push('Project skills:')
      for (const s of enabledProject)
        lines.push(`- ${s.name} — ${s.description || '(no description)'}`)
    }
    if (enabledBuiltin.length > 0) {
      lines.push('Builtin skills:')
      for (const s of enabledBuiltin)
        lines.push(`- ${s.name} — ${s.description || '(no description)'}`)
    }
    return lines.join('\n')
  }

  async listChatSessions(project: string): Promise<ChatSessionMeta[]> {
    const dir = this.chatDir(project)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return []
    }
    const sessions: ChatSessionMeta[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry.endsWith('.trace.json')) continue
      const sessionId = entry.slice(0, -5)
      let meta: Pick<ChatSessionMeta, 'createdAt' | 'updatedAt' | 'messageCount' | 'title'> | null =
        null
      try {
        const thread = JSON.parse(await fs.readFile(join(dir, entry), 'utf8')) as ChatThread
        meta = {
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          messageCount: thread.messages.length,
          title: thread.title?.trim() || deriveTitle(thread)
        }
      } catch {
        // ignore corrupt file
      }
      sessions.push({
        sessionId,
        project,
        createdAt: meta?.createdAt ?? 0,
        updatedAt: meta?.updatedAt ?? 0,
        messageCount: meta?.messageCount ?? 0,
        title: meta?.title ?? 'Untitled chat'
      })
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    return sessions
  }

  async readChat(project: string, sessionId: string): Promise<ChatThread> {
    const path = this.chatPath(project, sessionId)
    try {
      const raw = await fs.readFile(path, 'utf8')
      const thread = JSON.parse(raw) as ChatThread
      if (!Array.isArray(thread.messages)) throw new Error('Invalid chat thread')
      return thread
    } catch {
      return { sessionId, createdAt: Date.now(), updatedAt: Date.now(), messages: [] }
    }
  }

  async writeChat(project: string, thread: ChatThread): Promise<void> {
    await fs.mkdir(this.chatDir(project), { recursive: true })
    const path = this.chatPath(project, thread.sessionId)
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, JSON.stringify(thread, null, 2), 'utf8')
    await fs.rename(tmp, path)
  }

  async renameChat(project: string, sessionId: string, title: string): Promise<void> {
    const thread = await this.readChat(project, sessionId)
    thread.title = title.trim() || thread.title
    thread.updatedAt = Date.now()
    await this.writeChat(project, thread)
  }

  async deleteChat(project: string, sessionId: string): Promise<void> {
    await fs.unlink(this.chatPath(project, sessionId)).catch(() => {})
    await this.deleteChatTrace(project, sessionId)
  }

  async deleteProjectChatDir(project: string): Promise<void> {
    await fs.rm(this.chatDir(project), { recursive: true, force: true })
  }

  // ---- Chat raw AI trace (<project>/.data/chat/<sessionId>.trace.jsonl, append-only) ----

  chatTracePath(project: string, sessionId: string): string {
    return join(this.chatDir(project), `${validateNoteId(sessionId)}.trace.jsonl`)
  }

  legacyChatTracePath(project: string, sessionId: string): string {
    return join(this.chatDir(project), `${validateNoteId(sessionId)}.trace.json`)
  }

  async appendChatTrace(
    project: string,
    sessionId: string,
    header: AiTraceHeader,
    lines: string[]
  ): Promise<void> {
    await fs.mkdir(this.chatDir(project), { recursive: true })
    await appendTraceFile(
      this.chatTracePath(project, sessionId),
      this.legacyChatTracePath(project, sessionId),
      header,
      lines
    )
  }

  /** Entry count (for monotonic `seq`) + whether a `system` entry already exists (the
   * system prompt is traced only once per trace file). */
  async chatTraceMeta(
    project: string,
    sessionId: string
  ): Promise<{ count: number; hasSystem: boolean }> {
    return traceMeta(
      this.chatTracePath(project, sessionId),
      this.legacyChatTracePath(project, sessionId)
    )
  }

  async readChatTrace(project: string, sessionId: string): Promise<AiTraceFile | null> {
    return readTraceFile(
      this.chatTracePath(project, sessionId),
      this.legacyChatTracePath(project, sessionId)
    )
  }

  async deleteChatTrace(project: string, sessionId: string): Promise<void> {
    await fs.unlink(this.chatTracePath(project, sessionId)).catch(() => {})
    await fs.unlink(this.legacyChatTracePath(project, sessionId)).catch(() => {})
  }

  async copyFileToProject(project: string, sourcePath: string, fileName?: string): Promise<string> {
    const dir = this.filesDir(project)
    await fs.mkdir(dir, { recursive: true })
    const original = fileName || basename(sourcePath)
    const kind = await detectFileKind(sourcePath)
    const originalExt = extname(original)
    const stem = originalExt ? original.slice(0, -originalExt.length) : original
    const base = slugify(stem)
    let ext: string
    if (kind === 'pdf') {
      ext = '.pdf'
    } else if (kind === 'excel') {
      ext = originalExt.toLowerCase()
    } else if (kind === 'text') {
      ext = originalExt.toLowerCase() || '.txt'
    } else {
      throw new Error(
        `Unsupported file: "${original}" is a binary file. Only PDF, Excel (.xlsx/.xlsm) and text files can be added.`
      )
    }
    const name = `${base}${ext}`

    const srcSize = (await fs.stat(sourcePath)).size
    const srcHash = await hashFile(sourcePath)

    for (const f of await fs.readdir(dir).catch(() => [])) {
      if (f !== name) continue
      const p = join(dir, f)
      const st = await fs.stat(p).catch(() => null)
      if (st && st.size === srcSize && (await hashFile(p)) === srcHash) {
        return p
      }
    }

    let candidate = name
    let i = 2
    while (await this.pathExists(join(dir, candidate))) {
      candidate = `${base}-${i++}${ext}`
    }
    const dest = join(dir, candidate)
    await fs.copyFile(sourcePath, dest)
    return dest
  }

  async listFiles(project: string): Promise<string[]> {
    const dir = this.filesDir(project)
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  }

  async projectFilePath(project: string, fileName: string): Promise<string | null> {
    const base = basename(fileName)
    if (base !== fileName) return null
    const full = join(this.filesDir(project), base)
    return (await this.pathExists(full)) ? full : null
  }

  // ---- Module run storage (JSON kept in <project>/.data/modules/, out of the # file picker) ----

  private moduleTempPath(project: string, runId: string): string {
    return join(this.modulesDir(project), `${validateNoteId(runId)}.json`)
  }

  private modulePromptPath(project: string, runId: string): string {
    return join(this.modulesDir(project), `${validateNoteId(runId)}.prompt.json`)
  }

  private moduleChatPath(project: string, runId: string): string {
    return join(this.modulesDir(project), `${validateNoteId(runId)}.chat.json`)
  }

  async writeModulePrompt(
    project: string,
    runId: string,
    prompt: { runId: string; module: ModuleInfo; title: string; prompt: string }
  ): Promise<void> {
    const dir = this.modulesDir(project)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      this.modulePromptPath(project, runId),
      JSON.stringify(prompt, null, 2),
      'utf8'
    )
  }

  async writeModuleRun(project: string, runId: string, run: ModuleRun): Promise<void> {
    const dir = this.modulesDir(project)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(this.moduleTempPath(project, runId), JSON.stringify(run, null, 2), 'utf8')
  }

  /** Persist a module run's subagent conversation transcript. */
  async writeModuleChat(
    project: string,
    runId: string,
    messages: ModuleChatMessage[]
  ): Promise<void> {
    const dir = this.modulesDir(project)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      this.moduleChatPath(project, runId),
      JSON.stringify(messages, null, 2),
      'utf8'
    )
  }

  /** Read a persisted module run transcript; returns [] on missing/corrupt file. */
  async readModuleChat(project: string, runId: string): Promise<ModuleChatMessage[]> {
    try {
      const raw = await fs.readFile(this.moduleChatPath(project, runId), 'utf8')
      const messages = JSON.parse(raw)
      if (!Array.isArray(messages)) return []
      return messages.filter(
        (m): m is ModuleChatMessage =>
          !!m && typeof m === 'object' && ['system', 'user', 'assistant', 'tool'].includes(m.role)
      )
    } catch {
      return []
    }
  }

  // ---- Module raw AI trace (<project>/.data/modules/<runId>.trace.jsonl, append-only) ----

  moduleTracePath(project: string, runId: string): string {
    return join(this.modulesDir(project), `${validateNoteId(runId)}.trace.jsonl`)
  }

  legacyModuleTracePath(project: string, runId: string): string {
    return join(this.modulesDir(project), `${validateNoteId(runId)}.trace.json`)
  }

  async appendModuleTrace(
    project: string,
    runId: string,
    header: AiTraceHeader,
    lines: string[]
  ): Promise<void> {
    await fs.mkdir(this.modulesDir(project), { recursive: true })
    await appendTraceFile(
      this.moduleTracePath(project, runId),
      this.legacyModuleTracePath(project, runId),
      header,
      lines
    )
  }

  async readModuleTrace(project: string, runId: string): Promise<AiTraceFile | null> {
    return readTraceFile(
      this.moduleTracePath(project, runId),
      this.legacyModuleTracePath(project, runId)
    )
  }

  async deleteModuleTrace(project: string, runId: string): Promise<void> {
    await fs.unlink(this.moduleTracePath(project, runId)).catch(() => {})
    await fs.unlink(this.legacyModuleTracePath(project, runId)).catch(() => {})
  }

  /** Read all persisted run snapshots for a project (used to list history across restarts). */
  async listStoredModuleRuns(project: string): Promise<ModuleRun[]> {
    const dir = this.modulesDir(project)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return []
    }
    const runs: ModuleRun[] = []
    for (const entry of entries) {
      if (
        !entry.endsWith('.json') ||
        entry.endsWith('.prompt.json') ||
        entry.endsWith('.trace.json')
      )
        continue
      try {
        const run = JSON.parse(await fs.readFile(join(dir, entry), 'utf8')) as ModuleRun
        if (run && typeof run.runId === 'string' && Array.isArray(run.steps)) {
          runs.push(run)
        }
      } catch {
        // skip corrupt run file
      }
    }
    runs.sort((a, b) => b.updatedAt - a.updatedAt)
    return runs
  }

  /**
   * Delete persisted run files whose status is terminal (history). Active
   * runs stay. Optionally also delete each removed run's output file (only if
   * it lives inside the project). Returns the number of runs removed.
   */
  async clearModuleHistoryRuns(
    project: string,
    excludeActive: string[],
    deleteOutputFiles = false
  ): Promise<number> {
    const active = new Set(excludeActive)
    const dir = this.modulesDir(project)
    const outputDir = this.filesDir(project)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return 0
    }
    let removed = 0
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const full = join(dir, entry)
      let run: ModuleRun
      try {
        run = JSON.parse(await fs.readFile(full, 'utf8')) as ModuleRun
      } catch {
        continue
      }
      if (!run || typeof run.runId !== 'string' || active.has(run.runId)) continue
      if (run.runId !== validateNoteId(run.runId)) continue
      if (deleteOutputFiles) {
        const prefix = outputDir + sep
        for (const out of outputFilesOf(run)) {
          if (out.startsWith(prefix)) await fs.rm(out, { force: true })
        }
      }
      await fs.rm(full, { force: true })
      const prompt = join(dir, `${run.runId}.prompt.json`)
      await fs.rm(prompt, { force: true })
      const chat = join(dir, `${run.runId}.chat.json`)
      await fs.rm(chat, { force: true })
      const trace = join(dir, `${run.runId}.trace.jsonl`)
      await fs.rm(trace, { force: true })
      const legacyTrace = join(dir, `${run.runId}.trace.json`)
      await fs.rm(legacyTrace, { force: true })
      removed++
    }
    return removed
  }

  /**
   * Delete a single module run (history) and its prompt file. Optionally also
   * delete its output file (only if it lives inside the project). Returns true
   * if a run file was removed.
   */
  async deleteModuleRun(
    project: string,
    runId: string,
    deleteOutputFiles = false
  ): Promise<boolean> {
    const runPath = this.moduleTempPath(project, runId)
    const existed = await fs
      .access(runPath)
      .then(() => true)
      .catch(() => false)
    let run: ModuleRun | undefined
    if (existed) {
      try {
        run = JSON.parse(await fs.readFile(runPath, 'utf8')) as ModuleRun
      } catch {
        run = undefined
      }
      if (deleteOutputFiles) {
        const outputDir = this.filesDir(project)
        const prefix = outputDir + sep
        for (const out of outputFilesOf(run)) {
          if (out.startsWith(prefix)) await fs.rm(out, { force: true })
        }
      }
    }
    const prompt = this.modulePromptPath(project, runId)
    await fs.rm(prompt, { force: true })
    const chat = this.moduleChatPath(project, runId)
    await fs.rm(chat, { force: true })
    const trace = this.moduleTracePath(project, runId)
    await fs.rm(trace, { force: true })
    const legacyTrace = this.legacyModuleTracePath(project, runId)
    await fs.rm(legacyTrace, { force: true })
    await fs.rm(runPath, { force: true })
    return existed
  }

  /** Pick a non-colliding, safe path in <project>/files/ for a generated output file. */
  async uniqueOutputPath(project: string, fileName: string): Promise<string> {
    const dir = this.filesDir(project)
    await fs.mkdir(dir, { recursive: true })
    const original = basename(fileName).trim()
    if (!original) throw new Error('Output file name is empty')
    const ext = extname(original)
    const stem = ext ? original.slice(0, -ext.length) : original
    const base = slugify(stem)
    let candidate = `${base}${ext}`
    let i = 2
    while (await this.pathExists(join(dir, candidate))) {
      candidate = `${base}-${i++}${ext}`
    }
    return join(dir, candidate)
  }

  // ---- Temporary module output (<project>/.data/modules/temp/) ----

  /** Directory for temporary module/shared tool files, kept out of the # file picker. */
  moduleTempDir(project: string): string {
    return join(this.modulesDir(project), 'temp')
  }

  /** Pick a non-colliding, safe temp path inside <project>/.data/modules/temp/. */
  async uniqueModuleTempPath(project: string, fileName: string): Promise<string> {
    const dir = this.moduleTempDir(project)
    await fs.mkdir(dir, { recursive: true })
    const original = basename(fileName).trim()
    if (!original) throw new Error('Temp file name is empty')
    const ext = extname(original)
    const stem = ext ? original.slice(0, -ext.length) : original
    const base = slugify(stem) || 'temp'
    let candidate = `${base}${ext}`
    let i = 2
    while (await this.pathExists(join(dir, candidate))) {
      candidate = `${base}-${i++}${ext}`
    }
    return join(dir, candidate)
  }

  /**
   * Delete temp module files (PNG + its sibling .json/.svg) after a presentation
   * has embedded them. Only removes files inside <project>/.data/modules/temp/.
   */
  async cleanupModuleTempFiles(project: string, pngPaths: string[]): Promise<number> {
    const prefix = this.moduleTempDir(project) + sep
    let removed = 0
    const seen = new Set<string>()
    for (const p of pngPaths) {
      if (typeof p !== 'string' || !p.startsWith(prefix)) continue
      const siblings = [p, p.replace(/\.png$/i, '.json'), p.replace(/\.png$/i, '.svg')]
      for (const f of siblings) {
        if (seen.has(f)) continue
        seen.add(f)
        try {
          await fs.unlink(f)
          removed++
        } catch {
          // ignore missing/already-removed files
        }
      }
    }
    return removed
  }

  private async uniqueNoteId(project: string, base: string, exclude?: string): Promise<string> {
    let candidate = base
    let i = 2
    while (true) {
      if (candidate === exclude) return candidate
      const exists = await fs
        .access(this.notePath(project, candidate))
        .then(() => true)
        .catch(() => false)
      if (!exists) return candidate
      candidate = `${base}-${i++}`
    }
  }

  private async scheduleIdExists(project: string, id: string): Promise<boolean> {
    return this.pathExists(this.schedulePath(project, id))
  }

  // ---- Planner (project schedules) ----

  async listSchedules(project: string): Promise<ScheduleMeta[]> {
    const dir = this.plannerDir(project)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return []
    }
    const schedules: ScheduleMeta[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry === 'calendar.json') continue
      const id = entry.slice(0, -5)
      let meta: { name: string; updatedAt: number; taskCount: number } | null = null
      try {
        const schedule = JSON.parse(await fs.readFile(join(dir, entry), 'utf8')) as Schedule
        if (!schedule || typeof schedule.id !== 'string') throw new Error('Invalid schedule')
        meta = {
          name: schedule.name?.trim() || id,
          updatedAt: schedule.updatedAt ?? 0,
          taskCount: Array.isArray(schedule.tasks)
            ? schedule.tasks.reduce((n, t) => n + countTasks(t), 0)
            : 0
        }
      } catch {
        // ignore corrupt file
      }
      schedules.push({
        id,
        name: meta?.name ?? id,
        updatedAt: meta?.updatedAt ?? 0,
        taskCount: meta?.taskCount ?? 0
      })
    }
    schedules.sort((a, b) => a.name.localeCompare(b.name))
    return schedules
  }

  async readSchedule(project: string, id: string): Promise<Schedule | null> {
    try {
      const schedule = JSON.parse(
        await fs.readFile(this.schedulePath(project, id), 'utf8')
      ) as Schedule
      if (!schedule || typeof schedule.id !== 'string' || !Array.isArray(schedule.tasks)) {
        throw new Error('Invalid schedule')
      }
      return schedule
    } catch {
      return null
    }
  }

  async saveSchedule(project: string, schedule: Schedule): Promise<void> {
    if (!schedule || typeof schedule.id !== 'string') throw new Error('Invalid schedule')
    const dir = this.plannerDir(project)
    await fs.mkdir(dir, { recursive: true })
    const path = this.schedulePath(project, schedule.id)
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, JSON.stringify(schedule, null, 2), 'utf8')
    await fs.rename(tmp, path)
  }

  async createSchedule(project: string, name: string): Promise<ScheduleMeta> {
    const base = slugify(name) || 'untitled'
    if (await this.scheduleIdExists(project, base)) {
      throw new Error(`A schedule with the name "${name.trim()}" already exists`)
    }
    const id = base
    const now = Date.now()
    const display = name.trim() || base
    const schedule: Schedule = { id, name: display, createdAt: now, updatedAt: now, tasks: [] }
    await this.saveSchedule(project, schedule)
    return { id, name: display, updatedAt: now, taskCount: 0 }
  }

  async renameSchedule(project: string, id: string, newName: string): Promise<ScheduleMeta> {
    const schedule = await this.readSchedule(project, id)
    if (!schedule) throw new Error(`Schedule "${id}" not found`)
    const trimmed = newName.trim()
    if (trimmed) schedule.name = trimmed
    const newId = slugify(schedule.name)
    if (newId !== id && (await this.scheduleIdExists(project, newId))) {
      throw new Error(
        `A schedule with the name "${schedule.name}" already exists (file ${newId}.json)`
      )
    }
    schedule.id = newId
    schedule.updatedAt = Date.now()
    if (newId === id) {
      await this.saveSchedule(project, schedule)
    } else {
      const dir = this.plannerDir(project)
      await fs.mkdir(dir, { recursive: true })
      const path = this.schedulePath(project, newId)
      const tmp = `${path}.tmp`
      await fs.writeFile(tmp, JSON.stringify(schedule, null, 2), 'utf8')
      await fs.rename(tmp, path)
      await fs.unlink(this.schedulePath(project, id)).catch(() => {})
    }
    return {
      id: newId,
      name: schedule.name,
      updatedAt: schedule.updatedAt,
      taskCount: schedule.tasks.reduce((n, t) => n + countTasks(t), 0)
    }
  }

  async deleteSchedule(project: string, id: string): Promise<void> {
    await fs.unlink(this.schedulePath(project, id)).catch(() => {})
  }

  // ---- Calendar (shared project working-day config) ----

  async readCalendar(project: string): Promise<ProjectCalendar> {
    try {
      const calendar = JSON.parse(
        await fs.readFile(this.calendarPath(project), 'utf8')
      ) as ProjectCalendar
      return normalizeCalendar(calendar)
    } catch {
      return defaultCalendar()
    }
  }

  async saveCalendar(project: string, calendar: ProjectCalendar): Promise<void> {
    const dir = this.plannerDir(project)
    await fs.mkdir(dir, { recursive: true })
    const normalized = normalizeCalendar(calendar)
    const path = this.calendarPath(project)
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf8')
    await fs.rename(tmp, path)
  }

  // ---- Kanban ----

  async loadKanban(project: string): Promise<KanbanBoard> {
    const path = this.kanbanPath(project)
    if (await this.pathExists(path)) {
      try {
        const raw = await fs.readFile(path, 'utf8')
        return normalizeBoard(JSON.parse(raw))
      } catch {
        return normalizeBoard(undefined)
      }
    }
    const legacyTodoPath = join(this.projectDir(project), 'TODO.md')
    if (await this.pathExists(legacyTodoPath)) {
      const board = await this.migrateTodoFile(legacyTodoPath)
      await this.saveKanban(project, board)
      await fs.unlink(legacyTodoPath).catch(() => {})
      return board
    }
    return defaultBoard()
  }

  async saveKanban(project: string, board: KanbanBoard): Promise<KanbanBoard> {
    const normalized = normalizeBoard(board)
    const dir = this.kanbanDir(project)
    await fs.mkdir(dir, { recursive: true })
    const path = this.kanbanPath(project)
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf8')
    await fs.rename(tmp, path)
    return normalized
  }

  async createKanbanCard(project: string, input: NewKanbanCardInput): Promise<KanbanBoard> {
    const board = await this.loadKanban(project)
    const title = (input.title ?? '').trim()
    if (!title) throw new Error('Card title is required')
    const column = input.column?.trim() ? findColumnByName(board, input.column) : undefined
    const columnId = column?.id ?? board.columns[0].id
    if (!board.columns.some((c) => c.id === columnId)) {
      throw new Error(`Column "${input.column}" not found`)
    }
    const now = Date.now()
    const card: KanbanCard = {
      id: newCardId(),
      title,
      description: (input.description ?? '').trim(),
      comments: [],
      columnId,
      priority: input.priority ?? null,
      labels: (input.labels ?? []).map((l) => l.trim()).filter(Boolean),
      dueDate: input.dueDate ?? null,
      storyPoints: input.storyPoints ?? null,
      assignee: (input.assignee ?? '').trim(),
      attributes: input.attributes ?? {},
      secretAttributes: (input.secretAttributes ?? []).filter((k) => k in (input.attributes ?? {})),
      createdAt: now,
      updatedAt: now
    }
    board.cards.push(card)
    return this.saveKanban(project, board)
  }

  async updateKanbanCard(
    project: string,
    cardId: string,
    patch: KanbanCardPatch
  ): Promise<KanbanBoard> {
    const board = await this.loadKanban(project)
    const card = board.cards.find((c) => c.id === cardId)
    if (!card) throw new Error(`Card "${cardId}" not found`)
    if (patch.title !== undefined) {
      const title = patch.title.trim()
      if (!title) throw new Error('Card title cannot be empty')
      card.title = title
    }
    if (patch.description !== undefined) card.description = patch.description.trim()
    if (patch.columnId !== undefined) {
      if (!board.columns.some((c) => c.id === patch.columnId)) {
        throw new Error(`Column "${patch.columnId}" not found`)
      }
      card.columnId = patch.columnId
    }
    if (patch.priority !== undefined) card.priority = patch.priority
    if (patch.labels !== undefined) {
      card.labels = patch.labels.map((l) => l.trim()).filter(Boolean)
    }
    if (patch.dueDate !== undefined) card.dueDate = patch.dueDate
    if (patch.storyPoints !== undefined) card.storyPoints = patch.storyPoints
    if (patch.assignee !== undefined) card.assignee = patch.assignee.trim()
    if (patch.attributes !== undefined) card.attributes = patch.attributes
    if (patch.secretAttributes !== undefined) {
      card.secretAttributes = patch.secretAttributes.filter((k) => k in card.attributes)
    }
    card.updatedAt = Date.now()
    return this.saveKanban(project, board)
  }

  async moveKanbanCard(
    project: string,
    cardId: string,
    columnId: string,
    index?: number
  ): Promise<KanbanBoard> {
    const board = await this.loadKanban(project)
    const card = board.cards.find((c) => c.id === cardId)
    if (!card) throw new Error(`Card "${cardId}" not found`)
    if (!board.columns.some((c) => c.id === columnId)) {
      throw new Error(`Column "${columnId}" not found`)
    }
    board.cards = board.cards.filter((c) => c.id !== cardId)
    card.columnId = columnId
    card.updatedAt = Date.now()
    const inColumn = board.cards.filter((c) => c.columnId === columnId)
    const at = index === undefined ? inColumn.length : Math.max(0, Math.min(index, inColumn.length))
    if (at >= inColumn.length) {
      board.cards.push(card)
    } else {
      const anchor = inColumn[at]
      const globalIndex = board.cards.findIndex((c) => c.id === anchor.id)
      board.cards.splice(globalIndex, 0, card)
    }
    return this.saveKanban(project, board)
  }

  async deleteKanbanCard(project: string, cardId: string): Promise<KanbanBoard> {
    const board = await this.loadKanban(project)
    const next = board.cards.filter((c) => c.id !== cardId)
    if (next.length === board.cards.length) throw new Error(`Card "${cardId}" not found`)
    board.cards = next
    return this.saveKanban(project, board)
  }

  async loadKanbanArchive(project: string): Promise<KanbanArchive> {
    const path = this.kanbanArchivePath(project)
    if (!(await this.pathExists(path))) return defaultArchive()
    try {
      const raw = await fs.readFile(path, 'utf8')
      return normalizeArchive(JSON.parse(raw))
    } catch {
      return normalizeArchive(undefined)
    }
  }

  async saveKanbanArchive(project: string, archive: KanbanArchive): Promise<KanbanArchive> {
    const normalized = normalizeArchive(archive)
    const dir = this.kanbanDir(project)
    await fs.mkdir(dir, { recursive: true })
    const path = this.kanbanArchivePath(project)
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf8')
    await fs.rename(tmp, path)
    return normalized
  }

  async archiveKanbanCard(project: string, cardId: string): Promise<KanbanArchiveMove> {
    const board = await this.loadKanban(project)
    const card = board.cards.find((c) => c.id === cardId)
    if (!card) throw new Error(`Card "${cardId}" not found`)
    const archive = await this.loadKanbanArchive(project)
    if (archive.cards.some((c) => c.id === cardId)) {
      throw new Error(`Card "${cardId}" is already archived`)
    }
    board.cards = board.cards.filter((c) => c.id !== cardId)
    archive.cards.push(card)
    await this.saveKanban(project, board)
    await this.saveKanbanArchive(project, archive)
    return { board, archive }
  }

  async restoreKanbanCard(project: string, cardId: string): Promise<KanbanArchiveMove> {
    const archive = await this.loadKanbanArchive(project)
    const card = archive.cards.find((c) => c.id === cardId)
    if (!card) throw new Error(`Archived card "${cardId}" not found`)
    const board = await this.loadKanban(project)
    if (board.cards.some((c) => c.id === cardId)) {
      throw new Error(`Card "${cardId}" already exists on the board`)
    }
    archive.cards = archive.cards.filter((c) => c.id !== cardId)
    if (!board.columns.some((c) => c.id === card.columnId)) {
      card.columnId = board.columns[0].id
    }
    card.updatedAt = Date.now()
    board.cards.push(card)
    await this.saveKanban(project, board)
    await this.saveKanbanArchive(project, archive)
    return { board, archive }
  }

  async deleteArchivedKanbanCard(project: string, cardId: string): Promise<KanbanArchive> {
    const archive = await this.loadKanbanArchive(project)
    const next = archive.cards.filter((c) => c.id !== cardId)
    if (next.length === archive.cards.length) {
      throw new Error(`Archived card "${cardId}" not found`)
    }
    archive.cards = next
    return this.saveKanbanArchive(project, archive)
  }

  private async migrateTodoFile(todoPath: string): Promise<KanbanBoard> {
    const board = defaultBoard()
    const toDoId = board.columns.find((c) => c.id === 'to-do')?.id ?? board.columns[0].id
    const doneId = board.columns.find((c) => c.id === 'done')?.id ?? board.columns[0].id
    const content = await fs.readFile(todoPath, 'utf8').catch(() => '')
    const now = Date.now()
    for (const line of content.split('\n')) {
      const m = line.match(/^(\s*)([-*+]) \[([ xX])\] (.+)$/)
      if (!m) continue
      const title = m[4].trim()
      if (!title) continue
      board.cards.push({
        id: newCardId(),
        title,
        description: '',
        comments: [],
        columnId: m[3].toLowerCase() === 'x' ? doneId : toDoId,
        priority: null,
        labels: [],
        dueDate: null,
        storyPoints: null,
        assignee: '',
        attributes: {},
        secretAttributes: [],
        createdAt: now,
        updatedAt: now
      })
    }
    return board
  }
}
function validateProjectName(name: string): string {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`Invalid project name: ${name}`)
  }
  return name.trim()
}

function validateNoteId(id: string): string {
  if (!id || id === '.' || id === '..' || id.includes('/') || id.includes('\\')) {
    throw new Error(`Invalid note id: ${id}`)
  }
  return id
}

/** All output files of a run: the `outputFiles` list, or the legacy `outputFile`. */
function outputFilesOf(run: ModuleRun | undefined): string[] {
  if (!run) return []
  if (Array.isArray(run.outputFiles) && run.outputFiles.length > 0) return run.outputFiles
  return run.outputFile ? [run.outputFile] : []
}

/** Parse the one-line `description:` front-matter of a skill markdown file (OpenAI skill-guide format). */
function parseSkillDescription(raw: string): string {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (!m) return ''
  const line = m[1].split('\n').find((l) => /^description\s*:/i.test(l))
  return line ? line.replace(/^description\s*:\s*/i, '').trim() : ''
}

/** Strip the `description:` front-matter block, returning just the body content. */
function stripSkillFrontMatter(raw: string): string {
  const m = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?/)
  return m ? raw.slice(m[0].length) : raw
}

/** Parse the optional `enabled:` front-matter line; missing = enabled. */
function parseSkillEnabled(raw: string): boolean {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (!m) return true
  const line = m[1].split('\n').find((l) => /^enabled\s*:/i.test(l))
  if (!line) return true
  const v = line
    .replace(/^enabled\s*:\s*/i, '')
    .trim()
    .toLowerCase()
  return v !== 'false' && v !== '0' && v !== 'no'
}

/** Serialize a skill to markdown using the OpenAI skill-guide front-matter (`name` + `description` + `enabled`). */
function renderSkillFile(
  name: string,
  description: string,
  content: string,
  enabled = true
): string {
  const desc = (description || '').trim().replace(/\s*\n+\s*/g, ' ')
  const body = (content || '').trim()
  return `---\nname: ${name}\ndescription: ${desc}\nenabled: ${enabled}\n---\n\n${body}${body ? '\n' : ''}`
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep)
}

/**
 * Recursively merge the contents of `src` into `dst` (both directories).
 * Directories are merged recursively; on a leaf-file collision both are kept —
 * the incoming file gets a `-2` (then `-3`, …) suffix, matching the codebase's
 * collision pattern. `dst` must already exist.
 */
async function mergeDir(src: string, dst: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const from = join(src, entry.name)
    const to = join(dst, entry.name)
    if (entry.isDirectory()) {
      if (await pathExists(to)) {
        const toStat = await fs.stat(to)
        if (!toStat.isDirectory()) await fs.unlink(to)
      }
      await fs.mkdir(to, { recursive: true })
      await mergeDir(from, to)
    } else if (entry.isSymbolicLink()) {
      await fs.unlink(to).catch(() => {})
      await fs.rename(from, to)
    } else {
      let candidate = to
      const ext = extname(entry.name)
      const stem = ext ? entry.name.slice(0, -ext.length) : entry.name
      let i = 2
      while (await pathExists(candidate)) {
        candidate = join(dst, `${stem}-${i++}${ext}`)
      }
      await fs.rename(from, candidate)
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  return fs
    .access(path)
    .then(() => true)
    .catch(() => false)
}

/** Append JSONL lines to a trace file, writing the header record first when the file is
 *  new. A legacy single-JSON trace is migrated to JSONL first so its entries are not lost. */
async function appendTraceFile(
  path: string,
  legacyPath: string,
  header: AiTraceHeader,
  lines: string[]
): Promise<void> {
  if (lines.length === 0) return
  let prefix = ''
  try {
    await fs.access(path)
  } catch {
    // new file — carry over a legacy single-JSON trace if one exists
    let legacyRaw: string | null = null
    try {
      legacyRaw = await fs.readFile(legacyPath, 'utf8')
    } catch {
      legacyRaw = null
    }
    if (legacyRaw !== null) {
      try {
        const legacy = JSON.parse(legacyRaw) as AiTraceFile
        if (legacy && typeof legacy.key === 'string' && Array.isArray(legacy.entries)) {
          const trace: AiTraceFile = {
            project: legacy.project,
            key: legacy.key,
            kind: legacy.kind,
            startedAt: legacy.startedAt,
            updatedAt: legacy.updatedAt,
            entries: legacy.entries
          }
          await fs.writeFile(path, traceToJsonl(trace), 'utf8')
          await fs.unlink(legacyPath).catch(() => {})
          await fs.access(path)
        }
      } catch {
        // corrupt legacy file — start fresh
      }
    }
    try {
      await fs.access(path)
    } catch {
      prefix = `${JSON.stringify(header)}\n`
    }
  }
  await fs.appendFile(path, prefix + lines.join('\n') + '\n', 'utf8')
}

/** Count the entry records in a (possibly legacy) trace file and report whether a
 *  `system` entry already exists — keeps `seq` monotonic and the system prompt traced
 *  once per file. */
async function traceMeta(
  path: string,
  legacyPath: string
): Promise<{ count: number; hasSystem: boolean }> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    let count = 0
    let hasSystem = false
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      count++
      if (hasSystem) continue
      try {
        if ((JSON.parse(line) as AiTraceEntry).role === 'system') hasSystem = true
      } catch {
        // skip a corrupt line
      }
    }
    return { count: Math.max(0, count - 1), hasSystem }
  } catch {
    // no JSONL file yet — fall back to a legacy single-JSON trace
  }
  try {
    const legacy = JSON.parse(await fs.readFile(legacyPath, 'utf8')) as AiTraceFile
    const entries = Array.isArray(legacy?.entries) ? legacy.entries : []
    return { count: entries.length, hasSystem: entries.some((e) => e.role === 'system') }
  } catch {
    return { count: 0, hasSystem: false }
  }
}

/** Read a persisted JSONL trace file, populating its `path`. A legacy single-JSON trace
 *  is migrated to JSONL on first read. Returns null on missing/corrupt file. */
async function readTraceFile(path: string, legacyPath: string): Promise<AiTraceFile | null> {
  let raw: string | null = null
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch {
    raw = null
  }
  if (raw !== null) {
    const trace = parseTraceJsonl(raw)
    if (!trace) return null
    trace.path = path
    return trace
  }
  try {
    const legacy = JSON.parse(await fs.readFile(legacyPath, 'utf8')) as AiTraceFile
    if (!legacy || typeof legacy.key !== 'string' || !Array.isArray(legacy.entries)) return null
    const trace: AiTraceFile = {
      project: legacy.project,
      key: legacy.key,
      kind: legacy.kind,
      startedAt: legacy.startedAt,
      updatedAt: legacy.updatedAt,
      entries: legacy.entries
    }
    await fs
      .writeFile(path, traceToJsonl(trace), 'utf8')
      .then(() => fs.unlink(legacyPath).catch(() => {}))
      .catch(() => {})
    trace.path = path
    return trace
  } catch {
    return null
  }
}

/** Parse a JSONL trace: the header record first, then one record per line. */
function parseTraceJsonl(raw: string): AiTraceFile | null {
  const lines = raw.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return null
  let header: AiTraceHeader
  try {
    const first = JSON.parse(lines[0]!) as AiTraceHeader
    if (!first || first.type !== 'header' || typeof first.key !== 'string') return null
    header = first
  } catch {
    return null
  }
  const entries: AiTraceEntry[] = []
  for (let i = 1; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]!) as AiTraceEntry
      if (entry && typeof entry.role === 'string') entries.push(entry)
    } catch {
      // skip a corrupt line
    }
  }
  const last = entries[entries.length - 1]
  return {
    project: header.project,
    key: header.key,
    kind: header.kind,
    startedAt: header.startedAt,
    updatedAt: last ? last.ts : header.startedAt,
    entries
  }
}

/** Serialize a trace to JSONL: the header record first, then one record per line. */
function traceToJsonl(trace: AiTraceFile): string {
  const header: AiTraceHeader = {
    type: 'header',
    project: trace.project,
    key: trace.key,
    kind: trace.kind,
    startedAt: trace.startedAt
  }
  return [JSON.stringify(header), ...trace.entries.map((e) => JSON.stringify(e))].join('\n') + '\n'
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await fs.readFile(path))
  return hash.digest('hex')
}

function deriveTitle(thread: ChatThread): string {
  const firstUser = thread.messages.find((m) => m.role === 'user')
  if (!firstUser) return 'Untitled chat'
  const clean = firstUser.content.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Untitled chat'
  const words = clean.split(' ')
  const sliced = words.slice(0, 8).join(' ')
  return sliced.length > 60 ? `${sliced.slice(0, 60).trimEnd()}…` : sliced
}
