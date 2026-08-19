import type { PTNotesService } from '../service/PTNotesService'
import { duckDuckGoSearch } from './search/duckduckgo'
import { fetchWebPage } from './search/webFetch'
import { slugify } from '@shared/slug'
import { readFileAsText } from './reader'
import {
  applyDateRule,
  computeDuration,
  computeEndDate,
  countTasks,
  deriveTaskNo,
  emptyTask,
  findTaskByTitle,
  rollupScheduleTasks
} from '@shared/planner'
import type {
  AskAnswer,
  AskQuestion,
  AskRequest,
  ConfirmRequest,
  Schedule,
  ScheduleMeta,
  ScheduleStatus,
  ScheduleTask,
  SkillScope
} from '@shared/types'

export interface ToolContext {
  service: PTNotesService
  activeProject: string
  /** The note the user is currently viewing, if any. */
  activeNoteId?: string | null
  confirm: (req: Omit<ConfirmRequest, 'id'>) => Promise<boolean>
  /** Present only in the interactive chat (module subagents never provide it). */
  ask?: (req: Omit<AskRequest, 'id'>) => Promise<{ answers: AskAnswer[]; cancelled?: boolean }>
  /** Present only in the interactive chat; lets long-running tools abort when the chat is stopped. */
  isStopped?: () => boolean
}

export interface PTTool {
  definition: {
    type: 'function'
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
}

function projectOf(args: Record<string, unknown>, ctx: ToolContext): string {
  const p = args.project
  return typeof p === 'string' && p.trim() ? p.trim() : ctx.activeProject
}

function findNote(
  notes: { id: string; name: string }[],
  title: string
): { id: string; name: string } | undefined {
  const slug = slugify(title)
  const raw = title.toLowerCase()
  return (
    notes.find((n) => n.name === slug) ??
    notes.find((n) => n.name.toLowerCase() === raw) ??
    notes.find((n) => n.name.toLowerCase().includes(raw))
  )
}

function scopeOf(args: Record<string, unknown>): SkillScope | null {
  const scope = String(args.scope ?? 'project')
  return scope === 'global' || scope === 'project' || scope === 'builtin' ? scope : null
}

/** All enabled skill names (global + project + builtin) for error messages. */
async function skillNames(ctx: ToolContext): Promise<string[]> {
  const list = await ctx.service.listSkills(ctx.activeProject)
  return [...list.global, ...list.project, ...list.builtin]
    .filter((s) => s.enabled)
    .map((s) => s.name)
}

// ---- Planner helpers ----

function findSchedule(schedules: ScheduleMeta[], target: string): ScheduleMeta | undefined {
  const raw = target.toLowerCase()
  const slug = slugify(target)
  return (
    schedules.find((s) => s.id === slug) ??
    schedules.find((s) => s.name === slug) ??
    schedules.find((s) => s.name.toLowerCase() === raw) ??
    schedules.find((s) => s.name.toLowerCase().includes(raw))
  )
}

function findTaskById(tasks: ScheduleTask[], id: string): ScheduleTask | null {
  for (const task of tasks) {
    if (task.id === id) return task
    const found = findTaskById(task.children, id)
    if (found) return found
  }
  return null
}

function findTaskByTaskNo(tasks: ScheduleTask[], taskNo: string): ScheduleTask | null {
  const walk = (list: ScheduleTask[], parentNo: string | null): ScheduleTask | null => {
    for (let i = 0; i < list.length; i++) {
      const no = deriveTaskNo(parentNo, i)
      if (no === taskNo) return list[i]
      const found = walk(list[i].children, no)
      if (found) return found
    }
    return null
  }
  return walk(tasks, null)
}

function findTask(tasks: ScheduleTask[], target: string): ScheduleTask | null {
  return (
    findTaskById(tasks, target) ?? findTaskByTaskNo(tasks, target) ?? findTaskByTitle(tasks, target)
  )
}

function updateTaskNode(
  tasks: ScheduleTask[],
  id: string,
  fn: (task: ScheduleTask) => ScheduleTask
): ScheduleTask[] {
  return tasks.map((t) => {
    if (t.id === id) return fn(t)
    if (t.children.length > 0) return { ...t, children: updateTaskNode(t.children, id, fn) }
    return t
  })
}

function insertAfterId(tasks: ScheduleTask[], afterId: string, task: ScheduleTask): ScheduleTask[] {
  if (!afterId) return [...tasks, task]
  const i = tasks.findIndex((t) => t.id === afterId)
  if (i === -1) return [...tasks, task]
  return [...tasks.slice(0, i + 1), task, ...tasks.slice(i + 1)]
}

function removeTaskNode(tasks: ScheduleTask[], id: string): ScheduleTask[] {
  return tasks
    .filter((t) => t.id !== id)
    .map((t) => (t.children.length > 0 ? { ...t, children: removeTaskNode(t.children, id) } : t))
}

function containsTask(root: ScheduleTask, id: string): boolean {
  if (root.id === id) return true
  return root.children.some((c) => containsTask(c, id))
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function dateOrNull(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

const STATUSES: ScheduleStatus[] = ['not-started', 'in-progress', 'completed', 'pending', 'on-hold']

function statusOf(v: unknown): ScheduleStatus | null {
  const s = str(v)
  return s && (STATUSES as string[]).includes(s) ? (s as ScheduleStatus) : null
}

function clampPercent(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)))
}

function taskCount(schedule: Schedule): number {
  return schedule.tasks.reduce((n, t) => n + countTasks(t), 0)
}

function scheduleSummary(
  schedule: Schedule,
  project: string
): { ok: boolean; project: string; schedule: string; taskCount: number } {
  return {
    ok: true,
    project,
    schedule: schedule.name,
    taskCount: taskCount(schedule)
  }
}

type TaskView = ScheduleTask & { taskNo: string }

function withTaskNo(tasks: ScheduleTask[], parentNo: string | null): TaskView[] {
  return tasks.map((t, i) => {
    const no = deriveTaskNo(parentNo, i)
    return { ...t, taskNo: no, children: withTaskNo(t.children, no) }
  })
}

async function requireSchedule(
  ctx: ToolContext,
  project: string,
  target: string
): Promise<{ meta: ScheduleMeta; schedule: Schedule }> {
  const schedules = await ctx.service.listSchedules(project)
  const meta = findSchedule(schedules, target)
  if (!meta) {
    throw new Error(`Schedule "${target}" not found`)
  }
  const schedule = await ctx.service.readSchedule(project, meta.id)
  if (!schedule) {
    throw new Error(`Schedule "${target}" not found`)
  }
  return { meta, schedule }
}

export const tools: PTTool[] = [
  {
    definition: {
      type: 'function',
      function: {
        name: 'create_note',
        description:
          'Create a new markdown note in a project. If a note with the given title already exists, update it instead.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            title: { type: 'string', description: 'Title of the note' },
            content: { type: 'string', description: 'Markdown content of the note' }
          },
          required: ['title', 'content']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const title = String(args.title ?? '')
      const content = String(args.content ?? '')
      const existing = await ctx.service.listNotes(project)
      const found = findNote(existing, title)
      if (found) {
        await ctx.service.saveNote(project, found.id, content)
        return JSON.stringify({ ok: true, action: 'updated', note: found.id, project })
      }
      const note = await ctx.service.createNote(project, title)
      await ctx.service.saveNote(project, note.id, content)
      return JSON.stringify({ ok: true, action: 'created', note: note.id, project })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'update_note',
        description:
          'Overwrite the content of an existing note in a project. Creates the note if it does not exist.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            title: { type: 'string', description: 'Title of the note to update' },
            content: { type: 'string', description: 'New markdown content' }
          },
          required: ['title', 'content']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const title = String(args.title ?? '')
      const content = String(args.content ?? '')
      const existing = await ctx.service.listNotes(project)
      const found = findNote(existing, title)
      if (found) {
        await ctx.service.saveNote(project, found.id, content)
        return JSON.stringify({ ok: true, action: 'updated', note: found.id, project })
      }
      const note = await ctx.service.createNote(project, title)
      await ctx.service.saveNote(project, note.id, content)
      return JSON.stringify({ ok: true, action: 'created', note: note.id, project })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'list_notes',
        description: 'List all note titles in a project.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            }
          }
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const notes = await ctx.service.listNotes(project)
      return JSON.stringify({ ok: true, project, notes: notes.map((n) => n.name) })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'read_note',
        description:
          'Read the full markdown content of a note in a project. Omit the title to read the currently active note (the one the user is viewing).',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            title: {
              type: 'string',
              description: 'Title of the note to read. Omit to read the currently active note.'
            }
          }
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const title = String(args.title ?? '').trim()
      let found: { id: string; name: string } | undefined
      if (title) {
        const existing = await ctx.service.listNotes(project)
        found = findNote(existing, title)
        if (!found) return JSON.stringify({ ok: false, error: `Note "${title}" not found` })
      } else if (ctx.activeNoteId) {
        const existing = await ctx.service.listNotes(ctx.activeProject)
        const active = existing.find((n) => n.id === ctx.activeNoteId)
        if (!active) {
          return JSON.stringify({
            ok: false,
            error: 'The active note could not be resolved.'
          })
        }
        found = { id: active.id, name: active.name }
      } else {
        return JSON.stringify({
          ok: false,
          error: 'No note specified and no active note is open.'
        })
      }
      const content = await ctx.service.readNote(project, found.id)
      return JSON.stringify({ ok: true, project, note: found.id, content })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'read_file',
        description:
          'Read the text content of a project file (PDF or any text file such as markdown, plain text, JSON, logs or YAML; files live in the project files folder, referenced as `file:<name>`). Extracts the text locally and returns it, so the user does not need to drag and drop the file again.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            name: {
              type: 'string',
              description: 'Name of the file, e.g. report.pdf, notes.md, data.json or app.log'
            }
          },
          required: ['name']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const name = String(args.name ?? '').trim()
      if (!name) return JSON.stringify({ ok: false, error: 'No file name provided' })
      const path = await ctx.service.projectFilePath(project, name)
      if (!path) {
        const files = await ctx.service.listFiles(project)
        return JSON.stringify({
          ok: false,
          error: `File "${name}" not found in this project. Available files: ${
            files.join(', ') || '(none)'
          }`
        })
      }
      try {
        const { text, pageCount, charCount, truncated } = await readFileAsText(path)
        return JSON.stringify({
          ok: true,
          project,
          file: name,
          pageCount,
          charCount,
          truncated,
          text
        })
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: `Could not read "${name}": ${err instanceof Error ? err.message : String(err)}`
        })
      }
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'search_notes',
        description:
          'Search notes in a project by a word or related word. Searches both note titles and note content and returns the matching note names (with a short snippet). Use this when the user asks you to find notes about a topic.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            query: { type: 'string', description: 'Word or phrase to search for' }
          },
          required: ['query']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const query = String(args.query ?? '').trim()
      if (!query) return JSON.stringify({ ok: false, error: 'No search query provided' })
      const q = query.toLowerCase()
      const words = q.split(/\s+/).filter(Boolean)
      const notes = await ctx.service.listNotes(project)
      const matches: { name: string; snippet?: string }[] = []
      for (const n of notes) {
        const name = n.name.toLowerCase()
        if (name.includes(q) || words.some((w) => name.includes(w))) {
          matches.push({ name: n.name })
          continue
        }
        const content = await ctx.service.readNote(project, n.id)
        const text = content.toLowerCase()
        const positions: number[] = []
        if (q) {
          const i = text.indexOf(q)
          if (i !== -1) positions.push(i)
        }
        for (const w of words) {
          const i = text.indexOf(w)
          if (i !== -1) positions.push(i)
        }
        if (positions.length === 0) continue
        const start = Math.max(0, Math.min(...positions) - 40)
        const snippet = content
          .slice(start, start + 200)
          .replace(/\s+/g, ' ')
          .trim()
        matches.push({ name: n.name, snippet: snippet || undefined })
      }
      return JSON.stringify({
        ok: true,
        project,
        query,
        notes: matches
      })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'delete_note',
        description:
          'Delete one or more existing notes from a project. Requires user confirmation before deleting.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            titles: {
              type: 'array',
              items: { type: 'string' },
              description: 'Titles of the notes to delete'
            }
          },
          required: ['titles']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const titles = Array.isArray(args.titles)
        ? args.titles.map(String).filter(Boolean)
        : [String(args.titles ?? '')].filter(Boolean)
      if (titles.length === 0) {
        return JSON.stringify({ ok: false, error: 'No note titles provided' })
      }
      const existing = await ctx.service.listNotes(project)
      const found = titles
        .map((t) => findNote(existing, t))
        .filter((n): n is { id: string; name: string } => !!n)
      if (found.length === 0) {
        return JSON.stringify({
          ok: false,
          error: `No matching notes found in project "${project}"`
        })
      }
      const names = found.map((n) => n.name)
      const approved = await ctx.confirm({
        project,
        message: `Delete ${names.length} note(s) from "${project}"?`,
        items: names
      })
      if (!approved) {
        return JSON.stringify({ ok: false, cancelled: true, project, notes: names })
      }
      for (const n of found) {
        await ctx.service.deleteNote(project, n.id)
      }
      return JSON.stringify({ ok: true, project, deleted: names })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'create_todos',
        description: 'Add one or more todo tasks to the project todo list.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            tasks: {
              type: 'array',
              items: { type: 'string' },
              description: 'Task descriptions to add'
            }
          },
          required: ['tasks']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const tasks = Array.isArray(args.tasks) ? args.tasks.map(String) : [String(args.tasks ?? '')]
      const todos = await ctx.service.addTodos(project, tasks)
      return JSON.stringify({ ok: true, project, added: tasks, total: todos.length })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'toggle_todo',
        description: 'Toggle the completion state of a todo task (matches by task text).',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            text: { type: 'string', description: 'Exact text of the task to toggle' }
          },
          required: ['text']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const text = String(args.text ?? '').toLowerCase()
      const todos = await ctx.service.listTodos(project)
      const found = todos.find((t) => t.text.toLowerCase() === text)
      if (!found) return JSON.stringify({ ok: false, error: `Todo "${args.text}" not found` })
      await ctx.service.toggleTodo(project, found.id)
      return JSON.stringify({ ok: true, project, toggled: args.text, nowDone: !found.done })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'delete_todo',
        description: 'Delete a todo task from the project todo list (matches by task text).',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            text: { type: 'string', description: 'Exact text of the task to delete' }
          },
          required: ['text']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const text = String(args.text ?? '').toLowerCase()
      const todos = await ctx.service.listTodos(project)
      const found = todos.find((t) => t.text.toLowerCase() === text)
      if (!found) return JSON.stringify({ ok: false, error: `Todo "${args.text}" not found` })
      await ctx.service.deleteTodo(project, found.id)
      return JSON.stringify({ ok: true, project, deleted: args.text })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'list_todos',
        description: 'List all todo tasks in a project with their completion status.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            }
          }
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const todos = await ctx.service.listTodos(project)
      return JSON.stringify({
        ok: true,
        project,
        todos: todos.map((t) => ({ text: t.text, done: t.done }))
      })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Search the web (DuckDuckGo). Returns ranked results with title, url and snippet. Use for current or factual information, then fetch pages for detail.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            maxResults: { type: 'number', description: 'Max results to return (default 5, max 10)' }
          },
          required: ['query']
        }
      }
    },
    async execute(args) {
      const query = String(args.query ?? '')
      const max = Math.min(Math.max(Number(args.maxResults) || 5, 1), 10)
      const results = await duckDuckGoSearch(query, max)
      return JSON.stringify({ ok: true, query, results })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'web_fetch',
        description:
          'Fetch a web page and extract its readable text content. Use after web_search to read a full article.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Absolute URL of the page to fetch' }
          },
          required: ['url']
        }
      }
    },
    async execute(args) {
      const url = String(args.url ?? '')
      const page = await fetchWebPage(url)
      return JSON.stringify({
        ok: true,
        url: page.url,
        title: page.title,
        content: page.text
      })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'create_skill',
        description:
          'Create or update a skill (a named instruction document the AI can load on demand) for the current project (scope "project") or for all projects (scope "global"). Skills are listed in the system prompt; call this to teach the assistant reusable instructions.',
        parameters: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['global', 'project'],
              description:
                'Where the skill lives: "global" (all projects) or "project" (current project). Defaults to "project".'
            },
            name: { type: 'string', description: 'Short unique name for the skill' },
            description: {
              type: 'string',
              description: 'One-line description shown in the skills index'
            },
            content: {
              type: 'string',
              description: 'Full skill instructions (markdown)'
            },
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            }
          },
          required: ['name', 'description', 'content']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const scope = scopeOf(args)
      if (!scope) {
        return JSON.stringify({
          ok: false,
          error: 'scope must be "global", "project" or "builtin"'
        })
      }
      if (scope === 'builtin') {
        return JSON.stringify({
          ok: false,
          error: 'Builtin skills are read-only and cannot be created'
        })
      }
      const name = String(args.name ?? '').trim()
      if (!name) return JSON.stringify({ ok: false, error: 'No skill name provided' })
      const existing = await ctx.service.readSkill(project, scope, name)
      const meta = await ctx.service.saveSkill(project, scope, name, {
        description: String(args.description ?? ''),
        content: String(args.content ?? ''),
        enabled: existing?.enabled ?? true
      })
      return JSON.stringify({
        ok: true,
        action: existing ? 'updated' : 'created',
        scope: meta.scope,
        name: meta.name,
        project
      })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'read_skill',
        description:
          'Load the full content of a skill (a named instruction document) before applying it. Skills are listed by name and description in the system prompt; call this to get the complete instructions.',
        parameters: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['global', 'project', 'builtin'],
              description:
                'Where the skill lives: "global" (all projects), "project" (current project) or "builtin" (app-shipped, read-only). Defaults to "project".'
            },
            name: { type: 'string', description: 'Name of the skill to load' },
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            }
          },
          required: ['name']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const scope = scopeOf(args)
      if (!scope) {
        return JSON.stringify({
          ok: false,
          error: 'scope must be "global", "project" or "builtin"'
        })
      }
      const name = String(args.name ?? '').trim()
      if (!name) return JSON.stringify({ ok: false, error: 'No skill name provided' })
      const skill = await ctx.service.readSkill(project, scope, name)
      if (!skill) {
        return JSON.stringify({
          ok: false,
          error: `Skill "${name}" (${scope}) not found. Available skills: ${
            (await skillNames(ctx)).join(', ') || '(none)'
          }`
        })
      }
      if (!skill.enabled) {
        return JSON.stringify({ ok: false, error: `Skill "${name}" (${scope}) is disabled.` })
      }
      return JSON.stringify({ ok: true, ...skill })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'delete_skill',
        description:
          'Delete a skill (a named instruction document) for the current project (scope "project") or for all projects (scope "global"). Requires user confirmation before deleting.',
        parameters: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['global', 'project'],
              description: 'Where the skill lives: "global" or "project". Defaults to "project".'
            },
            name: { type: 'string', description: 'Name of the skill to delete' },
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            }
          },
          required: ['name']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const scope = scopeOf(args)
      if (!scope) {
        return JSON.stringify({
          ok: false,
          error: 'scope must be "global", "project" or "builtin"'
        })
      }
      if (scope === 'builtin') {
        return JSON.stringify({
          ok: false,
          error: 'Builtin skills are read-only and cannot be deleted'
        })
      }
      const name = String(args.name ?? '').trim()
      if (!name) return JSON.stringify({ ok: false, error: 'No skill name provided' })
      const existing = await ctx.service.readSkill(project, scope, name)
      if (!existing) {
        return JSON.stringify({ ok: false, error: `Skill "${name}" (${scope}) not found` })
      }
      const approved = await ctx.confirm({
        project,
        message: `Delete the ${scope} skill "${name}"?`,
        items: [name]
      })
      if (!approved) {
        return JSON.stringify({ ok: false, cancelled: true, scope, name })
      }
      const deleted = await ctx.service.deleteSkill(project, scope, name)
      if (!deleted) {
        return JSON.stringify({ ok: false, error: `Skill "${name}" (${scope}) not found` })
      }
      return JSON.stringify({ ok: true, scope, name, project })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'ask_user',
        description:
          'Ask the user for input — a choice, a detail, or confirmation — before continuing. You may include several questions in a single call; the user answers them all at once in a dialog. Each question has an id and question text, plus optional predefined options (2-6 choices; omit options for free text, set multiple true for multi-select). Only call this when you genuinely need input from the user.',
        parameters: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Stable identifier for the question' },
                  question: { type: 'string', description: 'The question to ask' },
                  options: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Predefined choices (2-6). Omit for free text.'
                  },
                  multiple: {
                    type: 'boolean',
                    description: 'True to allow selecting multiple options (checkboxes).'
                  }
                },
                required: ['id', 'question']
              },
              description: '1-8 questions to ask the user'
            }
          },
          required: ['questions']
        }
      }
    },
    async execute(args, ctx) {
      const raw = Array.isArray(args.questions) ? (args.questions as unknown[]) : []
      if (raw.length === 0) {
        return JSON.stringify({
          ok: false,
          error: 'ask_user requires a non-empty questions array.'
        })
      }
      if (raw.length > 8) {
        return JSON.stringify({
          ok: false,
          error: 'ask_user supports at most 8 questions per call.'
        })
      }
      const questions: AskQuestion[] = []
      for (const item of raw) {
        const q = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
        const id = String(q.id ?? '').trim()
        const question = String(q.question ?? '').trim()
        if (!id || !question) {
          return JSON.stringify({
            ok: false,
            error: 'Each question needs a non-empty id and question text.'
          })
        }
        const options = Array.isArray(q.options)
          ? q.options.map(String).filter((s) => s.trim().length > 0)
          : []
        if (options.length > 0 && (options.length < 2 || options.length > 6)) {
          return JSON.stringify({
            ok: false,
            error: `Question "${id}" needs 2-6 options, or none for free text.`
          })
        }
        questions.push({
          id,
          question,
          ...(options.length > 0 ? { options } : {}),
          ...(options.length > 0 && q.multiple === true ? { multiple: true } : {})
        })
      }
      if (!ctx.ask) {
        return JSON.stringify({ ok: false, error: 'ask_user requires the interactive chat' })
      }
      const res = await ctx.ask({ project: ctx.activeProject, questions })
      return JSON.stringify({
        ok: !res.cancelled,
        cancelled: !!res.cancelled,
        answers: res.answers
      })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'list_schedules',
        description:
          'List project schedules (schedules are project plans with tasks and dates). Provide a query to search for a specific schedule by id or name; omit to list all.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            query: {
              type: 'string',
              description: 'Optional search query for schedule id or name.'
            }
          }
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      let schedules = await ctx.service.listSchedules(project)
      const query = String(args.query ?? '').trim()
      if (query) {
        const found = findSchedule(schedules, query)
        schedules = found ? [found] : []
      }
      return JSON.stringify({
        ok: true,
        project,
        schedules: schedules.map((s) => ({
          id: s.id,
          name: s.name,
          taskCount: s.taskCount,
          updatedAt: s.updatedAt
        }))
      })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'read_schedule',
        description:
          'Read a full schedule (its task tree with status, owner, durations, plan/actual dates, %complete, notes). Each task carries a taskNo outline number (1, 1.1, 1.2, 2, ...) matching the editor, including children. Parent task values are rolled up from children. Match the schedule by id.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            schedule: {
              type: 'string',
              description: 'Schedule id'
            }
          },
          required: ['schedule']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      try {
        const { meta, schedule } = await requireSchedule(ctx, project, String(args.schedule ?? ''))
        const calendar = await ctx.service.readCalendar(project)
        const tasks = withTaskNo(rollupScheduleTasks(schedule.tasks, calendar), null)
        return JSON.stringify({
          ok: true,
          project,
          id: meta.id,
          name: meta.name,
          createdAt: schedule.createdAt,
          updatedAt: schedule.updatedAt,
          tasks
        })
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message })
      }
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'create_schedule',
        description:
          'Create a new empty schedule in a project. Returns the new schedule id and name.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            name: { type: 'string', description: 'Schedule name' }
          },
          required: ['name']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const name = String(args.name ?? '').trim()
      if (!name) {
        return JSON.stringify({ ok: false, error: 'name is required' })
      }
      try {
        const meta = await ctx.service.createSchedule(project, name)
        return JSON.stringify({ ok: true, project, id: meta.id, name: meta.name })
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message })
      }
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'update_schedule',
        description: 'Rename a project schedule. Match the schedule by id.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            schedule: {
              type: 'string',
              description: 'Schedule id to rename'
            },
            name: { type: 'string', description: 'New schedule name' }
          },
          required: ['schedule', 'name']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const name = String(args.name ?? '').trim()
      if (!name) {
        return JSON.stringify({ ok: false, error: 'name is required' })
      }
      try {
        const { meta } = await requireSchedule(ctx, project, String(args.schedule ?? ''))
        const updated = await ctx.service.renameSchedule(project, meta.id, name)
        return JSON.stringify({
          ok: true,
          project,
          id: updated.id,
          name: updated.name
        })
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message })
      }
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'add_task',
        description:
          'Add a task to a project schedule. Match the schedule by id. Optionally nest it under an existing parent task (match the parent by id, task number or title) and/or position it directly after an existing sibling task (match addAfter by id, task number or title). Plan dates follow the project working-day calendar: set both planStart and planEnd, or planStart + duration; the missing value is computed.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            schedule: { type: 'string', description: 'Schedule id' },
            parent: {
              type: 'string',
              description:
                'Optional parent task id, task number (e.g. 1.2) or title to nest this task under'
            },
            addAfter: {
              type: 'string',
              description:
                'Optional task id, task number (e.g. 1.2) or title to insert this new task directly after. Positions within the sibling list chosen by `parent` (defaults to top level). If the task is not found in that list, the new task is appended.'
            },
            title: { type: 'string', description: 'Task title' },
            owner: { type: 'string', description: 'Owner (optional)' },
            duration: {
              type: 'number',
              description: 'Duration in working days (used with planStart to compute planEnd)'
            },
            planStart: {
              type: 'string',
              description: 'Plan start date (YYYY-MM-DD)'
            },
            planEnd: { type: 'string', description: 'Plan end date (YYYY-MM-DD)' },
            actualStart: { type: 'string', description: 'Actual start date (YYYY-MM-DD)' },
            actualEnd: { type: 'string', description: 'Actual end date (YYYY-MM-DD)' },
            percentComplete: {
              type: 'number',
              description: 'Percent complete 0-100'
            },
            status: {
              type: 'string',
              description:
                'Status: not-started, in-progress, completed, pending, on-hold (auto-derived from percent unless pending/on-hold)'
            },
            note: { type: 'string', description: 'Note (optional)' }
          },
          required: ['schedule', 'title']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      try {
        const { schedule } = await requireSchedule(ctx, project, String(args.schedule ?? ''))
        const calendar = await ctx.service.readCalendar(project)

        const task = emptyTask()
        const title = String(args.title ?? '').trim()
        task.title = title
        const owner = str(args.owner)
        if (owner !== null) task.owner = owner
        const note = str(args.note)
        if (note !== null) task.note = note
        const status = statusOf(args.status)
        if (status) task.status = status
        const percent = numOrNull(args.percentComplete)
        if (percent !== null) task.percentComplete = clampPercent(percent)
        const planStart = dateOrNull(args.planStart)
        if (planStart) task.planStart = planStart
        const planEnd = dateOrNull(args.planEnd)
        if (planEnd) task.planEnd = planEnd
        const duration = numOrNull(args.duration)
        const explicitDuration = duration !== null
        if (explicitDuration) task.duration = Math.max(1, Math.round(duration))
        const actualStart = dateOrNull(args.actualStart)
        if (actualStart) task.actualStart = actualStart
        const actualEnd = dateOrNull(args.actualEnd)
        if (actualEnd) task.actualEnd = actualEnd

        const resolved = { ...task }
        if (resolved.planStart && resolved.planEnd) {
          resolved.duration = computeDuration(resolved.planStart, resolved.planEnd, calendar)
        } else if (
          explicitDuration &&
          resolved.planStart &&
          resolved.duration !== null &&
          resolved.duration > 0
        ) {
          resolved.planEnd = computeEndDate(resolved.planStart, resolved.duration, calendar)
        }

        let tasks: ScheduleTask[]
        const parent = args.parent ? findTask(schedule.tasks, String(args.parent)) : null
        const afterId = args.addAfter
          ? (findTask(schedule.tasks, String(args.addAfter))?.id ?? '')
          : ''
        if (parent) {
          const children = insertAfterId(parent.children, afterId, resolved)
          tasks = updateTaskNode(schedule.tasks, parent.id, (t) => ({ ...t, children }))
        } else {
          tasks = insertAfterId(schedule.tasks, afterId, resolved)
        }
        const saved = {
          ...schedule,
          tasks: rollupScheduleTasks(tasks, calendar),
          updatedAt: Date.now()
        }
        await ctx.service.saveSchedule(project, saved)
        return JSON.stringify({
          ...scheduleSummary(saved, project),
          taskId: resolved.id,
          parent: parent ? parent.id : null
        })
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message })
      }
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'update_task',
        description:
          'Update an existing task in a project schedule. Match the schedule by id and the task by id, task number (e.g. 1.2) or title. Only provided fields change. For plan dates/duration, the project working-day calendar applies: change one of planStart/planEnd/duration and the other is recomputed. For parent tasks, plan start/end, %complete and duration are derived from children — update the child tasks instead (plan-field edits on a parent are rejected). Parent status and %complete are derived from children. To move a task, set `parent` to the new parent task id, task number (e.g. 1.2) or title (omit or pass empty to move it to the top level); the task and its subtree move together and `addAfter` positions it within the new sibling list (defaults to append).',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            schedule: { type: 'string', description: 'Schedule id' },
            task: {
              type: 'string',
              description: 'Task id (uuid), task number (e.g. 1.2) or title to update'
            },
            parent: {
              type: 'string',
              description:
                'Optional new parent task id, task number (e.g. 1.2) or title to move this task under. Omit or pass empty to move it to the top level. The task and its subtree move together. The new parent must not be the task itself or one of its descendants.'
            },
            addAfter: {
              type: 'string',
              description:
                'Optional task id, task number (e.g. 1.2) or title to position this task directly after within the sibling list chosen by `parent` (defaults to top level). If the task is not found in that list, the task is appended.'
            },
            title: { type: 'string', description: 'New title' },
            owner: { type: 'string', description: 'New owner' },
            duration: {
              type: 'number',
              description: 'New duration in working days'
            },
            planStart: { type: 'string', description: 'New plan start date (YYYY-MM-DD)' },
            planEnd: { type: 'string', description: 'New plan end date (YYYY-MM-DD)' },
            actualStart: { type: 'string', description: 'New actual start date (YYYY-MM-DD)' },
            actualEnd: { type: 'string', description: 'New actual end date (YYYY-MM-DD)' },
            percentComplete: { type: 'number', description: 'New percent complete 0-100' },
            status: {
              type: 'string',
              description: 'New status: not-started, in-progress, completed, pending, on-hold'
            },
            note: { type: 'string', description: 'New note' }
          },
          required: ['schedule', 'task']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      try {
        const { schedule } = await requireSchedule(ctx, project, String(args.schedule ?? ''))
        const target = String(args.task ?? '')
        const task = findTask(schedule.tasks, target)
        if (!task) {
          return JSON.stringify({ ok: false, error: `Task "${target}" not found` })
        }
        if (
          task.children.length > 0 &&
          (args.planStart !== undefined ||
            args.planEnd !== undefined ||
            args.duration !== undefined)
        ) {
          return JSON.stringify({
            ok: false,
            error: `Task "${task.title}" is a parent task: plan start/end and duration are derived from its children. Update the child tasks instead.`
          })
        }
        const calendar = await ctx.service.readCalendar(project)

        const next = { ...task } as ScheduleTask
        const title = str(args.title)
        if (title !== null) next.title = title
        const owner = str(args.owner)
        if (owner !== null) next.owner = owner
        const note = str(args.note)
        if (note !== null) next.note = note
        const status = statusOf(args.status)
        if (status) next.status = status
        const percent = numOrNull(args.percentComplete)
        if (percent !== null) next.percentComplete = clampPercent(percent)
        const planStart = dateOrNull(args.planStart)
        if (planStart !== null) next.planStart = planStart
        const planEnd = dateOrNull(args.planEnd)
        if (planEnd !== null) next.planEnd = planEnd
        const duration = numOrNull(args.duration)
        if (duration !== null) next.duration = Math.max(1, Math.round(duration))
        const actualStart = dateOrNull(args.actualStart)
        if (actualStart !== null) next.actualStart = actualStart
        const actualEnd = dateOrNull(args.actualEnd)
        if (actualEnd !== null) next.actualEnd = actualEnd

        const resolved = applyDateRule(task, next, calendar)

        const parentArg = args.parent ? findTask(schedule.tasks, String(args.parent)) : null
        if (parentArg && (parentArg.id === task.id || containsTask(task, parentArg.id))) {
          return JSON.stringify({
            ok: false,
            error: `Cannot move task "${task.title}" under itself or one of its descendants.`
          })
        }
        const afterId = args.addAfter
          ? (findTask(schedule.tasks, String(args.addAfter))?.id ?? '')
          : ''
        const moveRequested = args.parent !== undefined || args.addAfter !== undefined

        let tasks: ScheduleTask[]
        if (moveRequested) {
          tasks = removeTaskNode(schedule.tasks, task.id)
          if (parentArg) {
            const parentNode = findTask(tasks, parentArg.id)
            const children = insertAfterId(parentNode!.children, afterId, resolved)
            tasks = updateTaskNode(tasks, parentNode!.id, (t) => ({ ...t, children }))
          } else {
            tasks = insertAfterId(tasks, afterId, resolved)
          }
        } else {
          tasks = updateTaskNode(schedule.tasks, task.id, () => resolved)
        }
        const saved = {
          ...schedule,
          tasks: rollupScheduleTasks(tasks, calendar),
          updatedAt: Date.now()
        }
        await ctx.service.saveSchedule(project, saved)
        return JSON.stringify({
          ...scheduleSummary(saved, project),
          updated: { id: task.id, title: resolved.title },
          parent: parentArg ? parentArg.id : null
        })
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message })
      }
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'set_calendar',
        description:
          'Set the project working-day calendar (week + holidays) used for plan start/end computation. Provide weekStart/weekEnd as weekday numbers (0=Sun..6=Sat; e.g. Monday-Friday = 1..5). holidays replaces the full list; addHolidays/removeHolidays adjust it. All schedules are re-rolled so parent durations reflect the new calendar.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            weekStart: { type: 'number', description: 'First working weekday (0=Sun..6=Sat)' },
            weekEnd: { type: 'number', description: 'Last working weekday (0=Sun..6=Sat)' },
            holidays: {
              type: 'array',
              items: { type: 'string' },
              description: 'Replace the full holiday list (YYYY-MM-DD)'
            },
            addHolidays: {
              type: 'array',
              items: { type: 'string' },
              description: 'Dates to add to the holiday list (YYYY-MM-DD)'
            },
            removeHolidays: {
              type: 'array',
              items: { type: 'string' },
              description: 'Dates to remove from the holiday list (YYYY-MM-DD)'
            }
          }
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const calendar = await ctx.service.readCalendar(project)
      const weekStart = numOrNull(args.weekStart)
      if (weekStart !== null && weekStart >= 0 && weekStart <= 6) calendar.weekStart = weekStart
      const weekEnd = numOrNull(args.weekEnd)
      if (weekEnd !== null && weekEnd >= 0 && weekEnd <= 6) calendar.weekEnd = weekEnd
      if (Array.isArray(args.holidays)) {
        calendar.holidays = [
          ...new Set(args.holidays.map((h) => dateOrNull(h)).filter((h): h is string => h !== null))
        ]
      }
      for (const h of Array.isArray(args.addHolidays) ? args.addHolidays : []) {
        const d = dateOrNull(h)
        if (d && !calendar.holidays.includes(d)) calendar.holidays.push(d)
      }
      for (const h of Array.isArray(args.removeHolidays) ? args.removeHolidays : []) {
        const d = dateOrNull(h)
        if (d) calendar.holidays = calendar.holidays.filter((x) => x !== d)
      }
      calendar.holidays.sort()
      await ctx.service.saveCalendar(project, calendar)
      const metas = await ctx.service.listSchedules(project)
      let reRolled = 0
      for (const meta of metas) {
        const schedule = await ctx.service.readSchedule(project, meta.id)
        if (!schedule) continue
        await ctx.service.saveSchedule(project, {
          ...schedule,
          tasks: rollupScheduleTasks(schedule.tasks, calendar),
          updatedAt: Date.now()
        })
        reRolled++
      }
      return JSON.stringify({
        ok: true,
        project,
        weekStart: calendar.weekStart,
        weekEnd: calendar.weekEnd,
        holidays: calendar.holidays,
        reRolledSchedules: reRolled
      })
    }
  }
]
