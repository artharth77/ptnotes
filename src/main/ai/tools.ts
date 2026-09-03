import type { PTNotesService } from '../service/PTNotesService'
import { randomBytes } from 'crypto'
import { duckDuckGoSearch } from './search/duckduckgo'
import { fetchWebPage } from './search/webFetch'
import { slugify } from '@shared/slug'
import { kanbanSecretToken, secretIdFromToken, secretToken } from '@shared/secrets'
import { readFileAsText, parseWorkbookQuery } from './reader'
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
import { findCardByTitle, findColumnByName } from '@shared/kanban'
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
  /** Present only in the interactive chat; stores a secret answer in memory and returns its `${SECRET:<id>}` token. */
  registerSecret?: (value: string) => string
  /** Present only in the interactive chat; lets long-running tools abort when the chat is stopped. */
  isStopped?: () => boolean
  /** Attribution for kanban comments written by this session (bot-task runs set it to the bot's name; absent → "you"). */
  commenterName?: string
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Stable identity of a tool call (name + args, key-order independent) for repeat detection. */
export function toolCallKey(name: string, args: Record<string, unknown>): string {
  return `${name}\u0000${canonicalJson(args)}`
}

function projectOf(args: Record<string, unknown>, ctx: ToolContext): string {
  const p = args.project
  return typeof p === 'string' && p.trim() ? p.trim() : ctx.activeProject
}

/** Optional comma-separated (or array) list argument → trimmed lowercase items; null when absent/empty. */
function csvList(value: unknown): string[] | null {
  const raw = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === 'string'
      ? value.split(',')
      : []
  const list = raw.map((s) => s.trim().toLowerCase()).filter(Boolean)
  return list.length > 0 ? list : null
}

/** Card attribute values for AI output. Secret values are masked as `${K_SECRET:<id>|<key>}`
 * tokens (registered in the session so later tool calls can use the value without seeing it);
 * when no session secret store is available the id is unregistered and the token is unusable. */
function attributesForAi(
  card: { attributes: Record<string, string>; secretAttributes: string[] },
  ctx: ToolContext
): Record<string, string> | undefined {
  const entries = Object.entries(card.attributes)
  if (entries.length === 0) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (card.secretAttributes.includes(key)) {
      let id: string | null = null
      if (ctx.registerSecret) {
        id = secretIdFromToken(ctx.registerSecret(value))
      }
      out[key] = kanbanSecretToken(id ?? randomBytes(6).toString('hex'), key)
    } else {
      out[key] = value
    }
  }
  return out
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

/** Split note content into lines; a trailing newline does not add an empty line. */
function noteLines(content: string): string[] {
  if (content === '') return []
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Parse a line number argument (>= min); null when absent, NaN when invalid. */
function lineArg(v: unknown, min = 1): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isInteger(n) && n >= min ? n : NaN
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

function findTaskParent(tasks: ScheduleTask[], id: string): ScheduleTask | null {
  for (const task of tasks) {
    if (task.children.some((c) => c.id === id)) return task
    const found = findTaskParent(task.children, id)
    if (found) return found
  }
  return null
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

type TaskView = Omit<ScheduleTask, 'percentComplete' | 'children'> & {
  taskNo: string
  percentComplete: string
  children: TaskView[]
}

function slimTasks(tasks: TaskView[]): Record<string, unknown>[] {
  return tasks.map(({ owner, note, children, ...rest }) => {
    const slim: Record<string, unknown> = rest
    if (owner) slim.owner = owner
    if (note) slim.note = note
    if (children?.length) slim.children = slimTasks(children)
    return slim
  })
}

function withTaskNo(tasks: ScheduleTask[], parentNo: string | null): TaskView[] {
  return tasks.map((t, i) => {
    const no = deriveTaskNo(parentNo, i)
    return {
      ...t,
      percentComplete: `${t.percentComplete}%`,
      taskNo: no,
      children: withTaskNo(t.children, no)
    }
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
          'Create a new markdown note in a project. If a note with the given title already exists, replace its entire content (full rewrite). For small targeted changes to an existing note, use update_note instead.',
        parameters: {
          type: 'object',
          properties: {
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
      const res = await ctx.service.upsertNote(project, found?.id ?? slugify(title), content)
      return JSON.stringify({ ok: true, action: res.action, note: res.id, project })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'update_note',
        description:
          'Edit an existing note in a project with line-based, diff-style hunks. Read the note first with read_note and use the line numbers it displays verbatim (do not recount), then pass an edits array of {startLine, endLine, content} hunks: a hunk replaces lines startLine..endLine (1-based, inclusive) with content — aim each hunk at the exact line(s) to change; endLine = startLine - 1 inserts content before line startLine; startLine = totalLines + 1 (with endLine = totalLines) appends at the end; an empty content deletes the lines. All hunks reference the original line numbers and are applied in one atomic write, so multiple hunks never shift each other. The content you write is raw markdown — never include the line-number prefixes. The note must already exist — use create_note to create it.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the note to edit' },
            edits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  startLine: {
                    type: 'integer',
                    minimum: 1,
                    description:
                      'First line to replace (1-based, inclusive). For an insertion, the line before which to insert (pair with endLine = startLine - 1).'
                  },
                  endLine: {
                    type: 'integer',
                    minimum: 0,
                    description:
                      'Last line to replace (1-based, inclusive). Use endLine = startLine - 1 for a zero-width insertion before startLine.'
                  },
                  content: {
                    type: 'string',
                    description:
                      'Replacement text (markdown lines). Empty string deletes the line range.'
                  }
                },
                required: ['startLine', 'endLine', 'content']
              },
              description:
                'One or more hunks, all referencing the original line numbers of the note'
            }
          },
          required: ['title', 'edits']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const title = String(args.title ?? '')
      const rawEdits = Array.isArray(args.edits) ? (args.edits as unknown[]) : []
      if (rawEdits.length === 0) {
        return JSON.stringify({
          ok: false,
          error:
            'update_note requires a non-empty edits array of {startLine, endLine, content} hunks.'
        })
      }
      const existing = await ctx.service.listNotes(project)
      const found = findNote(existing, title)
      if (!found) {
        return JSON.stringify({
          ok: false,
          error: `Note "${title}" not found in project "${project}". Use create_note to create it.`
        })
      }

      type Hunk = { startLine: number; endLine: number; content: string }
      let response = ''

      // Runs under the per-project note lock: hunks are validated and applied
      // against the note's current content, so concurrent edits cannot shift lines.
      await ctx.service.withNote(project, found.id, (raw) => {
        const lines = noteLines(raw)
        const totalLines = lines.length
        const hadTrailingNewline = raw !== '' && raw.endsWith('\n')

        const hunks: Hunk[] = []
        for (let i = 0; i < rawEdits.length; i++) {
          const e = (
            typeof rawEdits[i] === 'object' && rawEdits[i] !== null ? rawEdits[i] : {}
          ) as Record<string, unknown>
          const startLine = lineArg(e.startLine)
          const endLine = lineArg(e.endLine, 0)
          if (startLine === null || endLine === null) {
            response = JSON.stringify({
              ok: false,
              error: `Hunk ${i + 1} needs startLine (>= 1) and endLine (>= 0) as integers.`
            })
            return null
          }
          if (Number.isNaN(startLine) || Number.isNaN(endLine)) {
            response = JSON.stringify({
              ok: false,
              error: `Hunk ${i + 1}: startLine and endLine must be integers (startLine >= 1, endLine >= 0).`
            })
            return null
          }
          if (typeof e.content !== 'string') {
            response = JSON.stringify({
              ok: false,
              error: `Hunk ${i + 1}: content must be a string (use "" to delete the line range).`
            })
            return null
          }
          if (endLine < startLine - 1) {
            response = JSON.stringify({
              ok: false,
              error: `Hunk ${i + 1}: endLine (${endLine}) must be >= startLine - 1 (${startLine - 1}); use endLine = startLine - 1 to insert before line ${startLine}.`
            })
            return null
          }
          if (endLine >= startLine && endLine > totalLines) {
            response = JSON.stringify({
              ok: false,
              totalLines,
              error: `Hunk ${i + 1}: endLine ${endLine} is beyond the end of the note (it has ${totalLines} line(s)).`
            })
            return null
          }
          if (endLine < startLine && startLine > totalLines + 1) {
            response = JSON.stringify({
              ok: false,
              totalLines,
              error: `Hunk ${i + 1}: cannot insert before line ${startLine} — the note has ${totalLines} line(s); use startLine ${totalLines + 1} to append at the end.`
            })
            return null
          }
          hunks.push({ startLine, endLine, content: e.content })
        }

        const isInsert = (h: Hunk): boolean => h.endLine < h.startLine
        for (let i = 0; i < hunks.length; i++) {
          for (let j = i + 1; j < hunks.length; j++) {
            const a = hunks[i]
            const b = hunks[j]
            const aIns = isInsert(a)
            const bIns = isInsert(b)
            if (aIns && bIns) {
              if (a.startLine === b.startLine) {
                response = JSON.stringify({
                  ok: false,
                  error: `Hunks ${i + 1} and ${j + 1} both insert before line ${a.startLine}.`
                })
                return null
              }
              continue
            }
            if (aIns || bIns) {
              const ins = aIns ? a : b
              const rep = aIns ? b : a
              if (rep.startLine < ins.startLine && ins.startLine <= rep.endLine) {
                response = JSON.stringify({
                  ok: false,
                  error: `Hunk ${aIns ? i + 1 : j + 1} inserts before line ${ins.startLine}, which is inside hunk ${aIns ? j + 1 : i + 1}'s range (${rep.startLine}-${rep.endLine}).`
                })
                return null
              }
              continue
            }
            if (a.startLine <= b.endLine && b.startLine <= a.endLine) {
              response = JSON.stringify({
                ok: false,
                error: `Hunks ${i + 1} and ${j + 1} overlap (lines ${a.startLine}-${a.endLine} and ${b.startLine}-${b.endLine}).`
              })
              return null
            }
          }
        }

        const sorted = [...hunks].sort((x, y) => y.startLine - x.startLine || y.endLine - x.endLine)
        for (const h of sorted) {
          const contentLines = h.content === '' ? [] : noteLines(h.content)
          if (h.endLine >= h.startLine) {
            lines.splice(h.startLine - 1, h.endLine - h.startLine + 1, ...contentLines)
          } else {
            lines.splice(h.startLine - 1, 0, ...contentLines)
          }
        }

        let out = lines.join('\n')
        if (out !== '' && hadTrailingNewline) out += '\n'
        response = JSON.stringify({
          ok: true,
          action: 'updated',
          note: found.id,
          project,
          edits: hunks.length,
          totalLines: lines.length
        })
        return out
      })
      return response
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'list_notes',
        description:
          'List note titles in a project. Omit the query to list all notes. Pass a word or phrase as the query to only return notes whose title or content matches, each with a short snippet. Use this when the user asks to find notes about a topic.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Optional word or phrase. When provided, only notes whose title or content match are returned (with a snippet).'
            }
          }
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const query = String(args.query ?? '').trim()
      const notes = await ctx.service.listNotes(project)
      if (!query) {
        return JSON.stringify({ ok: true, project, notes: notes.map((n) => n.name) })
      }
      const q = query.toLowerCase()
      const words = q.split(/\s+/).filter(Boolean)
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
        name: 'read_note',
        description:
          'Read the markdown content of a note in a project. Omit the title to read the currently active note (the one the user is viewing). The content is line-numbered — each line is prefixed with its 1-based line number and ": " — use those numbers verbatim as startLine/endLine for update_note hunks. For long notes, pass startLine/endLine (1-based, inclusive) to read only a portion.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Title of the note to read. Omit to read the currently active note.'
            },
            startLine: {
              type: 'integer',
              minimum: 1,
              description:
                'First line to read (1-based, inclusive). Omit to start at the first line.'
            },
            endLine: {
              type: 'integer',
              minimum: 1,
              description:
                'Last line to read (1-based, inclusive). Omit to read to the end of the note.'
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
      const lines = noteLines(content)
      const totalLines = lines.length
      const width = String(totalLines).length
      const numbered = (from: number, to: number): string =>
        lines
          .slice(from - 1, to)
          .map((line, i) => `${String(from + i).padStart(width, ' ')}: ${line}`)
          .join('\n')
      const start = lineArg(args.startLine)
      const end = lineArg(args.endLine)
      if (start === null && end === null) {
        return JSON.stringify({
          ok: true,
          project,
          note: found.id,
          content: numbered(1, totalLines),
          totalLines
        })
      }
      if (Number.isNaN(start) || Number.isNaN(end)) {
        return JSON.stringify({
          ok: false,
          error: 'startLine and endLine must be integers greater than or equal to 1.'
        })
      }
      const startLine = start ?? 1
      if (startLine > totalLines) {
        return JSON.stringify({
          ok: false,
          totalLines,
          error: `startLine ${startLine} is beyond the end of the note (it has ${totalLines} line(s)).`
        })
      }
      const endLine = end ?? totalLines
      if (startLine > endLine) {
        return JSON.stringify({
          ok: false,
          totalLines,
          error: `startLine (${startLine}) must be less than or equal to endLine (${endLine}).`
        })
      }
      const effectiveEnd = Math.min(endLine, totalLines)
      return JSON.stringify({
        ok: true,
        project,
        note: found.id,
        content: numbered(startLine, effectiveEnd),
        totalLines,
        startLine,
        endLine: effectiveEnd
      })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'read_file',
        description:
          'Read the text content of a project file (PDF, Excel workbooks converted to JSON/CSV, or any text file such as markdown, plain text, JSON, logs or YAML; files live in the project files folder, referenced as `file:<name>`). Excel workbooks can be filtered to a single worksheet with the `query` parameter. Extracts the text locally and returns it, so the user does not need to drag and drop the file again.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Name of the file, e.g. report.pdf, data.xlsx, notes.md, data.json or app.log'
            },
            format: {
              type: 'string',
              enum: ['json', 'csv'],
              description: 'Format for Excel workbooks. Defaults to "json".'
            },
            query: {
              type: 'string',
              description:
                'Excel workbooks only, formatted as URL-style vars "var=value&var=value" (values may be URL-encoded). Supported vars: workspace = worksheet name or 1-based worksheet number, e.g. "workspace=Sales" or "workspace=2"; list=workspace returns a JSON list of all worksheets with their 1-based index instead of content. Only supported when reading .xlsx/.xlsm files.'
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
        const format = (args.format as 'json' | 'csv') ?? 'json'
        const rawQuery = String(args.query ?? '').trim()
        const excelQuery = rawQuery ? parseWorkbookQuery(rawQuery) : undefined
        const { text, pageCount, charCount, truncated } = await readFileAsText(
          path,
          format,
          excelQuery
        )
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
        name: 'delete_note',
        description:
          'Delete one or more existing notes from a project. A confirmation dialog is shown automatically before deleting — do not ask the user first via ask_user.',
        parameters: {
          type: 'object',
          properties: {
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
        name: 'list_kanban_cards',
        description:
          'List kanban cards in a project, grouped by column. Each card includes its id, title, description (truncated), priority, due date, labels, assignee, story points and attributes. Secret attribute values are masked as ${K_SECRET:<id>|<key>} tokens — pass a token unchanged in a later tool call and the real value is substituted before execution; the value is never shown to you. All filter arguments are optional — omit them to list every card.',
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Filter to a single card by its id (UUID). Omit to list all cards.'
            },
            columns: {
              type: 'string',
              description:
                'Comma-separated column names or ids to include (e.g. "To Do, done"). Omit to include all columns.'
            },
            priority: {
              type: 'string',
              enum: ['any', 'low', 'medium', 'high'],
              description: 'Filter by priority. "any" or omitted means no priority filter.'
            },
            labels: {
              type: 'string',
              description:
                'Comma-separated labels; only cards carrying ALL of these labels are listed. Omit to not filter by labels.'
            },
            text: {
              type: 'string',
              description:
                'Case-insensitive substring filter on the card title or description. Omit to not filter by text.'
            }
          }
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const board = await ctx.service.loadKanban(project)
      const idFilter = typeof args.id === 'string' && args.id.trim() ? args.id.trim() : null
      const columnFilter = csvList(args.columns)
      const columnIds =
        columnFilter === null
          ? null
          : board.columns
              .filter(
                (c) => columnFilter.includes(c.id) || columnFilter.includes(c.title.toLowerCase())
              )
              .map((c) => c.id)
      const priorityFilter =
        args.priority === 'low' || args.priority === 'medium' || args.priority === 'high'
          ? args.priority
          : null
      const labelFilter = csvList(args.labels)
      const textFilter =
        typeof args.text === 'string' && args.text.trim() ? args.text.trim().toLowerCase() : null
      return JSON.stringify({
        ok: true,
        project,
        columns: board.columns
          .filter((c) => columnIds === null || columnIds.includes(c.id))
          .map((c) => ({
            id: c.id,
            title: c.title,
            cards: board.cards
              .filter((card) => {
                if (card.columnId !== c.id) return false
                if (idFilter && card.id !== idFilter) return false
                if (priorityFilter && card.priority !== priorityFilter) return false
                if (labelFilter) {
                  const cardLabels = card.labels.map((l) => l.toLowerCase())
                  if (!labelFilter.every((l) => cardLabels.includes(l))) return false
                }
                if (
                  textFilter &&
                  !card.title.toLowerCase().includes(textFilter) &&
                  !card.description?.toLowerCase().includes(textFilter)
                ) {
                  return false
                }
                return true
              })
              .map((card) => ({
                id: card.id,
                title: card.title,
                description: card.description
                  ? !idFilter && card.description.length > 160
                    ? `${card.description.slice(0, 160)}…`
                    : card.description
                  : undefined,
                priority: card.priority,
                dueDate: card.dueDate,
                labels: card.labels,
                assignee: card.assignee || undefined,
                storyPoints: card.storyPoints,
                attributes: attributesForAi(card, ctx)
              }))
          }))
      })
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'create_kanban_card',
        description:
          'Create a NEW kanban card in a project (only for cards that do not exist yet — to change an existing card use update_kanban_card). Defaults to the first column of the board; use the column argument to place it in another column (matched by name). The card details/body go in the description parameter — always include a description when the card carries any details; a title-only card is rarely useful.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Card title' },
            description: {
              type: 'string',
              description:
                'Card description / details (markdown). This is a dedicated field of the card — never pass it via attributes.'
            },
            column: {
              type: 'string',
              description: 'Column name to place the card in (default: the first column)'
            },
            priority: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Card priority: "high", "medium", or "low"'
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Initial labels for the card, e.g. ["demo"]'
            },
            dueDate: { type: 'string', description: 'Due date as YYYY-MM-DD' },
            storyPoints: { type: 'number', description: 'Story points estimate (number)' },
            assignee: {
              type: 'string',
              description:
                'Name of the person or bot assigned to the card (your own display name if you will work on it)'
            },
            attributes: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description:
                'Structured key/value metadata only (e.g. {"env": "prod"}). Never use for the card description or other free text.'
            },
            secretAttributes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional attribute keys (from attributes) that hold secrets'
            }
          },
          required: ['title']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      try {
        const board = await ctx.service.createKanbanCard(project, {
          title: String(args.title ?? ''),
          description: typeof args.description === 'string' ? args.description : undefined,
          column: typeof args.column === 'string' ? args.column : undefined,
          priority:
            args.priority === 'high' || args.priority === 'medium' || args.priority === 'low'
              ? args.priority
              : null,
          labels: Array.isArray(args.labels) ? args.labels.map(String) : undefined,
          dueDate: typeof args.dueDate === 'string' ? args.dueDate : null,
          storyPoints: typeof args.storyPoints === 'number' ? args.storyPoints : null,
          assignee: typeof args.assignee === 'string' ? args.assignee : undefined,
          attributes:
            args.attributes && typeof args.attributes === 'object'
              ? Object.fromEntries(
                  Object.entries(args.attributes as Record<string, unknown>).map(([k, v]) => [
                    k,
                    String(v)
                  ])
                )
              : undefined,
          secretAttributes: Array.isArray(args.secretAttributes)
            ? args.secretAttributes.map(String)
            : undefined
        })
        const card = board.cards[board.cards.length - 1]
        return JSON.stringify({ ok: true, project, card: card.title, total: board.cards.length })
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'update_kanban_card',
        description:
          'Update fields of an EXISTING kanban card (matched by title, case-insensitive) — do not create a new card. Only the provided fields are changed. The card details/body is the description parameter; never store free-form text in attributes (attributes are structured key/value metadata only). Set a field to null (or empty string for assignee) to clear it. To move a card between columns, use move_kanban_card.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Current title of the card to update' },
            newTitle: { type: 'string', description: 'New title (rename the card)' },
            description: {
              type: 'string',
              description:
                'Card description / details (markdown). This is a dedicated field of the card — never pass it via attributes.'
            },
            priority: {
              type: ['string', 'null'],
              enum: ['high', 'medium', 'low', null],
              description: 'Card priority: "high", "medium", "low" — or null to clear it'
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Replaces the card\'s whole label list — include existing labels you want to keep, e.g. ["demo", "failed"]'
            },
            dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to clear' },
            storyPoints: {
              type: ['number', 'null'],
              description: 'Story points estimate (number) — or null to clear'
            },
            assignee: {
              type: ['string', 'null'],
              description:
                'Name of the person or bot assigned to the card — to claim a card pass your own display name; empty string or null unassigns it'
            },
            attributes: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description:
                'Structured key/value metadata only (e.g. {"env": "prod"}). Never use for the card description or other free text.'
            },
            secretAttributes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Attribute keys that hold secrets'
            }
          },
          required: ['title']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const board = await ctx.service.loadKanban(project)
      const found = findCardByTitle(board, String(args.title ?? ''))
      if (!found) {
        return JSON.stringify({ ok: false, error: `Kanban card "${args.title}" not found` })
      }
      const patch: Record<string, unknown> = {}
      if (typeof args.newTitle === 'string') patch.title = args.newTitle
      if (typeof args.description === 'string') patch.description = args.description
      if (args.priority !== undefined) {
        if (args.priority === null) {
          patch.priority = null
        } else if (
          args.priority === 'high' ||
          args.priority === 'medium' ||
          args.priority === 'low'
        ) {
          patch.priority = args.priority
        } else {
          return JSON.stringify({
            ok: false,
            error: 'priority must be "high", "medium", "low" or null'
          })
        }
      }
      if (Array.isArray(args.labels)) patch.labels = args.labels.map(String)
      if ('dueDate' in args) patch.dueDate = typeof args.dueDate === 'string' ? args.dueDate : null
      if ('storyPoints' in args) {
        patch.storyPoints = typeof args.storyPoints === 'number' ? args.storyPoints : null
      }
      if ('assignee' in args) {
        patch.assignee = typeof args.assignee === 'string' ? args.assignee : ''
      }
      if (args.attributes && typeof args.attributes === 'object') {
        patch.attributes = Object.fromEntries(
          Object.entries(args.attributes as Record<string, unknown>).map(([k, v]) => [k, String(v)])
        )
      }
      if (args.secretAttributes !== undefined) {
        patch.secretAttributes = Array.isArray(args.secretAttributes)
          ? args.secretAttributes.map(String)
          : []
      }
      try {
        await ctx.service.updateKanbanCard(project, found.id, patch)
        return JSON.stringify({
          ok: true,
          project,
          updated: found.title,
          fields: Object.keys(patch)
        })
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'add_kanban_comment',
        description:
          'Add a comment to an EXISTING kanban card (matched by title, case-insensitive). Comments are short notes on the card (progress, questions, decisions) — use them instead of appending free text to the description.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Current title of the card to comment on' },
            comment: { type: 'string', description: 'Comment text to add to the card' }
          },
          required: ['title', 'comment']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const board = await ctx.service.loadKanban(project)
      const found = findCardByTitle(board, String(args.title ?? ''))
      if (!found) {
        return JSON.stringify({ ok: false, error: `Kanban card "${args.title}" not found` })
      }
      try {
        const updated = await ctx.service.addKanbanComment(project, found.id, {
          comment: String(args.comment ?? ''),
          ...(ctx.commenterName ? { commentBy: ctx.commenterName } : {})
        })
        const card = updated.cards.find((c) => c.id === found.id)
        return JSON.stringify({
          ok: true,
          project,
          card: found.title,
          commentCount: card?.comments.length ?? 0
        })
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'move_kanban_card',
        description:
          'Move an existing kanban card (matched by title, case-insensitive) to another column (matched by name).',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the card to move' },
            column: { type: 'string', description: 'Target column name' }
          },
          required: ['title', 'column']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const board = await ctx.service.loadKanban(project)
      const found = findCardByTitle(board, String(args.title ?? ''))
      if (!found) {
        return JSON.stringify({ ok: false, error: `Kanban card "${args.title}" not found` })
      }
      const column = findColumnByName(board, String(args.column ?? ''))
      if (!column) {
        return JSON.stringify({ ok: false, error: `Column "${args.column}" not found` })
      }
      try {
        await ctx.service.moveKanbanCard(project, found.id, column.id)
        return JSON.stringify({ ok: true, project, moved: found.title, column: column.title })
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'delete_kanban_card',
        description:
          'Delete an existing kanban card (matched by title, case-insensitive). A confirmation dialog is shown automatically before deleting — do not ask the user first via ask_user.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the card to delete' }
          },
          required: ['title']
        }
      }
    },
    async execute(args, ctx) {
      const project = projectOf(args, ctx)
      const board = await ctx.service.loadKanban(project)
      const found = findCardByTitle(board, String(args.title ?? ''))
      if (!found) {
        return JSON.stringify({ ok: false, error: `Kanban card "${args.title}" not found` })
      }
      const approved = await ctx.confirm({
        project,
        message: `Delete kanban card "${found.title}" from "${project}"?`,
        items: [found.title]
      })
      if (!approved) {
        return JSON.stringify({ ok: false, cancelled: true, project, card: found.title })
      }
      try {
        await ctx.service.deleteKanbanCard(project, found.id)
        return JSON.stringify({ ok: true, project, deleted: found.title })
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
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
          "Load a skill (a named instruction document) or a file inside that skill folder. Omit `file` to load the skill's SKILL.md instructions; pass `file` (relative path like FORMAT.md or doc/DOC.md, e.g. `[FORMAT.md](./FORMAT.md)` in SKILL.md) to load a sibling file referenced from SKILL.md. Skills are listed in the system prompt. Sibling files accept PDF and text (markdown, JSON, YAML, etc.); path is relative to the skill folder only.",
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
            file: {
              type: 'string',
              description:
                'Relative path of a file inside the skill folder, e.g. FORMAT.md or doc/DOC.md. Omit to load SKILL.md itself.'
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
      const rawFile = args.file as unknown
      const file = rawFile != null ? String(rawFile).trim() : ''
      if (!file) {
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
      const loaded = await ctx.service.readSkill(project, scope, name)
      if (!loaded) {
        return JSON.stringify({
          ok: false,
          error: `Skill "${name}" (${scope}) not found. Available skills: ${
            (await skillNames(ctx)).join(', ') || '(none)'
          }`
        })
      }
      if (!loaded.enabled) {
        return JSON.stringify({ ok: false, error: `Skill "${name}" (${scope}) is disabled.` })
      }
      const found = await ctx.service.readSkillFile(project, scope, name, file)
      if (!found) {
        return JSON.stringify({
          ok: false,
          error: `File "${file}" not found inside skill "${name}" (${scope}). Relative paths only.`
        })
      }
      try {
        const { text, pageCount, charCount, truncated } = await readFileAsText(found.absolutePath)
        return JSON.stringify({
          ok: true,
          scope,
          skill: name,
          file: found.path,
          pageCount,
          charCount,
          truncated,
          text
        })
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: `Could not read "${file}" in skill "${name}": ${
            err instanceof Error ? err.message : String(err)
          }`
        })
      }
    }
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'delete_skill',
        description:
          'Delete a skill (a named instruction document) for the current project (scope "project") or for all projects (scope "global"). A confirmation dialog is shown automatically before deleting — do not ask the user first via ask_user.',
        parameters: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['global', 'project'],
              description: 'Where the skill lives: "global" or "project". Defaults to "project".'
            },
            name: { type: 'string', description: 'Name of the skill to delete' }
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
          'Ask the user for input — a choice or a detail — before continuing. You may include several questions in a single call; the user answers them all at once in a dialog. Each question has an id and question text, plus optional predefined options (2-6 choices; omit options for free text, set multiple true for multi-select). For sensitive free-text answers (passwords, API keys, tokens) set secret true: the user types in a masked field and you receive a ${SECRET:<id>} token instead of the value — pass the token unchanged in later browser tool calls (e.g. browser_type text) and the real value is substituted before execution. Only call this when you genuinely need input from the user. Never use it to confirm a destructive action (delete_note, delete_kanban_card, delete_skill) — those tools show their own confirmation dialog automatically.',
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
                  },
                  secret: {
                    type: 'boolean',
                    description:
                      'True for sensitive free-text answers (passwords, API keys, tokens). Masked input; you receive a ${SECRET:<id>} token, never the value. Free text only (no options).'
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
        if (q.secret === true && (options.length > 0 || q.multiple === true)) {
          return JSON.stringify({
            ok: false,
            error: `Question "${id}" is secret and must be free text (no options, no multiple).`
          })
        }
        questions.push({
          id,
          question,
          ...(options.length > 0 ? { options } : {}),
          ...(options.length > 0 && q.multiple === true ? { multiple: true } : {}),
          ...(q.secret === true ? { secret: true } : {})
        })
      }
      if (!ctx.ask) {
        return JSON.stringify({ ok: false, error: 'ask_user requires the interactive chat' })
      }
      const res = await ctx.ask({ project: ctx.activeProject, questions })
      const secretIds = new Set(questions.filter((q) => q.secret).map((q) => q.id))
      if (res.answers.some((a) => secretIds.has(a.id) && a.answer) && !ctx.registerSecret) {
        return JSON.stringify({
          ok: false,
          error: 'ask_user secret answers require the interactive chat'
        })
      }
      let secretCount = 0
      const answers = res.answers.map((a) => {
        if (!secretIds.has(a.id) || !a.answer) return a
        secretCount += 1
        return { ...a, answer: ctx.registerSecret!(a.answer) }
      })
      return JSON.stringify({
        ok: !res.cancelled,
        cancelled: !!res.cancelled,
        answers,
        ...(secretCount > 0
          ? {
              note: `Secret answers are shown as ${secretToken('<id>')} tokens, not values. Pass a token unchanged in a later browser tool call (e.g. browser_type text) and the real value is substituted before execution. The value is never shown to you or stored.`
            }
          : {})
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
          'Read a full schedule (its task tree with status, owner, durations, plan/actual dates, %complete, notes). Each task carries a taskNo outline number (1, 1.1, 1.2, 2, ...) matching the editor, including children. Parent task values are rolled up from children. Match the schedule by id. Empty owner/note fields and childless children arrays are omitted from the output.',
        parameters: {
          type: 'object',
          properties: {
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
        const tasks = slimTasks(withTaskNo(rollupScheduleTasks(schedule.tasks, calendar), null))
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
          'Add a task to a project schedule. Match the schedule by id. Optionally nest it under an existing parent task (match the parent by id, task number or title) and/or position it directly after an existing task (match addAfter by id, task number or title; without `parent` the new task is placed as a sibling of the matched task). Plan dates follow the project working-day calendar: set both planStart and planEnd, or planStart + duration; the missing value is computed.',
        parameters: {
          type: 'object',
          properties: {
            schedule: { type: 'string', description: 'Schedule id' },
            parent: {
              type: 'string',
              description:
                'Optional parent task id, task number (e.g. 1.2) or title to nest this task under'
            },
            addAfter: {
              type: 'string',
              description:
                'Optional task id, task number (e.g. 1.2) or title to insert this new task directly after. Positions within the sibling list chosen by `parent`; if `parent` is omitted, the new task becomes a sibling of the matched task (nested under the same parent). If the task is not found, the new task is appended at the top level.'
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
        const { meta } = await requireSchedule(ctx, project, String(args.schedule ?? ''))
        const summary = await ctx.service.withSchedule(project, meta.id, async (schedule) => {
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
          const parentArg = args.parent ? findTask(schedule.tasks, String(args.parent)) : null
          const afterArg = args.addAfter ? findTask(schedule.tasks, String(args.addAfter)) : null
          const afterId = afterArg?.id ?? ''
          const parent =
            parentArg ?? (afterArg ? findTaskParent(schedule.tasks, afterArg.id) : null)
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
          return {
            save: saved,
            value: {
              ...scheduleSummary(saved, project),
              taskId: resolved.id,
              parent: parent ? parent.id : null
            }
          }
        })
        return JSON.stringify(summary)
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
          'Update an existing task in a project schedule. Match the schedule by id and the task by id, task number (e.g. 1.2) or title. Only provided fields change. For plan dates/duration, the project working-day calendar applies: change one of planStart/planEnd/duration and the other is recomputed. For parent tasks, plan start/end, %complete and duration are derived from children — update the child tasks instead (plan-field edits on a parent are rejected). Parent status and %complete are derived from children. To move a task, set `parent` to the new parent task id, task number (e.g. 1.2) or title (pass empty to move it to the top level) and/or `addAfter` to the task it should follow; the task and its subtree move together. `addAfter` positions the task within the sibling list chosen by `parent` (defaults to append); if `parent` is omitted, the task becomes a sibling of the matched `addAfter` task.',
        parameters: {
          type: 'object',
          properties: {
            schedule: { type: 'string', description: 'Schedule id' },
            task: {
              type: 'string',
              description: 'Task id (uuid), task number (e.g. 1.2) or title to update'
            },
            parent: {
              type: 'string',
              description:
                'Optional new parent task id, task number (e.g. 1.2) or title to move this task under. Pass empty to move it to the top level (omit it when using only `addAfter` to place the task next to a nested task). The task and its subtree move together. The new parent must not be the task itself or one of its descendants.'
            },
            addAfter: {
              type: 'string',
              description:
                'Optional task id, task number (e.g. 1.2) or title to position this task directly after within the sibling list chosen by `parent`. If `parent` is omitted, the task becomes a sibling of the matched task (nested under the same parent). If the task is not found, the task is appended at the top level.'
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
        const { meta } = await requireSchedule(ctx, project, String(args.schedule ?? ''))
        const summary = await ctx.service.withSchedule(project, meta.id, async (schedule) => {
          const target = String(args.task ?? '')
          const task = findTask(schedule.tasks, target)
          if (!task) {
            throw new Error(`Task "${target}" not found`)
          }
          if (
            task.children.length > 0 &&
            (args.planStart !== undefined ||
              args.planEnd !== undefined ||
              args.duration !== undefined)
          ) {
            throw new Error(
              `Task "${task.title}" is a parent task: plan start/end and duration are derived from its children. Update the child tasks instead.`
            )
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
          const afterArg = args.addAfter ? findTask(schedule.tasks, String(args.addAfter)) : null
          const afterId = afterArg?.id ?? ''
          const parent =
            parentArg ??
            (args.parent === undefined && afterArg
              ? findTaskParent(schedule.tasks, afterArg.id)
              : null)
          if (parent && (parent.id === task.id || containsTask(task, parent.id))) {
            throw new Error(
              `Cannot move task "${task.title}" under itself or one of its descendants.`
            )
          }
          const moveRequested = args.parent !== undefined || args.addAfter !== undefined

          let tasks: ScheduleTask[]
          if (moveRequested) {
            tasks = removeTaskNode(schedule.tasks, task.id)
            if (parent) {
              const parentNode = findTask(tasks, parent.id)
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
          return {
            save: saved,
            value: {
              ...scheduleSummary(saved, project),
              updated: { id: task.id, title: resolved.title },
              parent: parent ? parent.id : null
            }
          }
        })
        return JSON.stringify(summary)
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
      const reRolled = await ctx.service.rerollSchedules(project, calendar)
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
