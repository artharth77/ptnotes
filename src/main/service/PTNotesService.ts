import { promises as fs } from 'fs'
import { join } from 'path'
import { app, shell } from 'electron'
import type {
  ChatSessionMeta,
  ChatThread,
  CreateProjectResult,
  NoteMeta,
  Project,
  Todo
} from '@shared/types'
import { slugify } from '../utils/slug'

const TODO_HEADER = '# Todo\n\n'
const WELCOME_ID = 'welcome'
const WELCOME_NOTE = `# Welcome to PTNotes

This is your first note. Everything you write here is stored as markdown in:

\`notes/welcome.md\`

## Getting started

- Click **+ New** in the **Notes** tab to create a new note.
- Use the **Todo** tab to keep track of your tasks.
- Open the **AI assistant** (💬 chat icon, top-right) to create or update notes and todos, or research the web and save the findings here.
`

export class PTNotesService {
  private readonly rootDir: string

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? join(app.getPath('documents'), 'PTNotes')
  }

  get root(): string {
    return this.rootDir
  }

  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true })
  }

  private projectDir(name: string): string {
    return join(this.rootDir, validateProjectName(name))
  }

  private notesDir(name: string): string {
    return join(this.projectDir(name), 'notes')
  }

  private chatDir(name: string): string {
    return join(this.projectDir(name), 'chat')
  }

  private chatPath(project: string, sessionId: string): string {
    return join(this.chatDir(project), `${validateNoteId(sessionId)}.json`)
  }

  private notePath(project: string, noteId: string): string {
    return join(this.notesDir(project), `${validateNoteId(noteId)}.md`)
  }

  private todoPath(project: string): string {
    return join(this.projectDir(project), 'TODO.md')
  }

  private registryPath(): string {
    return join(this.rootDir, '.ptnotes-projects.json')
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
    await fs.writeFile(this.todoPath(name), TODO_HEADER, 'utf8')
    await fs.writeFile(this.notePath(name, WELCOME_ID), WELCOME_NOTE, 'utf8')
    await this.addToRegistry(name)
    return { name, path: dir, noteCount: 1, pathExists: true, welcomeCreated: true }
  }

  async recreateProject(name: string): Promise<CreateProjectResult> {
    await this.ensureRoot()
    const dir = this.projectDir(name)
    await fs.mkdir(join(dir, 'notes'), { recursive: true })
    if (!(await this.pathExists(this.todoPath(name)))) {
      await fs.writeFile(this.todoPath(name), TODO_HEADER, 'utf8')
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
      if (!entry.endsWith('.json')) continue
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
  }

  async deleteProjectChatDir(project: string): Promise<void> {
    await fs.rm(this.chatDir(project), { recursive: true, force: true })
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

  // ---- Todos ----

  async listTodos(project: string): Promise<Todo[]> {
    const { todos } = await this.parseTodoFile(project)
    return todos
  }

  async addTodos(project: string, texts: string[]): Promise<Todo[]> {
    const clean = texts.map((t) => t.trim()).filter(Boolean)
    if (clean.length === 0) return this.listTodos(project)
    const content = await fs.readFile(this.todoPath(project), 'utf8').catch(() => TODO_HEADER)
    const additions = clean.map((t) => `- [ ] ${t}`).join('\n')
    const next = content.endsWith('\n')
      ? content + additions + '\n'
      : content + '\n' + additions + '\n'
    await fs.writeFile(this.todoPath(project), next, 'utf8')
    return this.listTodos(project)
  }

  async toggleTodo(project: string, id: string): Promise<Todo[]> {
    await this.mutateTodoLine(project, id, (line) => {
      return line.replace(/\[([ xX])\]/i, () => {
        return /\[x\]/i.test(line) ? '[ ]' : '[x]'
      })
    })
    return this.listTodos(project)
  }

  async deleteTodo(project: string, id: string): Promise<Todo[]> {
    const content = await fs.readFile(this.todoPath(project), 'utf8')
    const lines = content.split('\n')
    const { idToLine } = this.parseTodoLines(lines)
    const lineIndex = idToLine.get(id)
    if (lineIndex !== undefined) {
      lines.splice(lineIndex, 1)
      await fs.writeFile(this.todoPath(project), lines.join('\n'), 'utf8')
    }
    return this.listTodos(project)
  }

  async deleteCompletedTodos(project: string): Promise<Todo[]> {
    const content = await fs.readFile(this.todoPath(project), 'utf8')
    const lines = content.split('\n')
    const next = lines.filter((line) => !/^(\s*)([-*+])\s*\[x\]\s+/i.test(line))
    if (next.length !== lines.length) {
      await fs.writeFile(this.todoPath(project), next.join('\n'), 'utf8')
    }
    return this.listTodos(project)
  }

  async updateTodo(project: string, id: string, text: string): Promise<Todo[]> {
    await this.mutateTodoLine(project, id, (line) => line.replace(/(\[[ xX]\]\s+).+$/, `$1${text}`))
    return this.listTodos(project)
  }

  async reorderTodos(project: string, orderedIds: string[]): Promise<Todo[]> {
    const content = await fs.readFile(this.todoPath(project), 'utf8')
    const lines = content.split('\n')
    const { idToLine } = this.parseTodoLines(lines)
    if (orderedIds.length !== idToLine.size) return this.listTodos(project)
    const lineById = new Map<string, string>()
    for (const [id, i] of idToLine) lineById.set(id, lines[i])
    const slots = [...idToLine.values()].sort((a, b) => a - b)
    const next = [...lines]
    orderedIds.forEach((id, k) => {
      const line = lineById.get(id)
      const slot = slots[k]
      if (line !== undefined && slot !== undefined) next[slot] = line
    })
    await fs.writeFile(this.todoPath(project), next.join('\n'), 'utf8')
    return this.listTodos(project)
  }

  private async mutateTodoLine(
    project: string,
    id: string,
    fn: (line: string) => string
  ): Promise<void> {
    const content = await fs.readFile(this.todoPath(project), 'utf8')
    const lines = content.split('\n')
    const { idToLine } = this.parseTodoLines(lines)
    const lineIndex = idToLine.get(id)
    if (lineIndex !== undefined) {
      lines[lineIndex] = fn(lines[lineIndex])
      await fs.writeFile(this.todoPath(project), lines.join('\n'), 'utf8')
    }
  }

  private parseTodoLines(lines: string[]): { todos: Todo[]; idToLine: Map<string, number> } {
    const todos: Todo[] = []
    const idToLine = new Map<string, number>()
    const occurrences = new Map<string, number>()
    lines.forEach((line, i) => {
      const m = line.match(/^(\s*)([-*+]) \[([ xX])\] (.+)$/)
      if (!m) return
      const text = m[4].trim()
      const key = text.toLowerCase()
      const occ = (occurrences.get(key) ?? 0) + 1
      occurrences.set(key, occ)
      const id = `${key}|${occ}`
      todos.push({ id, text, done: m[3].toLowerCase() === 'x' })
      idToLine.set(id, i)
    })
    return { todos, idToLine }
  }

  private async parseTodoFile(
    project: string
  ): Promise<{ todos: Todo[]; idToLine: Map<string, number> }> {
    const content = await fs.readFile(this.todoPath(project), 'utf8').catch(() => TODO_HEADER)
    return this.parseTodoLines(content.split('\n'))
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

function deriveTitle(thread: ChatThread): string {
  const firstUser = thread.messages.find((m) => m.role === 'user')
  if (!firstUser) return 'Untitled chat'
  const clean = firstUser.content.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Untitled chat'
  const words = clean.split(' ')
  const sliced = words.slice(0, 8).join(' ')
  return sliced.length > 60 ? `${sliced.slice(0, 60).trimEnd()}…` : sliced
}
