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
    return { app: { getPath: () => ROOT, getAppPath: () => ROOT } }
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

// Kanban
let board = await service.loadKanban('Work')
assert.equal(board.cards.length, 0)
assert.equal(board.columns.length, 4, 'default columns')

board = await service.createKanbanCard('Work', { title: 'Buy milk', priority: 'high' })
assert.equal(board.cards.length, 1)
assert.equal(board.cards[0].columnId, 'backlog', 'defaults to the first column')
assert.equal(board.cards[0].priority, 'high')

board = await service.createKanbanCard('Work', { title: 'Pay rent', column: 'Backlog' })
assert.equal(board.cards[1].columnId, 'backlog', 'column matched by title')
board = await service.createKanbanCard('Work', { title: 'Buy milk' })
assert.equal(board.cards.length, 3)
assert.equal(new Set(board.cards.map((c) => c.id)).size, 3, 'unique card ids')

const firstMilk = board.cards.find((c) => c.title === 'Buy milk')!
await service.updateKanbanCard('Work', firstMilk.id, { priority: 'low', storyPoints: 3 })
board = await service.loadKanban('Work')
const milkCards = board.cards.filter((c) => c.title === 'Buy milk')
assert.equal(milkCards.length, 2)
assert.equal(milkCards.filter((c) => c.priority === 'low').length, 1, 'only first milk updated')
assert.equal(milkCards.filter((c) => c.storyPoints === 3).length, 1)

await service.deleteKanbanCard('Work', firstMilk.id)
board = await service.loadKanban('Work')
assert.equal(board.cards.length, 2)
assert.equal(board.cards.filter((c) => c.title === 'Buy milk').length, 1)

// Move a card to another column
const rentId = board.cards.find((c) => c.title === 'Pay rent')!.id
board = await service.moveKanbanCard('Work', rentId, 'in-progress')
assert.equal(board.cards.find((c) => c.id === rentId)!.columnId, 'in-progress')

// board.json is persisted as valid JSON
const rawBoard = await fs.readFile(join(ROOT, 'Work', 'kanban', 'board.json'), 'utf8')
const parsedBoard = JSON.parse(rawBoard)
assert.equal(parsedBoard.version, 1)
assert.match(rawBoard, /Pay rent/)

// Kanban archive: archived cards move to a separate kanban/archive.json (no columns)
const archive = await service.loadKanbanArchive('Work')
assert.deepEqual(archive, { version: 1, cards: [] }, 'archive starts empty')
await assert.rejects(service.archiveKanbanCard('Work', 'nope'), /not found/)

const archived = await service.archiveKanbanCard('Work', rentId)
assert.equal(
  archived.board.cards.some((c) => c.id === rentId),
  false,
  'card left the board'
)
assert.equal(archived.archive.cards.length, 1)
assert.equal(archived.archive.cards[0].id, rentId)
assert.equal(archived.archive.cards[0].columnId, 'in-progress', 'archive keeps the column id')
assert.deepEqual(
  await service.loadKanbanArchive('Work'),
  archived.archive,
  'archive persisted to disk'
)
await assert.rejects(
  service.archiveKanbanCard('Work', rentId),
  /not found/,
  'an archived card is no longer on the board'
)

const rawArchive = await fs.readFile(join(ROOT, 'Work', 'kanban', 'archive.json'), 'utf8')
const parsedArchive = JSON.parse(rawArchive)
assert.equal(parsedArchive.version, 1)
assert.ok(!('columns' in parsedArchive), 'archive file defines no columns')
assert.match(rawArchive, /Pay rent/)

// restore: back to the original column when it still exists
const back = await service.restoreKanbanCard('Work', rentId)
assert.equal(back.archive.cards.length, 0)
assert.equal(back.board.cards.find((c) => c.id === rentId)?.columnId, 'in-progress')
await assert.rejects(service.restoreKanbanCard('Work', rentId), /not found/, 'cannot restore twice')

// restore falls back to the first column when the original column no longer exists
await service.archiveKanbanCard('Work', rentId)
board = await service.loadKanban('Work')
await service.saveKanban('Work', {
  ...board,
  columns: board.columns.filter((c) => c.id !== 'in-progress')
})
const fallback = await service.restoreKanbanCard('Work', rentId)
assert.equal(
  fallback.board.cards.find((c) => c.id === rentId)?.columnId,
  'backlog',
  'restore falls back to the first column'
)

// delete an archived card permanently
await service.archiveKanbanCard('Work', rentId)
await assert.rejects(service.deleteArchivedKanbanCard('Work', 'nope'), /not found/)
const afterArchiveDelete = await service.deleteArchivedKanbanCard('Work', rentId)
assert.equal(afterArchiveDelete.cards.length, 0)
board = await service.loadKanban('Work')
assert.equal(
  board.cards.some((c) => c.id === rentId),
  false,
  'board untouched by archive delete'
)

// Legacy TODO.md → kanban migration (simulate a pre-kanban project: no board.json)
await service.createProject('Migrate')
await fs.rm(join(ROOT, 'Migrate', 'kanban', 'board.json'), { force: true })
await fs.writeFile(
  join(ROOT, 'Migrate', 'TODO.md'),
  '# Todo\n\n- [ ] Legacy open\n- [x] Legacy done\n- not a task\n',
  'utf8'
)
board = await service.loadKanban('Migrate')
assert.equal(board.cards.length, 2, 'checklist lines migrated')
assert.equal(board.cards.filter((c) => c.columnId === 'to-do').length, 1, 'open → To Do')
assert.equal(board.cards.filter((c) => c.columnId === 'done').length, 1, 'done → Done')
assert.equal(
  await fs
    .access(join(ROOT, 'Migrate', 'TODO.md'))
    .then(() => true)
    .catch(() => false),
  false,
  'TODO.md removed after migration'
)
board = await service.loadKanban('Migrate')
assert.equal(board.cards.length, 2, 'no double migration')
await service.deleteProject('Migrate')

// Concurrent kanban writes: per-project locking must not lose updates
await service.createProject('Race')
await Promise.all(
  Array.from({ length: 20 }, (_, i) =>
    service.createKanbanCard('Race', { title: `Race ${i}`, column: 'Backlog' })
  )
)
board = await service.loadKanban('Race')
assert.equal(board.cards.length, 20, 'all concurrent creates persisted')
assert.equal(new Set(board.cards.map((c) => c.title)).size, 20, 'no lost/duplicated cards')

// Mixed concurrent mutations on distinct cards (create + update + move + archive)
const [movedId, updatedId, archivedId] = board.cards.map((c) => c.id)
await Promise.all([
  service.moveKanbanCard('Race', movedId, 'in-progress'),
  service.updateKanbanCard('Race', updatedId, { priority: 'high' }),
  service.archiveKanbanCard('Race', archivedId),
  service.createKanbanCard('Race', { title: 'Race extra' })
])
board = await service.loadKanban('Race')
assert.equal(board.cards.length, 20, '19 kept + 1 extra (1 archived)')
assert.equal(board.cards.find((c) => c.id === movedId)!.columnId, 'in-progress')
assert.equal(board.cards.find((c) => c.id === updatedId)!.priority, 'high')
assert.equal((await service.loadKanbanArchive('Race')).cards[0].id, archivedId)

// No stray tmp files left behind by the atomic writes
const kanbanFiles = await fs.readdir(join(ROOT, 'Race', 'kanban'))
assert.deepEqual(
  kanbanFiles.filter((f) => f.endsWith('.tmp')),
  [],
  'no stray tmp files'
)
await service.deleteProject('Race')

// Concurrent note writes: per-project locking must not lose updates or duplicate ids
await service.createProject('NotesRace')
await Promise.all(
  Array.from({ length: 10 }, (_, i) => service.createNote('NotesRace', `Note ${i}`))
)
const raceNotes = (await service.listNotes('NotesRace')).map((n) => n.id)
assert.equal(
  raceNotes.filter((n) => /^note-\d+$/.test(n)).length,
  10,
  'all concurrent note creates persisted'
)

// withNote serializes read-modify-write cycles (both appends survive)
const raceTarget = 'note-0'
await Promise.all([
  service.withNote('NotesRace', raceTarget, (raw) => `${raw}first\n`),
  service.withNote('NotesRace', raceTarget, (raw) => `${raw}second\n`)
])
const appended = await service.readNote('NotesRace', raceTarget)
assert.match(appended, /first\n/)
assert.match(appended, /second\n/)

// concurrent saveNote to one note: last write wins, file stays valid
await Promise.all(
  Array.from({ length: 8 }, (_, i) => service.saveNote('NotesRace', raceTarget, `body ${i}`))
)
assert.match(await service.readNote('NotesRace', raceTarget), /^body \d$/)

// concurrent upsertNote with the same id: exactly one file, no duplicates
await Promise.all(
  Array.from({ length: 5 }, (_, i) => service.upsertNote('NotesRace', 'dup', `dup ${i}`))
)
const afterUpsert = (await service.listNotes('NotesRace')).map((n) => n.id)
assert.equal(afterUpsert.filter((n) => n === 'dup').length, 1, 'upsert does not duplicate notes')

// Planner: concurrent withSchedule mutations all persist
await service.createProject('PlannerRace')
await service.createSchedule('PlannerRace', 'Plan')
await Promise.all(
  Array.from({ length: 10 }, (_, i) =>
    service.withSchedule('PlannerRace', 'plan', (schedule) => ({
      save: {
        ...schedule,
        tasks: [
          ...schedule.tasks,
          {
            id: `race-${i}`,
            title: `Race ${i}`,
            status: 'not-started' as const,
            owner: '',
            duration: 1,
            planStart: null,
            planEnd: null,
            actualStart: null,
            actualEnd: null,
            percentComplete: 0,
            note: '',
            children: []
          }
        ],
        updatedAt: Date.now()
      },
      value: i
    }))
  )
)
const racedSchedule = await service.readSchedule('PlannerRace', 'plan')
assert.equal(racedSchedule!.tasks.length, 10, 'all concurrent withSchedule writes persisted')

// no stray tmp files left behind in notes/ or planner/
const notesFiles = await fs.readdir(join(ROOT, 'NotesRace', 'notes'))
assert.deepEqual(
  notesFiles.filter((f) => f.endsWith('.tmp')),
  [],
  'no stray tmp files in notes/'
)
const plannerFiles = await fs.readdir(join(ROOT, 'PlannerRace', 'planner'))
assert.deepEqual(
  plannerFiles.filter((f) => f.endsWith('.tmp')),
  [],
  'no stray tmp files in planner/'
)
await service.deleteProject('NotesRace')
await service.deleteProject('PlannerRace')

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

// ---- Legacy chat/modules → .data migration ----
const exists = async (p: string): Promise<boolean> =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false)

await service.createProject('Legacy')

// legacy <proj>/chat/a.json
const legacyChatDir = join(ROOT, 'Legacy', 'chat')
await fs.mkdir(legacyChatDir, { recursive: true })
await fs.writeFile(
  join(legacyChatDir, 'a.json'),
  JSON.stringify({
    sessionId: 'a',
    createdAt: 1,
    updatedAt: 2,
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' }
    ]
  }),
  'utf8'
)

// legacy <proj>/modules/<id>.json + modules/temp/x.png
const legacyModDir = join(ROOT, 'Legacy', 'modules')
await fs.mkdir(join(legacyModDir, 'temp'), { recursive: true })
await fs.writeFile(
  join(legacyModDir, 'run-1.json'),
  JSON.stringify({
    runId: 'run-1',
    module: 'pptx',
    title: 'Legacy deck',
    prompt: 'old',
    status: 'done',
    steps: [],
    updatedAt: 3
  }),
  'utf8'
)
await fs.writeFile(join(legacyModDir, 'temp', 'x.png'), Buffer.from('fake-png'))

// merge case: .data/modules already exists with its own run before migration
const dataModDir = join(ROOT, 'Legacy', '.data', 'modules')
await fs.mkdir(dataModDir, { recursive: true })
await fs.writeFile(
  join(dataModDir, 'run-2.json'),
  JSON.stringify({
    runId: 'run-2',
    module: 'docx',
    title: 'Legacy doc',
    prompt: 'new',
    status: 'done',
    steps: [],
    updatedAt: 4
  }),
  'utf8'
)

await service.migrateLegacyFolders()

assert.equal(await exists(legacyChatDir), false, 'legacy chat dir moved')
assert.equal(await exists(legacyModDir), false, 'legacy modules dir moved')

// chat data readable through the service
const migratedSessions = await service.listChatSessions('Legacy')
assert.equal(migratedSessions.length, 1, 'migrated chat session listed')
assert.equal(migratedSessions[0].sessionId, 'a')
assert.equal((await service.readChat('Legacy', 'a')).messages.length, 2, 'migrated chat read')

// module runs merged (run-1 from legacy + run-2 from .data), temp file moved
const migratedRuns = await service.listStoredModuleRuns('Legacy')
assert.deepEqual(
  migratedRuns.map((r) => r.runId).sort(),
  ['run-1', 'run-2'],
  'legacy + existing .data runs merged without data loss'
)
await fs.access(join(dataModDir, 'temp', 'x.png'))
await assert.rejects(fs.access(join(legacyModDir, 'temp', 'x.png')))

// idempotent
await service.migrateLegacyFolders()
assert.equal(await exists(legacyChatDir), false, 'migration stays idempotent')

await service.deleteProject('Legacy')
projects = await service.listProjects()
assert.ok(!projects.some((p) => p.name === 'Legacy'), 'Legacy project deleted')

// ---- Skills ----
await service.createProject('Skills')

let skills = await service.listSkills('Skills')
assert.deepEqual(skills, { global: [], project: [], builtin: [] }, 'skills start empty')

const skillMeta = await service.saveSkill('Skills', 'project', 'Style Guide', {
  description: 'House style rules',
  content: '# Style\n\nUse sentence case.'
})
assert.equal(skillMeta.name, 'style-guide')
skills = await service.listSkills('Skills')
assert.equal(skills.project.length, 1)
assert.equal(skills.project[0].name, 'style-guide')
assert.equal(skills.project[0].description, 'House style rules')
assert.equal(skills.project[0].enabled, true, 'skills default to enabled')

const skillContent = await service.readSkill('Skills', 'project', 'style-guide')
assert.ok(skillContent, 'skill read')
assert.equal(skillContent.description, 'House style rules')
assert.equal(skillContent.content, '# Style\n\nUse sentence case.')
assert.equal(skillContent.enabled, true, 'readSkill reports enabled')

// readSkillFile: sibling file inside the skill folder (relative only, no traversal)
const skillDir = join(ROOT, 'Skills', '.data', 'skills', 'style-guide')
await fs.mkdir(join(skillDir, 'doc'), { recursive: true })
await fs.writeFile(join(skillDir, 'FORMAT.md'), '# Format\n\nUse tabs.', 'utf8')
await fs.writeFile(join(skillDir, 'doc', 'DOC.md'), '# Doc\n\nDetails.', 'utf8')
assert.equal(
  (await service.readSkillFile('Skills', 'project', 'style-guide', 'FORMAT.md'))?.content,
  '# Format\n\nUse tabs.'
)
assert.equal(
  (await service.readSkillFile('Skills', 'project', 'style-guide', 'doc/DOC.md'))?.content,
  '# Doc\n\nDetails.'
)
assert.equal(
  await service.readSkillFile('Skills', 'project', 'style-guide', 'missing.md'),
  null,
  'missing file is null'
)
assert.equal(
  await service.readSkillFile('Skills', 'project', 'style-guide', '../FORMAT.md'),
  null,
  'traversal refused'
)
assert.equal(
  await service.readSkillFile('Skills', 'project', 'style-guide', '/etc/passwd'),
  null,
  'absolute path refused'
)

// OpenAI skill-guide layout: a per-skill folder containing SKILL.md with name + description lines
const skillFolder = join(ROOT, 'Skills', '.data', 'skills', 'style-guide')
const manifestStat = await fs.stat(skillFolder)
assert.ok(manifestStat.isDirectory(), 'skill stored as a folder')
const rawSkill = await fs.readFile(join(skillFolder, 'SKILL.md'), 'utf8')
assert.match(rawSkill, /^name: style-guide$/m, 'front-matter has name line')
assert.match(rawSkill, /^description: House style rules$/m, 'front-matter has description line')
assert.match(rawSkill, /^enabled: true$/m, 'front-matter has enabled line')

// global skill
await service.saveSkill('Skills', 'global', 'Tone', {
  description: 'Concise tone',
  content: 'Be brief.'
})
skills = await service.listSkills('Skills')
assert.equal(skills.global.length, 1)
assert.equal(skills.global[0].name, 'tone')

// skills index block
const index = await service.renderSkillsIndex('Skills')
assert.match(index, /Global skills:/)
assert.match(index, /- tone — Concise tone/)
assert.match(index, /Project skills:/)
assert.match(index, /- style-guide — House style rules/)

// upsert updates in place (no duplicate)
await service.saveSkill('Skills', 'project', 'Style Guide', {
  description: 'Updated rules',
  content: '# Style\n\nv2'
})
skills = await service.listSkills('Skills')
assert.equal(skills.project.length, 1, 'upsert updates, no duplicate')
assert.equal(skills.project[0].description, 'Updated rules')

// disabling a skill excludes it from the index and flips the stored front-matter
const disabledMeta = await service.setSkillEnabled('Skills', 'project', 'style-guide', false)
assert.equal(disabledMeta.enabled, false)
const disabledIndex = await service.renderSkillsIndex('Skills')
assert.ok(!disabledIndex.includes('style-guide'), 'disabled skill excluded from the index')
assert.ok(disabledIndex.includes('tone'), 'enabled global skill still listed')
const disabledRaw = await fs.readFile(join(skillFolder, 'SKILL.md'), 'utf8')
assert.match(disabledRaw, /^enabled: false$/m, 'enabled line flips to false')
assert.equal((await service.readSkill('Skills', 'project', 'style-guide'))?.enabled, false)
await service.setSkillEnabled('Skills', 'project', 'style-guide', true)
const reEnabledIndex = await service.renderSkillsIndex('Skills')
assert.ok(reEnabledIndex.includes('style-guide'), 're-enabled skill back in the index')

// moving a skill between scopes relocates its whole folder
let moved = await service.moveSkill('Skills', 'project', 'style-guide', 'global')
assert.equal(moved.scope, 'global')
skills = await service.listSkills('Skills')
assert.equal(skills.global.length, 2, 'skill now listed under global')
assert.equal(skills.project.length, 0)
assert.equal(await service.readSkill('Skills', 'project', 'style-guide'), null)
assert.ok(
  await fs
    .stat(join(ROOT, '.skills', 'style-guide'))
    .then((s) => s.isDirectory())
    .catch(() => false),
  'folder relocated to global skills dir'
)
// moving back to project (same content preserved)
moved = await service.moveSkill('Skills', 'global', 'style-guide', 'project')
assert.equal(moved.scope, 'project')
assert.equal(moved.description, 'Updated rules')
assert.equal(
  await fs
    .stat(join(ROOT, 'Skills', '.data', 'skills', 'style-guide'))
    .then((s) => s.isDirectory())
    .catch(() => false),
  true,
  'folder back under the project'
)
// conflict guard
await service.saveSkill('Skills', 'global', 'Style Guide', {
  description: 'Global copy',
  content: 'g'
})
await assert.rejects(
  service.moveSkill('Skills', 'project', 'style-guide', 'global'),
  /already exists/,
  'moving onto an existing name throws'
)
await service.deleteSkill('Skills', 'global', 'style-guide')

// delete
assert.equal(await service.deleteSkill('Skills', 'project', 'style-guide'), true)
assert.equal(
  await service.deleteSkill('Skills', 'project', 'style-guide'),
  false,
  'deleting a missing skill returns false'
)
skills = await service.listSkills('Skills')
assert.equal(skills.project.length, 0)

// changeRootDir relocates the global .skills folder alongside the registry + projects
await service.createProject('SkillsMove')
await service.saveSkill('SkillsMove', 'project', 'Local Rules', {
  description: 'Local',
  content: 'x'
})
const NEW_ROOT = '/tmp/ptnotes-skills-root-2'
await fs.rm(NEW_ROOT, { recursive: true, force: true })
await service.changeRootDir(NEW_ROOT)
skills = await service.listSkills('SkillsMove')
assert.equal(skills.global.length, 1, 'global skills moved to the new root')
assert.equal(skills.global[0].name, 'tone')
assert.equal(skills.project.length, 1, 'project skills moved with the project folder')
assert.equal(skills.project[0].name, 'local-rules')

await service.deleteProject('SkillsMove')
await fs.rm(NEW_ROOT, { recursive: true, force: true })

console.log('ALL SERVICE TESTS PASSED')
