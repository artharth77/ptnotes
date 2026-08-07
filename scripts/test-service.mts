import Module from 'node:module'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const ROOT = '/tmp/ptnotes-test-root'

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return { app: { getPath: () => ROOT } }
  }
  return origLoad.call(this, request, parent, isMain)
}

const { PTNotesService } = await import('../src/main/service/PTNotesService')

await fs.rm(ROOT, { recursive: true, force: true })
const service = new PTNotesService(ROOT)

// Projects
let projects = await service.listProjects()
assert.deepEqual(projects, [], 'starts empty')

const proj = await service.createProject('Work')
assert.equal(proj.name, 'Work')
projects = await service.listProjects()
assert.equal(projects.length, 1)
assert.equal(projects[0].name, 'Work')
assert.equal(projects[0].noteCount, 1, 'welcome note created')

// Notes
await service.createNote('Work', 'Meeting Notes')
let notes = await service.listNotes('Work')
assert.equal(notes.length, 2, 'welcome + meeting notes')
assert.ok(
  notes.some((n) => n.name === 'welcome'),
  'welcome note is named welcome.md'
)
assert.ok(notes.some((n) => n.name === 'meeting-notes'))

await service.saveNote('Work', 'meeting-notes', '# Meeting Notes\n\nDecision: use Electron.')
const content = await service.readNote('Work', 'meeting-notes')
assert.match(content, /Decision: use Electron/)

const renamed = await service.renameNote('Work', 'meeting-notes', 'Meeting Decisions')
assert.equal(renamed.id, 'meeting-decisions')
notes = await service.listNotes('Work')
assert.ok(!notes.some((n) => n.name === 'meeting-notes'))
assert.ok(notes.some((n) => n.name === 'meeting-decisions'))

await service.deleteNote('Work', 'meeting-decisions')
notes = await service.listNotes('Work')
assert.equal(notes.length, 1)

// Non-Latin (Thai) note names keep their characters instead of "untitled"
const thaiNote = await service.createNote('Work', 'บันทึกการประชุม')
assert.equal(thaiNote.id, 'บันทึกการประชุม')
notes = await service.listNotes('Work')
assert.ok(
  notes.some((n) => n.name === 'บันทึกการประชุม'),
  'thai note name preserved'
)
const thaiRenamed = await service.renameNote('Work', 'บันทึกการประชุม', 'บันทึกใหม่')
assert.equal(thaiRenamed.id, 'บันทึกใหม่')
await service.deleteNote('Work', 'บันทึกใหม่')
notes = await service.listNotes('Work')
assert.equal(notes.length, 1)

// Todos
let todos = await service.listTodos('Work')
assert.equal(todos.length, 0)

todos = await service.addTodos('Work', ['Buy milk', 'Pay rent', 'Buy milk'])
assert.equal(todos.length, 3)
assert.equal(new Set(todos.map((t) => t.id)).size, 3, 'duplicate ids are unique via occurrence')

const firstMilk = todos.find((t) => t.text === 'Buy milk')!
await service.toggleTodo('Work', firstMilk.id)
todos = await service.listTodos('Work')
assert.equal(
  todos.filter((t) => t.text === 'Buy milk' && t.done).length,
  1,
  'only first milk toggled'
)
assert.equal(todos.filter((t) => t.text === 'Buy milk' && !t.done).length, 1)

await service.deleteTodo('Work', firstMilk.id)
todos = await service.listTodos('Work')
assert.equal(todos.length, 2)
assert.equal(todos.filter((t) => t.text === 'Buy milk').length, 1)

// Reorder todos
const rentId = todos.find((t) => t.text === 'Pay rent')!.id
const milkId = todos.find((t) => t.text === 'Buy milk')!.id
todos = await service.reorderTodos('Work', [milkId, rentId])
assert.deepEqual(
  todos.map((t) => t.text),
  ['Buy milk', 'Pay rent'],
  'reordered by provided ids'
)
const rawAfterReorder = await fs.readFile(join(ROOT, 'Work', 'TODO.md'), 'utf8')
assert.ok(
  rawAfterReorder.indexOf('- [ ] Buy milk') < rawAfterReorder.indexOf('- [ ] Pay rent'),
  'TODO.md line order updated'
)

// TODO.md stays valid markdown
const raw = await fs.readFile(join(ROOT, 'Work', 'TODO.md'), 'utf8')
assert.match(raw, /^# Todo/m)
assert.match(raw, /- \[ \] Pay rent/)
assert.match(raw, /- \[ \] Buy milk/)

// Delete completed tasks
todos = await service.addTodos('Work', ['Ship release', 'Write docs'])
const ship = todos.find((t) => t.text === 'Ship release')!
const payRent = todos.find((t) => t.text === 'Pay rent')!
await service.toggleTodo('Work', ship.id)
await service.toggleTodo('Work', payRent.id)
todos = await service.listTodos('Work')
assert.equal(todos.filter((t) => t.done).length, 2)
todos = await service.deleteCompletedTodos('Work')
assert.equal(todos.length, 2, 'completed tasks removed')
assert.ok(!todos.some((t) => t.done), 'no completed tasks remain')
assert.ok(todos.some((t) => t.text === 'Buy milk'))
assert.ok(todos.some((t) => t.text === 'Write docs'))

// Rename project
await service.renameProject('Work', 'Office')
assert.ok((await service.listProjects()).some((p) => p.name === 'Office'))

// Delete project
await service.deleteProject('Office')
projects = await service.listProjects()
assert.equal(projects.length, 0)

// Registry: missing path detection + recreate
await service.createProject('Archive')
projects = await service.listProjects()
assert.equal(projects.length, 1)
assert.equal(projects[0].name, 'Archive')
assert.equal(projects[0].pathExists, true)

await fs.rm(join(ROOT, 'Archive'), { recursive: true, force: true })
projects = await service.listProjects()
assert.equal(projects.length, 1, 'project kept in registry after folder deleted externally')
assert.equal(projects[0].pathExists, false, 'missing path flagged')
assert.equal(projects[0].noteCount, 0)

const recreated = await service.recreateProject('Archive')
assert.equal(recreated.pathExists, true)
assert.equal(recreated.noteCount, 1, 'welcome note recreated')
projects = await service.listProjects()
assert.equal(projects.length, 1)
assert.equal(projects[0].pathExists, true)

await service.deleteProject('Archive')
projects = await service.listProjects()
assert.equal(projects.length, 0)

// PDF copy: identical upload (same name + size + hash) reuses existing file
await service.createProject('Docs')
const srcDir = join(ROOT, '_pdfsrc')
await fs.mkdir(srcDir, { recursive: true })
const pdfSrc = join(srcDir, 'report.pdf')
const contentA = 'A'.repeat(200) + 'PDF-PART-1'
await fs.writeFile(pdfSrc, contentA)
const first = await service.copyFileToProject('Docs', pdfSrc, 'report.pdf')
assert.equal(first, join(ROOT, 'Docs', 'files', 'report.pdf'))
const reuse = await service.copyFileToProject('Docs', pdfSrc, 'report.pdf')
assert.equal(reuse, first, 'identical file reuses existing copy')

const pdfSrc2 = join(srcDir, 'report-v2.pdf')
await fs.writeFile(pdfSrc2, 'B'.repeat(200) + 'PDF-PART-2')
const second = await service.copyFileToProject('Docs', pdfSrc2, 'report-v2.pdf')
assert.equal(second, join(ROOT, 'Docs', 'files', 'report-v2.pdf'))

// same name + same size, but different hash -> must NOT reuse
const pdfSrc3 = join(srcDir, 'report.pdf')
await fs.writeFile(pdfSrc3, 'C'.repeat(200) + 'PDF-PART-1')
const clash = await service.copyFileToProject('Docs', pdfSrc3, 'report.pdf')
assert.equal(
  clash,
  join(ROOT, 'Docs', 'files', 'report-2.pdf'),
  'same name+size but different hash gets a new file'
)
await service.deleteProject('Docs')

console.log('ALL SERVICE TESTS PASSED')
