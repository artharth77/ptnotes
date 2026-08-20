import Module from 'node:module'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'

const ROOT = '/tmp/ptnotes-planner-test-root'

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

const {
  applyDateRule,
  computeDuration,
  computeEndDate,
  countTasks,
  defaultCalendar,
  deriveStatus,
  deriveTaskNo,
  emptyTask,
  findTaskByTitle,
  nextWorkingDayString,
  normalizeCalendar,
  rollupScheduleTasks,
  validateScheduleId
} = await import('../src/shared/planner')
const { PTNotesService } = await import('../src/main/service/PTNotesService')
const { tools } = await import('../src/main/ai/tools')
import type { ScheduleTask } from '../src/shared/types'
import type { ToolContext } from '../src/main/ai/tools'

// ---- outline numbering ----

assert.equal(deriveTaskNo(null, 0), '1')
assert.equal(deriveTaskNo(null, 2), '3')
assert.equal(deriveTaskNo('1', 0), '1.1')
assert.equal(deriveTaskNo('1', 1), '1.2')
assert.equal(deriveTaskNo('1.1', 0), '1.1.1')

// ---- working-day calendar (default Mon-Fri, no holidays) ----

const cal = defaultCalendar()
assert.deepEqual({ weekStart: cal.weekStart, weekEnd: cal.weekEnd }, { weekStart: 1, weekEnd: 5 })

assert.equal(computeEndDate('2024-01-01', 1, cal), '2024-01-01', 'duration 1 ends on start day')
assert.equal(computeEndDate('2024-01-01', 5, cal), '2024-01-05', '5 working days Mon-Fri')
assert.equal(computeEndDate('2024-01-05', 2, cal), '2024-01-08', 'skips weekend (Fri->Mon)')

assert.equal(
  nextWorkingDayString('2024-01-05', cal),
  '2024-01-08',
  'next working day skips weekend'
)

assert.equal(computeDuration('2024-01-01', '2024-01-05', cal), 5, 'Mon-Fri is 5 days')
assert.equal(computeDuration('2024-01-01', '2024-01-01', cal), 1, 'same day is 1 day')
assert.equal(computeDuration('2024-01-05', '2024-01-01', cal), 0, 'end before start is 0')
assert.equal(computeDuration('2024-01-05', '2024-01-08', cal), 2, 'Mon-Fri across a weekend')

// ---- holidays ----

const hol = normalizeCalendar({ weekStart: 1, weekEnd: 5, holidays: ['2024-01-02'] })
assert.equal(computeDuration('2024-01-01', '2024-01-03', hol), 2, 'holiday is not a working day')
assert.equal(computeEndDate('2024-01-01', 3, hol), '2024-01-04', 'end skips the holiday')
assert.equal(
  nextWorkingDayString('2024-01-01', hol),
  '2024-01-03',
  'next working day skips the holiday'
)
assert.deepEqual(
  normalizeCalendar({ holidays: ['bad-date'] }),
  defaultCalendar(),
  'garbage calendar -> default'
)

// ---- date rule (duration-fixed) ----

const prev = { ...emptyTask(), planStart: '2024-01-01', planEnd: '2024-01-05', duration: 5 }

let next = applyDateRule(prev, { ...prev, planStart: '2024-01-02' }, cal)
assert.equal(next.duration, 5, 'start edited keeps duration')
assert.equal(next.planEnd, '2024-01-08', 'start edited -> end recomputed from duration')

next = applyDateRule(prev, { ...prev, duration: 3 }, cal)
assert.equal(next.planEnd, '2024-01-03', 'duration edited -> end recomputed')

next = applyDateRule(prev, { ...prev, planEnd: '2024-01-10' }, cal)
assert.equal(next.duration, 8, 'end edited -> duration recomputed')

next = applyDateRule(
  { ...emptyTask(), duration: null, planStart: '2024-01-01', planEnd: '2024-01-05' },
  { ...emptyTask(), duration: null, planStart: '2024-01-02', planEnd: '2024-01-05' },
  cal
)
assert.equal(next.duration, 4, 'start edited with no duration -> duration recomputed, end fixed')

next = applyDateRule(
  { ...emptyTask(), duration: 3 },
  { ...emptyTask(), duration: 3, planStart: '2024-01-03' },
  cal
)
assert.equal(
  next.planEnd,
  '2024-01-05',
  'start edited with no end -> end computed from start + duration'
)

next = applyDateRule(
  { ...emptyTask(), planStart: '2024-01-01', duration: 1 },
  { ...emptyTask(), planStart: '2024-01-03', duration: 1 },
  cal
)
assert.equal(
  next.planEnd,
  '2024-01-03',
  'start edited with duration 1 and no end -> end follows start'
)

// ---- status rules ----

assert.equal(deriveStatus(0, 'not-started'), 'not-started')
assert.equal(deriveStatus(50, 'not-started'), 'in-progress')
assert.equal(deriveStatus(100, 'in-progress'), 'completed')
assert.equal(deriveStatus(0, 'on-hold'), 'on-hold', 'on-hold is manual only')
assert.equal(deriveStatus(100, 'on-hold'), 'on-hold', 'on-hold survives 100%')

// ---- parent rollup ----

function mk(
  id: string,
  percent: number,
  planStart: string | null,
  planEnd: string | null
): ScheduleTask {
  return {
    ...emptyTask(),
    id,
    percentComplete: percent,
    planStart,
    planEnd,
    duration: planStart && planEnd ? computeDuration(planStart, planEnd, cal) : null
  }
}

const rolled = rollupScheduleTasks(
  [
    {
      ...emptyTask(),
      id: 'parent',
      children: [mk('a', 100, '2024-01-01', '2024-01-05'), mk('b', 50, '2024-01-08', '2024-01-09')]
    }
  ],
  cal
)
const parent = rolled[0]
assert.equal(parent.planStart, '2024-01-01', 'rollup planStart = min child')
assert.equal(parent.planEnd, '2024-01-09', 'rollup planEnd = max child')
assert.equal(parent.duration, 7, 'rollup duration = working days between min/max')
assert.equal(parent.percentComplete, 86, 'duration-weighted average (600/7 = 85.7 -> 86)')
assert.equal(parent.status, 'in-progress', 'rollup status derived from percent')

const flat = rollupScheduleTasks(
  [{ ...emptyTask(), id: 'p', children: [mk('x', 100, null, null), mk('y', 0, null, null)] }],
  cal
)
assert.equal(flat[0].percentComplete, 50, 'plain average when children have no duration')
assert.equal(flat[0].status, 'in-progress', '50% rollup status')
assert.equal(flat[0].planStart, null, 'no plan dates when children have none')

const onHoldRollup = rollupScheduleTasks(
  [
    {
      ...emptyTask(),
      id: 'p',
      status: 'on-hold',
      children: [mk('x', 100, '2024-01-01', '2024-01-01')]
    }
  ],
  cal
)
assert.equal(onHoldRollup[0].status, 'on-hold', 'parent on-hold preserved through rollup')

// ---- search / count / validate ----

const titled = (id: string, title: string, children: ScheduleTask[] = []): ScheduleTask => ({
  ...emptyTask(),
  id,
  title,
  children
})
assert.equal(
  findTaskByTitle(
    [titled('a', 'Alpha'), titled('b', 'Beta', [titled('deep', 'Deep Dive')])],
    'deep dive'
  )?.id,
  'deep'
)
assert.equal(findTaskByTitle([titled('a', 'Alpha')], 'missing'), null)
assert.equal(
  countTasks({
    ...emptyTask(),
    id: 'r',
    children: [
      mk('a', 0, null, null),
      { ...emptyTask(), id: 'b', children: [mk('c', 0, null, null)] }
    ]
  }),
  4
)
assert.equal(validateScheduleId('release-plan'), 'release-plan')
for (const bad of ['', '.', '..', 'a/b', 'a\\b']) {
  assert.throws(() => validateScheduleId(bad), `rejects ${JSON.stringify(bad)}`)
}
const e = emptyTask()
assert.ok(e.id.length > 0, 'emptyTask has an id')
assert.equal(e.duration, 1, 'emptyTask defaults duration to 1')

// ---- service CRUD ----

const service = new PTNotesService(ROOT)
await service.createProject('Build')

let schedules = await service.listSchedules('Build')
assert.deepEqual(schedules, [], 'no schedules initially')

const meta1 = await service.createSchedule('Build', 'Release Plan')
assert.equal(meta1.id, 'release-plan')
let dupErr = false
try {
  await service.createSchedule('Build', 'Release Plan')
} catch (err) {
  dupErr = (err as Error).message.includes('already exists')
}
assert.ok(dupErr, 'creating a duplicate schedule name throws')
const meta2 = await service.createSchedule('Build', 'Roadmap')
assert.equal(meta2.id, 'roadmap')

schedules = await service.listSchedules('Build')
assert.equal(schedules.length, 2)
assert.equal(schedules[0].taskCount, 0)

const sched = await service.readSchedule('Build', meta1.id)
assert.ok(sched)
assert.equal(sched.name, 'Release Plan')
assert.deepEqual(sched.tasks, [])

sched.tasks = [mk('a', 100, '2024-01-01', '2024-01-05')]
await service.saveSchedule('Build', { ...sched, updatedAt: Date.now() })
assert.equal((await service.readSchedule('Build', meta1.id))!.tasks.length, 1)

const renamed = await service.renameSchedule('Build', meta1.id, 'Ship It')
assert.equal(renamed.name, 'Ship It')
assert.equal(renamed.id, 'ship-it')
assert.ok(renamed.id !== meta1.id, 'rename also re-slugifies the schedule id')
assert.equal(await service.readSchedule('Build', meta1.id), null, 'old id/file removed on rename')
assert.equal((await service.readSchedule('Build', 'ship-it'))!.name, 'Ship It')
// renaming to the same slug keeps the same id (no duplicate file bump)
const same = await service.renameSchedule('Build', renamed.id, 'Ship It')
assert.equal(same.id, 'ship-it')
// renaming onto an existing slug throws (no auto -2 suffix)
dupErr = false
try {
  await service.renameSchedule('Build', renamed.id, 'Roadmap')
} catch (err) {
  dupErr = (err as Error).message.includes('already exists')
}
assert.ok(dupErr, 'renaming onto an existing schedule name throws')

assert.equal(await service.readSchedule('Build', 'nope'), null, 'missing schedule -> null')
await service.deleteSchedule('Build', meta2.id)
assert.equal((await service.listSchedules('Build')).length, 1)

// ---- calendar service ----

let c = await service.readCalendar('Build')
assert.deepEqual({ weekStart: c.weekStart, weekEnd: c.weekEnd }, { weekStart: 1, weekEnd: 5 })
await service.saveCalendar('Build', { weekStart: 0, weekEnd: 6, holidays: ['2024-12-25'] })
c = await service.readCalendar('Build')
assert.equal(c.weekStart, 0)
assert.equal(c.weekEnd, 6)
assert.deepEqual(c.holidays, ['2024-12-25'])

// ---- AI tools ----

const ctx: ToolContext = {
  service,
  activeProject: 'Build',
  confirm: async () => true
}

const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
  const tool = tools.find((t) => t.definition.function.name === name)
  assert.ok(tool, `tool ${name} exists`)
  const res = await tool.execute(args, ctx)
  return JSON.parse(res)
}

// list_schedules / create_schedule
let r = await call('list_schedules', {})
assert.equal(r.ok, true)
assert.equal(r.schedules.length, 1)

r = await call('create_schedule', { name: 'Sprint 12' })
assert.equal(r.ok, true)
assert.equal(r.name, 'Sprint 12')

r = await call('create_schedule', {})
assert.equal(r.ok, false)

// add_task root + parent nesting
r = await call('add_task', {
  schedule: 'Sprint 12',
  title: 'Design',
  planStart: '2024-01-01',
  planEnd: '2024-01-05'
})
assert.equal(r.ok, true)
assert.equal(r.taskCount, 1)

r = await call('add_task', {
  schedule: 'Sprint 12',
  parent: 'Design',
  title: 'Wireframes',
  planStart: '2024-01-01',
  duration: 2
})
assert.equal(r.ok, true)
const wireframes = (await service.readSchedule('Build', 'sprint-12'))!.tasks[0].children[0]
assert.equal(wireframes.planEnd, '2024-01-02', 'duration 2 from Jan 1 ends Jan 2')
assert.equal(wireframes.duration, 2)

r = await call('add_task', {
  schedule: 'Sprint 12',
  parent: 'Design',
  title: 'Estimate',
  planStart: '2024-01-02'
})
assert.equal(r.ok, true)
const estimate = (await service.readSchedule('Build', 'sprint-12'))!.tasks[0].children[1]
assert.equal(estimate.duration, 1, 'planStart-only task defaults to 1 working day')
assert.equal(estimate.planEnd, null, 'no planEnd computed unless duration given explicitly')

// add_task addAfter positioning
r = await call('add_task', { schedule: 'Sprint 12', title: 'Research', addAfter: 'Design' })
assert.equal(r.ok, true)
let schedAfter = await service.readSchedule('Build', 'sprint-12')
assert.equal(schedAfter!.tasks[0].title, 'Design')
assert.equal(schedAfter!.tasks[1].title, 'Research', 'addAfter inserts top-level task after target')

r = await call('add_task', {
  schedule: 'Sprint 12',
  parent: 'Design',
  title: 'Spec',
  addAfter: 'Wireframes'
})
assert.equal(r.ok, true)
schedAfter = await service.readSchedule('Build', 'sprint-12')
assert.deepEqual(
  schedAfter!.tasks[0].children.map((c) => c.title),
  ['Wireframes', 'Spec', 'Estimate'],
  'addAfter positions child after sibling within parent'
)

r = await call('add_task', { schedule: 'Sprint 12', title: 'Misc', addAfter: 'no-such-task' })
assert.equal(r.ok, true)
schedAfter = await service.readSchedule('Build', 'sprint-12')
assert.equal(
  schedAfter!.tasks[schedAfter!.tasks.length - 1].title,
  'Misc',
  'unknown addAfter falls back to append'
)

// read_schedule returns rolled-up parents
r = await call('read_schedule', { schedule: 'Sprint 12' })
assert.equal(r.ok, true)
assert.equal(r.name, 'Sprint 12')
const design = r.tasks.find((t: { title: string }) => t.title === 'Design')
assert.ok(design, 'task found by title')
assert.equal(design.children.length, 3, 'Wireframes + Spec (addAfter) + Estimate')
assert.equal(design.planStart, '2024-01-01')
assert.equal(design.planEnd, '2024-01-02', 'parent planEnd rolls up to max child end')
assert.equal(design.duration, 2)

// taskNo outline numbering matches the editor (1, 1.1, 1.2, 2, ...)
assert.equal(design.taskNo, '1')
assert.deepEqual(
  design.children.map((c) => c.taskNo),
  ['1.1', '1.2', '1.3'],
  'children numbered 1.1, 1.2, 1.3'
)
assert.equal(r.tasks[1].taskNo, '2', 'second top-level task is 2')
assert.equal(r.tasks[2].taskNo, '3', 'third top-level task is 3')

r = await call('read_schedule', { schedule: 'missing' })
assert.equal(r.ok, false)

// update_task: percent drives status; on-hold is preserved
r = await call('update_task', { schedule: 'Sprint 12', task: 'Wireframes', percentComplete: 100 })
assert.equal(r.ok, true)
let sched2 = await service.readSchedule('Build', 'sprint-12')
assert.equal(sched2!.tasks[0].children[0].status, 'completed')

r = await call('update_task', { schedule: 'Sprint 12', task: 'Wireframes', status: 'on-hold' })
sched2 = await service.readSchedule('Build', 'sprint-12')
assert.equal(sched2!.tasks[0].children[0].status, 'on-hold', 'on-hold survives percent-rollup')

r = await call('update_task', { schedule: 'Sprint 12', task: 'missing-task', title: 'x' })
assert.equal(r.ok, false)

// update_task date rule
r = await call('update_task', { schedule: 'Sprint 12', task: 'Wireframes', planEnd: '2024-01-04' })
sched2 = await service.readSchedule('Build', 'sprint-12')
assert.equal(sched2!.tasks[0].children[0].duration, 4, 'end edited -> duration recomputed')

// update_task re-parenting: move a child to top level (empty parent)
r = await call('update_task', { schedule: 'Sprint 12', task: 'Wireframes', parent: '' })
assert.equal(r.ok, true)
assert.equal(r.parent, null, 'top-level move reports parent null')
sched2 = await service.readSchedule('Build', 'sprint-12')
assert.deepEqual(
  sched2!.tasks.map((t) => t.title),
  ['Design', 'Research', 'Misc', 'Wireframes'],
  'task moved to top level (appended)'
)
assert.deepEqual(
  sched2!.tasks[0].children.map((c) => c.title),
  ['Spec', 'Estimate'],
  'task removed from its old parent'
)

// update_task re-parenting: move to a new parent by title + addAfter positioning
r = await call('update_task', {
  schedule: 'Sprint 12',
  task: 'Misc',
  parent: 'Design',
  addAfter: 'Spec'
})
assert.equal(r.ok, true)
const designId = (await service.readSchedule('Build', 'sprint-12'))!.tasks[0].id
assert.equal(r.parent, designId, 'move under Design reports Design id')
sched2 = await service.readSchedule('Build', 'sprint-12')
assert.deepEqual(
  sched2!.tasks[0].children.map((c) => c.title),
  ['Spec', 'Misc', 'Estimate'],
  'addAfter positions the task within the new parent'
)
assert.deepEqual(
  sched2!.tasks.map((t) => t.title),
  ['Design', 'Research', 'Wireframes'],
  'task removed from top level'
)

// update_task re-parenting: cycle guard rejects self/descendant parents
r = await call('update_task', { schedule: 'Sprint 12', task: 'Design', parent: 'Misc' })
assert.equal(r.ok, false, 'cannot move a parent under its own descendant')
r = await call('update_task', { schedule: 'Sprint 12', task: 'Design', parent: 'Design' })
assert.equal(r.ok, false, 'cannot move a task under itself')

// update_task re-parenting: moving a parent carries its subtree
r = await call('update_task', { schedule: 'Sprint 12', task: 'Design', parent: 'Wireframes' })
assert.equal(r.ok, true)
assert.equal(r.parent, (await service.readSchedule('Build', 'sprint-12'))!.tasks[1].id)
sched2 = await service.readSchedule('Build', 'sprint-12')
assert.deepEqual(
  sched2!.tasks.map((t) => t.title),
  ['Research', 'Wireframes'],
  'top level after moving Design under Wireframes'
)
assert.deepEqual(
  sched2!.tasks[1].children.map((c) => c.title),
  ['Design'],
  'Design nested under Wireframes'
)
assert.deepEqual(
  sched2!.tasks[1].children[0].children.map((c) => c.title),
  ['Spec', 'Misc', 'Estimate'],
  'Design subtree travels with it'
)

// update_task re-parenting: unknown parent falls back to top-level append
r = await call('update_task', { schedule: 'Sprint 12', task: 'Spec', parent: 'no-such-task' })
assert.equal(r.ok, true)
assert.equal(r.parent, null)
sched2 = await service.readSchedule('Build', 'sprint-12')
assert.equal(
  sched2!.tasks[sched2!.tasks.length - 1].title,
  'Spec',
  'unknown parent moves task to top level'
)

// state: top = Research(1), Wireframes(2), Spec(3); Wireframes > Design(2.1) > Misc(2.1.1), Estimate(2.1.2)

// add_task addAfter with a nested task number infers the parent (sibling placement)
r = await call('add_task', { schedule: 'Sprint 12', title: 'Checklist', addAfter: '2.1.1' })
assert.equal(r.ok, true)
sched2 = await service.readSchedule('Build', 'sprint-12')
assert.deepEqual(
  sched2!.tasks[1].children[0].children.map((c) => c.title),
  ['Misc', 'Checklist', 'Estimate'],
  'nested addAfter inserts as sibling under the same parent'
)
assert.equal(sched2!.tasks.length, 3, 'nested addAfter does not create a top-level task')
assert.equal(r.parent, sched2!.tasks[1].children[0].id, 'inferred parent is reported')

// update_task move with only a nested addAfter infers the parent (sibling placement)
r = await call('update_task', { schedule: 'Sprint 12', task: 'Spec', addAfter: '2.1.3' })
assert.equal(r.ok, true)
sched2 = await service.readSchedule('Build', 'sprint-12')
assert.deepEqual(
  sched2!.tasks.map((t) => t.title),
  ['Research', 'Wireframes'],
  'task moved out of the top level'
)
assert.deepEqual(
  sched2!.tasks[1].children[0].children.map((c) => c.title),
  ['Misc', 'Checklist', 'Estimate', 'Spec'],
  'task placed as sibling after the nested addAfter target'
)

// update_task move with a nested addAfter under the task itself is rejected (cycle)
r = await call('update_task', { schedule: 'Sprint 12', task: 'Design', addAfter: '2.1.3' })
assert.equal(r.ok, false, 'cannot move a task next to its own descendant')

// update_task explicit empty parent still wins over a nested addAfter (top level)
r = await call('update_task', {
  schedule: 'Sprint 12',
  task: 'Checklist',
  parent: '',
  addAfter: '2.1.3'
})
assert.equal(r.ok, true)
assert.equal(r.parent, null)
sched2 = await service.readSchedule('Build', 'sprint-12')
assert.deepEqual(
  sched2!.tasks.map((t) => t.title),
  ['Research', 'Wireframes', 'Checklist'],
  'explicit empty parent moves to top level despite nested addAfter'
)

// update_schedule rename
r = await call('update_schedule', { schedule: 'Sprint 12', name: 'Sprint 13' })
assert.equal(r.ok, true)
assert.equal(r.name, 'Sprint 13')
r = await call('update_schedule', { schedule: 'nope', name: 'x' })
assert.equal(r.ok, false)

// set_calendar + re-roll
r = await call('set_calendar', {
  weekStart: 1,
  weekEnd: 6,
  addHolidays: ['2024-01-01'],
  removeHolidays: ['2024-12-25']
})
assert.equal(r.ok, true)
assert.equal(r.weekStart, 1)
assert.equal(r.weekEnd, 6)
assert.deepEqual(r.holidays, ['2024-01-01'])
assert.equal(r.reRolledSchedules, 2)

// parent rollup recomputed after re-roll (Jan 1 holiday shrinks durations)
sched2 = await service.readSchedule('Build', 'ship-it')
assert.ok(sched2 && sched2.tasks.length === 1)
assert.equal(sched2.tasks[0].percentComplete, 100)

console.log('planner tests passed')
