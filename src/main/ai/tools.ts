import type { PTNotesService } from '../service/PTNotesService'
import { duckDuckGoSearch } from './search/duckduckgo'
import { fetchWebPage } from './search/webFetch'
import { slugify } from '../utils/slug'
import { readFileAsText } from './reader'
import type { ConfirmRequest } from '@shared/types'

export interface ToolContext {
  service: PTNotesService
  activeProject: string
  confirm: (req: Omit<ConfirmRequest, 'id'>) => Promise<boolean>
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
        description: 'Read the full markdown content of a note in a project.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name. Defaults to the current project.'
            },
            title: { type: 'string', description: 'Title of the note to read' }
          },
          required: ['title']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const title = String(args.title ?? '')
      const existing = await ctx.service.listNotes(project)
      const found = findNote(existing, title)
      if (!found) return JSON.stringify({ ok: false, error: `Note "${title}" not found` })
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
  }
]
