import Module from 'node:module'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'

const ROOT = '/tmp/ptnotes-ai-test-root'

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return { app: { getPath: () => ROOT, getAppPath: () => ROOT } }
  }
  return origLoad.call(this, request, parent, isMain)
}

await fs.rm(ROOT, { recursive: true, force: true })

const { PTNotesService } = await import('../src/main/service/PTNotesService')
const { tools } = await import('../src/main/ai/tools')
const { extractFromHtml } = await import('../src/main/ai/search/webFetch')
import type { ToolContext } from '../src/main/ai/tools'

const service = new PTNotesService(ROOT)
await service.createProject('Research')
const ctx: ToolContext = {
  service,
  activeProject: 'Research',
  confirm: async () => true
}

const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
  const tool = tools.find((t) => t.definition.function.name === name)
  assert.ok(tool, `tool ${name} exists`)
  const res = await tool.execute(args, ctx)
  return JSON.parse(res)
}

const callWith = async (
  name: string,
  args: Record<string, unknown>,
  extra: Partial<ToolContext>
): Promise<unknown> => {
  const tool = tools.find((t) => t.definition.function.name === name)
  assert.ok(tool, `tool ${name} exists`)
  const res = await tool.execute(args, { ...ctx, ...extra })
  return JSON.parse(res)
}

// create_note
let r = await call('create_note', { title: 'Electron Tips', content: '# Electron\n\nUse sandbox.' })
assert.equal(r.ok, true)
assert.equal(r.action, 'created')
assert.equal(await service.readNote('Research', 'electron-tips'), '# Electron\n\nUse sandbox.')

// create_note on an existing title replaces the entire content (full rewrite)
r = await call('create_note', { title: 'electron tips', content: '# Electron\n\nv2' })
assert.equal(r.ok, true)
assert.equal(r.action, 'updated')
assert.equal(await service.readNote('Research', 'electron-tips'), '# Electron\n\nv2')

// update_note: line-based, diff-style hunks
await call('create_note', { title: 'Patch Note', content: 'l1\nl2\nl3\nl4\nl5' })

// replace a middle range
r = await call('update_note', {
  title: 'patch-note',
  edits: [{ startLine: 2, endLine: 3, content: 'x\ny' }]
})
assert.equal(r.ok, true)
assert.equal(r.action, 'updated')
assert.equal(r.note, 'patch-note')
assert.equal(r.edits, 1)
assert.equal(r.totalLines, 5)
assert.equal(await service.readNote('Research', 'patch-note'), 'l1\nx\ny\nl4\nl5')

// insert before a line (endLine = startLine - 1)
r = await call('update_note', {
  title: 'patch-note',
  edits: [{ startLine: 1, endLine: 0, content: 'top' }]
})
assert.equal(r.ok, true)
assert.equal(r.totalLines, 6)
assert.equal(await service.readNote('Research', 'patch-note'), 'top\nl1\nx\ny\nl4\nl5')

// append at the end (startLine = totalLines + 1)
r = await call('update_note', {
  title: 'patch-note',
  edits: [{ startLine: 7, endLine: 6, content: 'bottom' }]
})
assert.equal(r.ok, true)
assert.equal(r.totalLines, 7)
assert.equal(await service.readNote('Research', 'patch-note'), 'top\nl1\nx\ny\nl4\nl5\nbottom')

// delete a line (empty content)
r = await call('update_note', {
  title: 'patch-note',
  edits: [{ startLine: 2, endLine: 2, content: '' }]
})
assert.equal(r.ok, true)
assert.equal(r.totalLines, 6)
assert.equal(await service.readNote('Research', 'patch-note'), 'top\nx\ny\nl4\nl5\nbottom')

// multiple hunks in one call use the original line numbers (applied bottom-up)
await call('create_note', { title: 'Multi Hunk', content: 'a\nb\nc\nd\ne' })
r = await call('update_note', {
  title: 'multi-hunk',
  edits: [
    { startLine: 1, endLine: 1, content: 'A1\nA2' },
    { startLine: 5, endLine: 5, content: 'E' },
    { startLine: 3, endLine: 2, content: 'inserted' }
  ]
})
assert.equal(r.ok, true)
assert.equal(r.edits, 3)
assert.equal(r.totalLines, 7)
assert.equal(await service.readNote('Research', 'multi-hunk'), 'A1\nA2\nb\ninserted\nc\nd\nE')

// overlapping hunks are rejected (nothing written)
r = await call('update_note', {
  title: 'patch-note',
  edits: [
    { startLine: 1, endLine: 3, content: 'a' },
    { startLine: 2, endLine: 4, content: 'b' }
  ]
})
assert.equal(r.ok, false)
assert.match(r.error, /overlap/)

// insertion inside another hunk's range is rejected
r = await call('update_note', {
  title: 'patch-note',
  edits: [
    { startLine: 2, endLine: 4, content: 'a' },
    { startLine: 3, endLine: 2, content: 'b' }
  ]
})
assert.equal(r.ok, false)
assert.match(r.error, /inside/)

// out-of-range endLine fails with totalLines
r = await call('update_note', {
  title: 'patch-note',
  edits: [{ startLine: 5, endLine: 99, content: 'x' }]
})
assert.equal(r.ok, false)
assert.equal(r.totalLines, 6)
assert.match(r.error, /beyond the end/)

// out-of-range insertion fails
r = await call('update_note', {
  title: 'patch-note',
  edits: [{ startLine: 99, endLine: 98, content: 'x' }]
})
assert.equal(r.ok, false)
assert.match(r.error, /cannot insert/)

// invalid hunk shape fails
r = await call('update_note', { title: 'patch-note', edits: [{ startLine: 1, content: 'x' }] })
assert.equal(r.ok, false)
assert.match(r.error, /endLine/)

// empty edits array fails
r = await call('update_note', { title: 'patch-note', edits: [] })
assert.equal(r.ok, false)

// missing note is an error suggesting create_note
r = await call('update_note', {
  title: 'no-such-note',
  edits: [{ startLine: 1, endLine: 0, content: 'x' }]
})
assert.equal(r.ok, false)
assert.match(r.error, /create_note/)

// trailing newline is preserved
await service.saveNote('Research', 'patch-note', 'a\nb\n')
r = await call('update_note', {
  title: 'patch-note',
  edits: [{ startLine: 2, endLine: 2, content: 'B' }]
})
assert.equal(r.ok, true)
assert.equal(await service.readNote('Research', 'patch-note'), 'a\nB\n')

// insertion into an empty note
await service.saveNote('Research', 'patch-note', '')
r = await call('update_note', {
  title: 'patch-note',
  edits: [{ startLine: 1, endLine: 0, content: 'first' }]
})
assert.equal(r.ok, true)
assert.equal(r.totalLines, 1)
assert.equal(await service.readNote('Research', 'patch-note'), 'first')

// concurrency: parallel update_note calls apply serially against fresh content
await call('create_note', { title: 'Concurrent', content: 'a\nb\nc' })
const concurrentEdits = await Promise.all([
  call('update_note', {
    title: 'concurrent',
    edits: [{ startLine: 1, endLine: 1, content: 'A' }]
  }),
  call('update_note', {
    title: 'concurrent',
    edits: [{ startLine: 3, endLine: 3, content: 'C' }]
  })
])
assert.equal(
  concurrentEdits.every((x) => (x as { ok: boolean }).ok),
  true
)
assert.equal(await service.readNote('Research', 'concurrent'), 'A\nb\nC', 'both hunks landed')

// concurrency: parallel create_note with the same title creates exactly one note
const dupCreates = await Promise.all(
  Array.from({ length: 5 }, (_, i) => call('create_note', { title: 'Dup Note', content: `v${i}` }))
)
assert.equal(
  dupCreates.every((x) => (x as { ok: boolean }).ok),
  true
)
const dupNames = (await service.listNotes('Research')).map((n) => n.id)
assert.equal(dupNames.filter((n) => n === 'dup-note').length, 1, 'single dup-note file')
assert.equal(dupNames.filter((n) => n.startsWith('dup-note-')).length, 0, 'no duplicate notes')

// list_notes / read_note
r = await call('list_notes', {})
assert.ok(Array.isArray(r.notes) && r.notes.includes('electron-tips'))
r = await call('read_note', { title: 'electron-tips' })
assert.match(r.content, /v2/)

// read_note with no title reads the active note
r = await callWith('read_note', {}, { activeNoteId: 'electron-tips' })
assert.equal(r.ok, true)
assert.equal(r.note, 'electron-tips')
assert.match(r.content, /v2/)

// read_note with no title and no active note fails
r = await call('read_note', {})
assert.equal(r.ok, false)

// read_note with title overrides the active note
await call('create_note', { title: 'Active Override', content: 'override body' })
r = await callWith('read_note', { title: 'Active Override' }, { activeNoteId: 'electron-tips' })
assert.equal(r.note, 'active-override')
assert.match(r.content, /override body/)

// read_note line range
await call('create_note', { title: 'Range Note', content: 'l1\nl2\nl3\nl4\nl5' })
r = await call('read_note', { title: 'range-note' })
assert.equal(r.ok, true)
assert.equal(r.content, '1: l1\n2: l2\n3: l3\n4: l4\n5: l5')
assert.equal(r.totalLines, 5)
assert.equal(r.startLine, undefined)
assert.equal(r.endLine, undefined)

// ranged reads keep the note's absolute line numbers
r = await call('read_note', { title: 'range-note', startLine: 2, endLine: 3 })
assert.equal(r.content, '2: l2\n3: l3')
assert.equal(r.startLine, 2)
assert.equal(r.endLine, 3)
assert.equal(r.totalLines, 5)

r = await call('read_note', { title: 'range-note', startLine: 4 })
assert.equal(r.content, '4: l4\n5: l5')
assert.equal(r.startLine, 4)
assert.equal(r.endLine, 5)

r = await call('read_note', { title: 'range-note', endLine: 2 })
assert.equal(r.content, '1: l1\n2: l2')
assert.equal(r.startLine, 1)
assert.equal(r.endLine, 2)

// endLine beyond the note clamps to the last line
r = await call('read_note', { title: 'range-note', startLine: 4, endLine: 99 })
assert.equal(r.content, '4: l4\n5: l5')
assert.equal(r.endLine, 5)

// startLine beyond the note fails with totalLines
r = await call('read_note', { title: 'range-note', startLine: 6 })
assert.equal(r.ok, false)
assert.equal(r.totalLines, 5)
assert.match(r.error, /5 line/)

// startLine after endLine fails
r = await call('read_note', { title: 'range-note', startLine: 3, endLine: 2 })
assert.equal(r.ok, false)
assert.match(r.error, /less than or equal/)

// non-integer line argument fails
r = await call('read_note', { title: 'range-note', startLine: 'abc' })
assert.equal(r.ok, false)
assert.match(r.error, /integers/)

// trailing newline does not count as an extra line
await call('create_note', { title: 'Trailing Newline', content: 'a\nb\n' })
r = await call('read_note', { title: 'trailing-newline' })
assert.equal(r.totalLines, 2)
assert.equal(r.content, '1: a\n2: b')

// list_notes with query
await call('create_note', { title: 'Meeting Notes', content: 'Agenda' })
r = await call('list_notes', { query: 'electron' })
assert.equal(r.notes.length, 1)
assert.equal(r.notes[0].name, 'electron-tips')
r = await call('list_notes', { query: 'meet' })
assert.equal(r.notes.length, 1)
assert.equal(r.notes[0].name, 'meeting-notes')
r = await call('list_notes', { query: 'zzz-no-match' })
assert.equal(r.notes.length, 0)
// content match (query only appears in note body, not the slug)
await call('create_note', { title: 'Q2 Ideas', content: 'The strawberry roadmap' })
r = await call('list_notes', { query: 'strawberry' })
assert.equal(r.notes.length, 1)
assert.equal(r.notes[0].name, 'q2-ideas')
assert.match(r.notes[0].snippet ?? '', /strawberry/)

// create_kanban_card
r = await call('create_kanban_card', { title: 'Task A', priority: 'high', labels: ['demo'] })
assert.equal(r.ok, true)
assert.equal(r.total, 1)
r = await call('create_kanban_card', { title: 'Task B', column: 'Backlog' })
assert.equal(r.ok, true)
assert.equal(r.total, 2)

// list_kanban_cards (grouped by column; no column arg defaults to the first column)
r = await call('list_kanban_cards', {})
const backlogCol = r.columns.find((c: { id: string }) => c.id === 'backlog')
assert.equal(backlogCol.cards.length, 2)
assert.equal(backlogCol.cards[0].title, 'Task A')
assert.equal(backlogCol.cards[0].priority, 'high')
assert.equal(backlogCol.cards[1].title, 'Task B')

// list_kanban_cards optional filters (id / columns / priority / labels)
const boardForFilter = await service.loadKanban('Research')
const taskAId = boardForFilter.cards.find((c) => c.title === 'Task A')!.id
r = await call('list_kanban_cards', { id: taskAId })
assert.equal(
  r.columns.reduce((n: number, c: { cards: unknown[] }) => n + c.cards.length, 0),
  1,
  'id filter matches a single card'
)
assert.equal(
  r.columns.flatMap((c: { cards: { id?: string }[] }) => c.cards)[0]?.id,
  taskAId,
  'listed cards include their id'
)
r = await call('list_kanban_cards', { columns: 'Backlog, to-do' })
assert.equal(r.columns.length, 2, 'column filter matches by id or title')
assert.equal(
  r.columns.reduce((n: number, c: { cards: unknown[] }) => n + c.cards.length, 0),
  2
)
r = await call('list_kanban_cards', { columns: 'Nope' })
assert.equal(r.columns.length, 0, 'unknown column name matches nothing')
r = await call('list_kanban_cards', { priority: 'high' })
assert.equal(
  r.columns.reduce((n: number, c: { cards: unknown[] }) => n + c.cards.length, 0),
  1
)
r = await call('list_kanban_cards', { priority: 'any' })
assert.equal(
  r.columns.reduce((n: number, c: { cards: unknown[] }) => n + c.cards.length, 0),
  2,
  '"any" does not filter'
)
r = await call('list_kanban_cards', { labels: 'demo' })
assert.equal(
  r.columns.reduce((n: number, c: { cards: unknown[] }) => n + c.cards.length, 0),
  1
)
r = await call('list_kanban_cards', { labels: 'demo, other' })
assert.equal(
  r.columns.reduce((n: number, c: { cards: unknown[] }) => n + c.cards.length, 0),
  0,
  'labels combine with AND semantics'
)
// text filter (case-insensitive substring on title or description)
await call('create_kanban_card', {
  title: 'Deploy Docs',
  description: 'Publish the strawberry guide'
})
r = await call('list_kanban_cards', { text: 'deploy' })
assert.equal(
  r.columns.reduce((n: number, c: { cards: unknown[] }) => n + c.cards.length, 0),
  1,
  'text filter matches the title case-insensitively'
)
r = await call('list_kanban_cards', { text: 'STRAWBERRY' })
assert.equal(
  r.columns.reduce((n: number, c: { cards: unknown[] }) => n + c.cards.length, 0),
  1,
  'text filter matches the description case-insensitively'
)
r = await call('list_kanban_cards', { text: 'zzz-no-match' })
assert.equal(
  r.columns.reduce((n: number, c: { cards: unknown[] }) => n + c.cards.length, 0),
  0,
  'text filter without a match lists nothing'
)
await call('delete_kanban_card', { title: 'Deploy Docs' })

// id filter returns the full (untrimmed) description
const longDesc = 'x'.repeat(200)
await call('create_kanban_card', { title: 'Long Desc', description: longDesc })
const longDescId = (await service.loadKanban('Research')).cards.find(
  (c) => c.title === 'Long Desc'
)!.id
r = await call('list_kanban_cards', { id: longDescId })
assert.equal(
  r.columns.flatMap((c: { cards: { description?: string }[] }) => c.cards)[0].description,
  longDesc,
  'single-card lookup keeps the full description'
)
r = await call('list_kanban_cards', { columns: 'Backlog' })
const longDescEntry = r.columns
  .flatMap((c: { cards: { title: string; description?: string }[] }) => c.cards)
  .find((c: { title: string }) => c.title === 'Long Desc')
assert.ok(longDescEntry?.description?.endsWith('…'), 'grouped listing trims long descriptions')
await call('delete_kanban_card', { title: 'Long Desc' })

// secret attribute values are masked as ${K_SECRET:<id>|<key>} tokens; plain values stay readable
await call('create_kanban_card', {
  title: 'Secret Attr',
  attributes: { apiKey: 'sk-secret-123', env: 'prod' },
  secretAttributes: ['apiKey']
})
r = await call('list_kanban_cards', { columns: 'Backlog' })
const secretEntry = r.columns
  .flatMap((c: { cards: { title: string; attributes?: Record<string, string> }[] }) => c.cards)
  .find((c: { title: string }) => c.title === 'Secret Attr')
assert.ok(secretEntry, 'Secret Attr listed')
assert.match(
  secretEntry.attributes.apiKey,
  /^\$\{K_SECRET:[0-9a-f]+\|apiKey\}$/,
  'secret value masked as a kanban secret token'
)
assert.equal(secretEntry.attributes.env, 'prod', 'non-secret attribute value returned plainly')
assert.ok(!JSON.stringify(r).includes('sk-secret-123'), 'raw secret value never in tool output')
await call('delete_kanban_card', { title: 'Secret Attr' })

// update_kanban_card (matched by title, case-insensitive; only provided fields)
r = await call('update_kanban_card', { title: 'task a', newTitle: 'Task A2', storyPoints: 3 })
assert.equal(r.ok, true)
assert.deepEqual(r.fields, ['title', 'storyPoints'])
r = await call('update_kanban_card', { title: 'Task A2', priority: null })
assert.equal(r.ok, true, 'null clears the priority')

// move_kanban_card
r = await call('move_kanban_card', { title: 'Task A2', column: 'Done' })
assert.equal(r.ok, true)
assert.equal(r.column, 'Done')

// delete_kanban_card (confirmation required)
r = await callWith('delete_kanban_card', { title: 'Task B' }, { confirm: async () => false })
assert.equal(r.ok, false)
assert.equal(r.cancelled, true)
r = await call('delete_kanban_card', { title: 'Task B' })
assert.equal(r.ok, true)
r = await call('list_kanban_cards', {})
assert.equal(
  r.columns.reduce((n: number, c: { cards: unknown[] }) => n + c.cards.length, 0),
  1,
  'only Task A2 remains'
)

// target another project via arg
await service.createProject('Other')
r = await call('create_note', { project: 'Other', title: 'Hi', content: 'x' })
assert.equal(r.project, 'Other')

// tool error handling (read_note missing)
r = await call('read_note', { title: 'missing-note' })
assert.equal(r.ok, false)

// create_skill (project scope)
r = await call('create_skill', {
  scope: 'project',
  name: 'Code Review',
  description: 'Review code before merging',
  content: '1. Read the diff\n2. Check the tests pass'
})
assert.equal(r.ok, true)
assert.equal(r.action, 'created')
assert.equal(r.name, 'code-review')

// read_skill
r = await call('read_skill', { scope: 'project', name: 'code-review' })
assert.equal(r.ok, true)
assert.match(r.content, /Read the diff/)

// read_skill with file: sibling file referenced from SKILL.md (merged read_skill_file)
const skillFolder = `${ROOT}/Research/.data/skills/code-review`
await fs.mkdir(`${skillFolder}/doc`, { recursive: true })
await fs.writeFile(`${skillFolder}/FORMAT.md`, '# Format\n\nUse tabs.\n', 'utf8')
await fs.writeFile(`${skillFolder}/doc/DOC.md`, '# Doc\n\nDetails here.\n', 'utf8')
r = await call('read_skill', { scope: 'project', name: 'code-review', file: 'FORMAT.md' })
assert.equal(r.ok, true)
assert.match(r.text, /Use tabs/)
r = await call('read_skill', {
  scope: 'project',
  name: 'code-review',
  file: 'doc/DOC.md'
})
assert.equal(r.ok, true)
assert.match(r.text, /Details here/)

// read_skill with file: missing file and traversal are refused
r = await call('read_skill', { scope: 'project', name: 'code-review', file: 'nope.md' })
assert.equal(r.ok, false, 'missing file refused')
r = await call('read_skill', {
  scope: 'project',
  name: 'code-review',
  file: '../FORMAT.md'
})
assert.equal(r.ok, false, 'traversal refused')

// create_skill (global scope)
r = await call('create_skill', {
  scope: 'global',
  name: 'tone',
  description: 'Write concisely',
  content: 'Be short and direct.'
})
assert.equal(r.ok, true)
assert.equal(r.scope, 'global')

// renderSkillsIndex includes both scopes with name — description
const index = await service.renderSkillsIndex('Research')
assert.match(index, /Global skills:/)
assert.match(index, /- tone — Write concisely/)
assert.match(index, /Project skills:/)
assert.match(index, /- code-review — Review code before merging/)

// disabled skills are excluded from the index and refused by read_skill
await service.setSkillEnabled('Research', 'project', 'code-review', false)
const index2 = await service.renderSkillsIndex('Research')
assert.ok(!index2.includes('code-review'), 'disabled skill excluded from index')
assert.ok(index2.includes('tone'), 'enabled global skill still listed')
r = await call('read_skill', { scope: 'project', name: 'code-review' })
assert.equal(r.ok, false, 'disabled skill refused')
await service.setSkillEnabled('Research', 'project', 'code-review', true)
r = await call('read_skill', { scope: 'project', name: 'code-review' })
assert.equal(r.ok, true, 're-enabled skill readable')

// upsert (update) existing skill
r = await call('create_skill', {
  scope: 'project',
  name: 'Code Review',
  description: 'Updated desc',
  content: 'v2'
})
assert.equal(r.action, 'updated')
assert.equal(
  await (
    await service.readSkill('Research', 'project', 'code-review')
  )?.description,
  'Updated desc'
)

// delete_skill (confirm resolves true in test context)
r = await call('delete_skill', { scope: 'project', name: 'code-review' })
assert.equal(r.ok, true)
r = await call('read_skill', { scope: 'project', name: 'code-review' })
assert.equal(r.ok, false, 'deleted skill is gone')

// webFetch local extraction
const html = `<html><head><title>Test Page</title></head><body>
<script>bad()</script>
<nav>Nav junk</nav>
<h1>Hello</h1>
<p>This is <b>important</b> content for testing.</p>
<ul><li>One</li><li>Two</li></ul>
</body></html>`
const page = extractFromHtml(html, 'https://example.com')
assert.equal(page.title, 'Test Page')
assert.match(page.text, /This is important content/)
assert.ok(!page.text.includes('Nav junk'), 'nav stripped')
assert.ok(!page.text.includes('bad()'), 'scripts stripped')

console.log('AI TOOLS TESTS PASSED')
