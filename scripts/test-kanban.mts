import assert from 'node:assert/strict'
import type { KanbanCard } from '../src/shared/kanban'

const {
  emptyKanbanCardFilter,
  isKanbanFilterActive,
  matchesKanbanFilter,
  normalizeArchive,
  normalizeBoard
} = await import('../src/shared/kanban')

// Fixed "today" so date tests are deterministic: 2026-08-28
const TODAY = new Date(2026, 7, 28)

function card(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 'c1',
    title: 'Fix login bug',
    description: 'Auth flow breaks on Safari',
    columnId: 'to-do',
    priority: null,
    labels: [],
    dueDate: null,
    storyPoints: null,
    assignee: '',
    attributes: {},
    secretAttributes: [],
    comments: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

const f = { ...emptyKanbanCardFilter }

// ---- empty filter matches everything ----

assert.equal(matchesKanbanFilter(card(), f, TODAY), true)
assert.equal(isKanbanFilterActive(f), false)

// ---- query: title or description, case-insensitive, trimmed ----

assert.equal(matchesKanbanFilter(card(), { ...f, query: 'login' }, TODAY), true)
assert.equal(matchesKanbanFilter(card(), { ...f, query: 'LOGIN' }, TODAY), true)
assert.equal(matchesKanbanFilter(card(), { ...f, query: '  login ' }, TODAY), true)
assert.equal(matchesKanbanFilter(card(), { ...f, query: 'safari' }, TODAY), true)
assert.equal(matchesKanbanFilter(card(), { ...f, query: 'safari login' }, TODAY), false)
assert.equal(
  matchesKanbanFilter(card({ title: 'x', description: 'y' }), { ...f, query: 'z' }, TODAY),
  false
)
assert.equal(isKanbanFilterActive({ ...f, query: 'x' }), true)

// ---- assignee: substring, case-insensitive ----

assert.equal(
  matchesKanbanFilter(card({ assignee: 'Alice' }), { ...f, assignee: 'ali' }, TODAY),
  true
)
assert.equal(
  matchesKanbanFilter(card({ assignee: 'Alice' }), { ...f, assignee: 'ALICE' }, TODAY),
  true
)
assert.equal(
  matchesKanbanFilter(card({ assignee: 'Alice' }), { ...f, assignee: 'bob' }, TODAY),
  false
)
assert.equal(matchesKanbanFilter(card({ assignee: '' }), { ...f, assignee: 'alice' }, TODAY), false)
assert.equal(isKanbanFilterActive({ ...f, assignee: 'a' }), true)

// ---- priority: exact when set, null-priority cards excluded ----

assert.equal(
  matchesKanbanFilter(card({ priority: 'high' }), { ...f, priority: 'high' }, TODAY),
  true
)
assert.equal(
  matchesKanbanFilter(card({ priority: 'low' }), { ...f, priority: 'high' }, TODAY),
  false
)
assert.equal(
  matchesKanbanFilter(card({ priority: null }), { ...f, priority: 'high' }, TODAY),
  false
)
assert.equal(matchesKanbanFilter(card({ priority: null }), { ...f, priority: 'any' }, TODAY), true)
assert.equal(isKanbanFilterActive({ ...f, priority: 'low' }), true)
assert.equal(isKanbanFilterActive({ ...f, priority: 'any' }), false)

// ---- labels: AND semantics, case-insensitive ----

assert.equal(matchesKanbanFilter(card({ labels: ['api'] }), { ...f, labels: ['api'] }, TODAY), true)
assert.equal(matchesKanbanFilter(card({ labels: ['API'] }), { ...f, labels: ['api'] }, TODAY), true)
assert.equal(
  matchesKanbanFilter(card({ labels: ['api', 'bug'] }), { ...f, labels: ['api', 'bug'] }, TODAY),
  true
)
assert.equal(
  matchesKanbanFilter(card({ labels: ['api'] }), { ...f, labels: ['api', 'bug'] }, TODAY),
  false
)
assert.equal(matchesKanbanFilter(card({ labels: [] }), { ...f, labels: ['api'] }, TODAY), false)
assert.equal(isKanbanFilterActive({ ...f, labels: ['x'] }), true)

// ---- due: overdue / today / next N days / none ----

const overdue = card({ dueDate: '2026-08-27' })
const today = card({ dueDate: '2026-08-28' })
const in3 = card({ dueDate: '2026-08-31' })
const in7 = card({ dueDate: '2026-09-04' })
const in8 = card({ dueDate: '2026-09-05' })
const in14 = card({ dueDate: '2026-09-11' })
const in30 = card({ dueDate: '2026-09-27' })
const in31 = card({ dueDate: '2026-09-28' })
const noDate = card({ dueDate: null })

assert.equal(matchesKanbanFilter(overdue, { ...f, due: 'overdue' }, TODAY), true)
assert.equal(matchesKanbanFilter(today, { ...f, due: 'overdue' }, TODAY), false)
assert.equal(matchesKanbanFilter(in3, { ...f, due: 'overdue' }, TODAY), false)
assert.equal(matchesKanbanFilter(noDate, { ...f, due: 'overdue' }, TODAY), false)

assert.equal(matchesKanbanFilter(today, { ...f, due: 'today' }, TODAY), true)
assert.equal(matchesKanbanFilter(overdue, { ...f, due: 'today' }, TODAY), false)
assert.equal(matchesKanbanFilter(in3, { ...f, due: 'today' }, TODAY), false)

for (const c of [today, in3, in7]) {
  assert.equal(matchesKanbanFilter(c, { ...f, due: 'week1' }, TODAY), true)
}
for (const c of [overdue, in8, noDate]) {
  assert.equal(matchesKanbanFilter(c, { ...f, due: 'week1' }, TODAY), false)
}
assert.equal(matchesKanbanFilter(in14, { ...f, due: 'week2' }, TODAY), true)
assert.equal(matchesKanbanFilter(in8, { ...f, due: 'week2' }, TODAY), true)
assert.equal(matchesKanbanFilter(in30, { ...f, due: 'month1' }, TODAY), true)
assert.equal(matchesKanbanFilter(in31, { ...f, due: 'month1' }, TODAY), false)

assert.equal(matchesKanbanFilter(noDate, { ...f, due: 'none' }, TODAY), true)
for (const c of [overdue, today, in3, in30]) {
  assert.equal(matchesKanbanFilter(c, { ...f, due: 'none' }, TODAY), false)
}

assert.equal(matchesKanbanFilter(noDate, { ...f, due: 'any' }, TODAY), true)
assert.equal(matchesKanbanFilter(overdue, { ...f, due: 'any' }, TODAY), true)
assert.equal(isKanbanFilterActive({ ...f, due: 'overdue' }), true)
assert.equal(isKanbanFilterActive({ ...f, due: 'any' }), false)

// ---- filters combine with AND ----

assert.equal(
  matchesKanbanFilter(
    card({
      title: 'Fix login',
      priority: 'high',
      labels: ['api'],
      dueDate: '2026-08-30',
      assignee: 'Alice'
    }),
    { ...f, query: 'login', priority: 'high', labels: ['api'], due: 'week1', assignee: 'al' },
    TODAY
  ),
  true
)
assert.equal(
  matchesKanbanFilter(
    card({ title: 'Fix login', priority: 'low', labels: ['api'], dueDate: '2026-08-30' }),
    { ...f, query: 'login', priority: 'high', labels: ['api'], due: 'week1' }
  ),
  false
)

// ---- normalizeBoard: comments ----

const nb = normalizeBoard({
  version: 1,
  columns: [{ id: 'to-do', title: 'To Do' }],
  cards: [
    {
      title: 'A',
      columnId: 'to-do',
      comments: [
        { id: 'cm1', comment: 'hello **world**', commentBy: 'alice', timestamp: 100 },
        { comment: 'no id, by, or ts' },
        { comment: '   ' },
        null,
        'junk'
      ]
    },
    { title: 'B', columnId: 'to-do', comments: 'nope' }
  ]
})
assert.equal(nb.cards.length, 2)
const ca = nb.cards[0].comments
assert.equal(ca.length, 2)
assert.equal(ca[0].id, 'cm1')
assert.equal(ca[0].comment, 'hello **world**')
assert.equal(ca[0].commentBy, 'alice')
assert.equal(ca[0].timestamp, 100)
assert.ok(ca[1].id.length > 0)
assert.equal(ca[1].comment, 'no id, by, or ts')
assert.equal(ca[1].commentBy, 'you')
assert.equal(typeof ca[1].timestamp, 'number')
assert.deepEqual(nb.cards[1].comments, [])

// ---- normalizeArchive: same card shape, no columns ----

assert.deepEqual(normalizeArchive(undefined), { version: 1, cards: [] })
assert.deepEqual(normalizeArchive(null), { version: 1, cards: [] })
assert.deepEqual(normalizeArchive('junk'), { version: 1, cards: [] })

const na = normalizeArchive({
  version: 1,
  columns: [{ id: 'gone', title: 'Gone' }],
  cards: [
    { title: 'Archived A', columnId: 'old-column', dueDate: '2026-01-02', priority: 'low' },
    { title: '   ' },
    null,
    { title: 'Archived B' }
  ]
})
assert.equal(na.version, 1)
assert.equal(na.cards.length, 2)
assert.equal(na.cards[0].title, 'Archived A')
assert.equal(na.cards[0].columnId, 'old-column', 'archive keeps the original column id')
assert.equal(na.cards[0].dueDate, '2026-01-02')
assert.equal(na.cards[0].priority, 'low')
assert.equal(na.cards[1].title, 'Archived B')
assert.equal(na.cards[1].columnId, 'to-do', 'missing column id falls back to to-do')
assert.ok(!('columns' in na), 'archive has no columns')

console.log('test-kanban: all assertions passed')
