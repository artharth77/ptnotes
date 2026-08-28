import { slugify } from './slug'

export type KanbanPriority = 'high' | 'medium' | 'low'

export interface KanbanColumn {
  id: string
  title: string
  color: string | null
  highlightOverdue: boolean
}

export const KANBAN_COLUMN_COLORS: string[] = [
  '#e5484d',
  '#f76b15',
  '#ff8b00',
  '#f5c518',
  '#d9a514',
  '#8fce00',
  '#46a758',
  '#12a594',
  '#0091d5',
  '#3e63dd',
  '#5748d6',
  '#7a5af8',
  '#8e4ec6',
  '#d6409f',
  '#e93d82',
  '#9a6624',
  '#8b8d98'
]

export interface KanbanCardComment {
  id: string
  comment: string
  commentBy: string
  timestamp: number
}

export interface KanbanCard {
  id: string
  title: string
  description: string
  comments: KanbanCardComment[]
  columnId: string
  priority: KanbanPriority | null
  labels: string[]
  dueDate: string | null
  storyPoints: number | null
  assignee: string
  attributes: Record<string, string>
  secretAttributes: string[]
  createdAt: number
  updatedAt: number
}

export interface KanbanBoard {
  version: 1
  columns: KanbanColumn[]
  cards: KanbanCard[]
}

export interface KanbanArchive {
  version: 1
  cards: KanbanCard[]
}

export interface KanbanArchiveMove {
  board: KanbanBoard
  archive: KanbanArchive
}

export interface NewKanbanCardInput {
  title: string
  description?: string
  column?: string
  priority?: KanbanPriority | null
  labels?: string[]
  dueDate?: string | null
  storyPoints?: number | null
  assignee?: string
  attributes?: Record<string, string>
  secretAttributes?: string[]
}

export type KanbanCardPatch = Partial<Omit<KanbanCard, 'id' | 'createdAt'>>

export const KANBAN_DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', title: 'Backlog', color: '#8b8d98', highlightOverdue: true },
  { id: 'to-do', title: 'To Do', color: '#0091d5', highlightOverdue: true },
  { id: 'in-progress', title: 'In Progress', color: '#f5c518', highlightOverdue: true },
  { id: 'done', title: 'Done', color: '#46a758', highlightOverdue: false }
]

export function defaultBoard(): KanbanBoard {
  return { version: 1, columns: KANBAN_DEFAULT_COLUMNS.map((c) => ({ ...c })), cards: [] }
}

export function defaultArchive(): KanbanArchive {
  return { version: 1, cards: [] }
}

export function newCardId(): string {
  return crypto.randomUUID()
}

export function newCommentId(): string {
  return crypto.randomUUID()
}

const PRIORITIES: KanbanPriority[] = ['high', 'medium', 'low']

function normalizeCard(raw: Record<string, unknown>): KanbanCard | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!title) return null
  const columnId = typeof raw.columnId === 'string' && raw.columnId.trim() ? raw.columnId : 'to-do'
  const priority = PRIORITIES.includes(raw.priority as KanbanPriority)
    ? (raw.priority as KanbanPriority)
    : null
  const labels = Array.isArray(raw.labels)
    ? raw.labels
        .filter((l): l is string => typeof l === 'string' && l.trim() !== '')
        .map((l) => l.trim())
    : []
  const dueDate =
    typeof raw.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate) ? raw.dueDate : null
  const storyPoints =
    typeof raw.storyPoints === 'number' && Number.isInteger(raw.storyPoints) && raw.storyPoints >= 0
      ? raw.storyPoints
      : null
  const attributes: Record<string, string> = {}
  if (raw.attributes && typeof raw.attributes === 'object') {
    for (const [k, v] of Object.entries(raw.attributes as Record<string, unknown>)) {
      if (typeof v === 'string') attributes[k] = v
    }
  }
  const secretAttributes = Array.isArray(raw.secretAttributes)
    ? raw.secretAttributes.filter((k): k is string => typeof k === 'string' && k in attributes)
    : []
  const comments: KanbanCardComment[] = []
  if (Array.isArray(raw.comments)) {
    for (const rc of raw.comments) {
      if (!rc || typeof rc !== 'object') continue
      const comment = typeof rc.comment === 'string' ? rc.comment : ''
      if (!comment.trim()) continue
      comments.push({
        id: typeof rc.id === 'string' && rc.id ? rc.id : newCommentId(),
        comment,
        commentBy: typeof rc.commentBy === 'string' && rc.commentBy.trim() ? rc.commentBy : 'you',
        timestamp: typeof rc.timestamp === 'number' ? rc.timestamp : Date.now()
      })
    }
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newCardId(),
    title,
    description: typeof raw.description === 'string' ? raw.description : '',
    comments,
    columnId,
    priority,
    labels,
    dueDate,
    storyPoints,
    assignee: typeof raw.assignee === 'string' ? raw.assignee : '',
    attributes,
    secretAttributes,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
  }
}

export function normalizeBoard(board: unknown): KanbanBoard {
  const base = defaultBoard()
  if (!board || typeof board !== 'object') return base
  const b = board as Partial<KanbanBoard>
  const columns: KanbanColumn[] = []
  const seen = new Set<string>()
  if (Array.isArray(b.columns)) {
    for (const col of b.columns) {
      if (!col || typeof col !== 'object') continue
      const title = typeof col.title === 'string' ? col.title.trim() : ''
      if (!title) continue
      let id = typeof col.id === 'string' && col.id.trim() ? col.id.trim() : slugify(title)
      if (seen.has(id)) {
        let n = 2
        while (seen.has(`${id}-${n}`)) n++
        id = `${id}-${n}`
      }
      seen.add(id)
      const color = KANBAN_COLUMN_COLORS.includes(col.color as string)
        ? (col.color as string)
        : null
      const highlightOverdue =
        typeof col.highlightOverdue === 'boolean' ? col.highlightOverdue : id !== 'done'
      columns.push({ id, title, color, highlightOverdue })
    }
  }
  if (columns.length === 0) columns.push(...base.columns)
  const firstId = columns[0].id
  const cards: KanbanCard[] = []
  if (Array.isArray(b.cards)) {
    for (const raw of b.cards) {
      if (!raw || typeof raw !== 'object') continue
      const card = normalizeCard(raw as unknown as Record<string, unknown>)
      if (!card) continue
      card.columnId = columns.some((c) => c.id === card.columnId) ? card.columnId : firstId
      cards.push(card)
    }
  }
  return { version: 1, columns, cards }
}

export function normalizeArchive(archive: unknown): KanbanArchive {
  if (!archive || typeof archive !== 'object') return defaultArchive()
  const a = archive as Partial<KanbanArchive>
  const cards: KanbanCard[] = []
  if (Array.isArray(a.cards)) {
    for (const raw of a.cards) {
      if (!raw || typeof raw !== 'object') continue
      const card = normalizeCard(raw as unknown as Record<string, unknown>)
      if (card) cards.push(card)
    }
  }
  return { version: 1, cards }
}

export function findCardByTitle(board: KanbanBoard, title: string): KanbanCard | undefined {
  const q = title.trim().toLowerCase()
  return board.cards.find((c) => c.title.toLowerCase() === q)
}

export function findColumnByName(board: KanbanBoard, name: string): KanbanColumn | undefined {
  const q = name.trim().toLowerCase()
  if (!q) return undefined
  return board.columns.find(
    (c) => c.id === q || c.id === slugify(name) || c.title.toLowerCase() === q
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function parseDueDate(dueDate: string): Date | null {
  const m = dueDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

export function daysUntil(dueDate: string, today: Date = new Date()): number {
  const d = parseDueDate(dueDate)
  if (!d) return 0
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((d.getTime() - t.getTime()) / 86400000)
}

export function isOverdue(dueDate: string, today: Date = new Date()): boolean {
  return daysUntil(dueDate, today) < 0
}

export function formatAbsoluteDate(dueDate: string): string {
  const d = parseDueDate(dueDate)
  if (!d) return dueDate
  return `${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`
}

export function formatDueDate(dueDate: string, today: Date = new Date()): string {
  const diff = daysUntil(dueDate, today)
  if (diff < 0) return formatAbsoluteDate(dueDate)
  if (diff === 0) return 'today'
  if (diff === 1) return '1 day'
  if (diff < 7) return `${diff} days`
  if (diff < 14) return '1 week'
  return formatAbsoluteDate(dueDate)
}

export type KanbanDueFilter = 'any' | 'overdue' | 'today' | 'week1' | 'week2' | 'month1' | 'none'

export interface KanbanCardFilter {
  query: string
  assignee: string
  priority: KanbanPriority | 'any'
  labels: string[]
  due: KanbanDueFilter
}

export const emptyKanbanCardFilter: KanbanCardFilter = {
  query: '',
  assignee: '',
  priority: 'any',
  labels: [],
  due: 'any'
}

export function isKanbanFilterActive(f: KanbanCardFilter): boolean {
  return (
    f.query.trim() !== '' ||
    f.assignee.trim() !== '' ||
    f.priority !== 'any' ||
    f.labels.length > 0 ||
    f.due !== 'any'
  )
}

const DUE_FILTER_MAX_DAYS: Record<'week1' | 'week2' | 'month1', number> = {
  week1: 7,
  week2: 14,
  month1: 30
}

export function matchesKanbanFilter(
  card: KanbanCard,
  f: KanbanCardFilter,
  today: Date = new Date()
): boolean {
  const q = f.query.trim().toLowerCase()
  if (q && !card.title.toLowerCase().includes(q) && !card.description.toLowerCase().includes(q)) {
    return false
  }
  const assignee = f.assignee.trim().toLowerCase()
  if (assignee && !card.assignee.trim().toLowerCase().includes(assignee)) return false
  if (f.priority !== 'any' && card.priority !== f.priority) return false
  if (f.labels.length > 0) {
    const cardLabels = card.labels.map((l) => l.toLowerCase())
    for (const label of f.labels) {
      if (!cardLabels.includes(label.trim().toLowerCase())) return false
    }
  }
  if (f.due !== 'any') {
    const days = card.dueDate ? daysUntil(card.dueDate, today) : null
    if (f.due === 'none') {
      if (days !== null) return false
    } else if (days === null) {
      return false
    } else if (f.due === 'overdue') {
      if (days >= 0) return false
    } else if (f.due === 'today') {
      if (days !== 0) return false
    } else if (days < 0 || days > DUE_FILTER_MAX_DAYS[f.due]) {
      return false
    }
  }
  return true
}
