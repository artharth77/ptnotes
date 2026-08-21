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

// update_note (existing)
r = await call('update_note', { title: 'electron tips', content: '# Electron\n\nv2' })
assert.equal(r.action, 'updated')
assert.equal(await service.readNote('Research', 'electron-tips'), '# Electron\n\nv2')

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

// search_notes
await call('create_note', { title: 'Meeting Notes', content: 'Agenda' })
r = await call('search_notes', { query: 'electron' })
assert.equal(r.notes.length, 1)
assert.equal(r.notes[0].name, 'electron-tips')
r = await call('search_notes', { query: 'meet' })
assert.equal(r.notes.length, 1)
assert.equal(r.notes[0].name, 'meeting-notes')
r = await call('search_notes', { query: 'zzz-no-match' })
assert.equal(r.notes.length, 0)
// content match (query only appears in note body, not the slug)
await call('create_note', { title: 'Q2 Ideas', content: 'The strawberry roadmap' })
r = await call('search_notes', { query: 'strawberry' })
assert.equal(r.notes.length, 1)
assert.equal(r.notes[0].name, 'q2-ideas')
assert.match(r.notes[0].snippet ?? '', /strawberry/)

// create_todos
r = await call('create_todos', { tasks: ['Task A', 'Task B'] })
assert.equal(r.total, 2)

// list_todos / toggle_todo / delete_todo
r = await call('list_todos', {})
assert.equal(r.todos.length, 2)
r = await call('toggle_todo', { text: 'Task A' })
assert.equal(r.nowDone, true)
r = await call('delete_todo', { text: 'Task B' })
assert.equal(r.ok, true)
r = await call('list_todos', {})
assert.equal(r.todos.length, 1)
assert.equal(r.todos[0].done, true)

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

// read_skill_file: sibling file referenced from SKILL.md
const skillFolder = `${ROOT}/Research/.data/skills/code-review`
await fs.mkdir(`${skillFolder}/doc`, { recursive: true })
await fs.writeFile(`${skillFolder}/FORMAT.md`, '# Format\n\nUse tabs.\n', 'utf8')
await fs.writeFile(`${skillFolder}/doc/DOC.md`, '# Doc\n\nDetails here.\n', 'utf8')
r = await call('read_skill_file', { scope: 'project', skill: 'code-review', file: 'FORMAT.md' })
assert.equal(r.ok, true)
assert.match(r.text, /Use tabs/)
r = await call('read_skill_file', {
  scope: 'project',
  skill: 'code-review',
  file: 'doc/DOC.md'
})
assert.equal(r.ok, true)
assert.match(r.text, /Details here/)

// read_skill_file: missing file and traversal are refused
r = await call('read_skill_file', { scope: 'project', skill: 'code-review', file: 'nope.md' })
assert.equal(r.ok, false, 'missing file refused')
r = await call('read_skill_file', {
  scope: 'project',
  skill: 'code-review',
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
