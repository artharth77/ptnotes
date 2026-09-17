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
  applyDependencies,
  computeDuration,
  computeEndDate,
  collectOwners,
  countTasks,
  defaultCalendar,
  deriveStatus,
  deriveTaskNo,
  detectCycle,
  eligibleLinkTargets,
  emptyTask,
  estimatePercentComplete,
  findTaskByTitle,
  isLeafTask,
  linkConstraints,
  nextWorkingDayString,
  normalizeCalendar,
  normalizeColumnOrder,
  normalizeOwner,
  normalizeTitleWidth,
  ownerStats,
  parseOwners,
  planIndicator,
  removeTaskLinks,
  rollupScheduleTasks,
  stripInvalidLinks,
  validateScheduleId,
  validateLinks
} = await import('../src/shared/planner')
const { PTNotesService } = await import('../src/main/service/PTNotesService')
const { tools } = await import('../src/main/ai/tools')
import type { ScheduleTask, TaskLink } from '../src/shared/types'
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

// ---- task dependencies ----

const link = (id: string, type: 'FS' | 'SS' | 'FF' | 'SF', lag = 0): TaskLink => ({
  id,
  type,
  lag
})

const leaf = (
  id: string,
  title: string,
  planStart: string | null,
  duration: number | null,
  dependsOn?: TaskLink[]
): ScheduleTask => ({
  id,
  title,
  status: 'not-started',
  owner: '',
  duration,
  planStart,
  planEnd: planStart && duration ? computeEndDate(planStart, duration, cal) : null,
  actualStart: null,
  actualEnd: null,
  percentComplete: 0,
  note: '',
  dependsOn,
  children: []
})

// linkConstraints matrix
assert.deepEqual(linkConstraints({}), { startLocked: false, endLocked: false })
assert.deepEqual(linkConstraints({ dependsOn: [link('a', 'FS')] }), {
  startLocked: true,
  endLocked: false
})
assert.deepEqual(linkConstraints({ dependsOn: [link('a', 'SS', 2)] }), {
  startLocked: true,
  endLocked: false
})
assert.deepEqual(linkConstraints({ dependsOn: [link('a', 'FF')] }), {
  startLocked: false,
  endLocked: true
})
assert.deepEqual(linkConstraints({ dependsOn: [link('a', 'SF')] }), {
  startLocked: false,
  endLocked: true
})
assert.deepEqual(
  linkConstraints({ dependsOn: [link('a', 'FS'), link('b', 'FF')] }),
  {
    startLocked: true,
    endLocked: true
  },
  'both edges pinned'
)

assert.equal(isLeafTask(leaf('a', 'A', null, null)), true, 'empty task is a leaf')
assert.equal(
  isLeafTask({ ...leaf('a', 'A', null, null), children: [leaf('b', 'B', null, null)] }),
  false
)

// FS lag semantics: lag 0 = next working day after pred end; -1 = same day
const fsBase = [leaf('a', 'A', '2024-01-01', 3), leaf('b', 'B', '2024-01-10', 2, [link('a', 'FS')])]
let dep = applyDependencies(fsBase, cal)
assert.equal(dep.tasks[1].planStart, '2024-01-04', 'FS lag 0 -> next working day after pred end')
assert.equal(dep.tasks[1].planEnd, '2024-01-05', 'pinned start recomputes planEnd from duration')
assert.equal(dep.violations.length, 0)
dep = applyDependencies(
  [leaf('a', 'A', '2024-01-01', 3), leaf('b', 'B', '2024-01-10', 2, [link('a', 'FS', 1)])],
  cal
)
assert.equal(dep.tasks[1].planStart, '2024-01-05', 'FS lag 1 skips one more working day')
dep = applyDependencies(
  [leaf('a', 'A', '2024-01-01', 3), leaf('b', 'B', '2024-01-10', 2, [link('a', 'FS', -1)])],
  cal
)
assert.equal(dep.tasks[1].planStart, '2024-01-03', 'FS lag -1 lands on the pred end day')

// FS across a weekend + holiday skipping
dep = applyDependencies(
  [leaf('a', 'A', '2024-01-05', 1), leaf('b', 'B', '2024-01-01', 1, [link('a', 'FS')])],
  cal
)
assert.equal(dep.tasks[1].planStart, '2024-01-08', 'FS after a Friday starts Monday')
const jan2Holiday = normalizeCalendar({ weekStart: 1, weekEnd: 5, holidays: ['2024-01-02'] })
dep = applyDependencies(
  [leaf('a', 'A', '2024-01-01', 1), leaf('b', 'B', '2024-01-01', 1, [link('a', 'FS')])],
  jan2Holiday
)
assert.equal(dep.tasks[1].planStart, '2024-01-03', 'FS skips holidays')

// SS lag 0 = same day as pred start
dep = applyDependencies(
  [leaf('a', 'A', '2024-01-02', 5), leaf('b', 'B', '2024-01-10', 2, [link('a', 'SS')])],
  cal
)
assert.equal(dep.tasks[1].planStart, '2024-01-02', 'SS lag 0 starts together with pred')
dep = applyDependencies(
  [leaf('a', 'A', '2024-01-02', 5), leaf('b', 'B', '2024-01-10', 2, [link('a', 'SS', 2)])],
  cal
)
assert.equal(dep.tasks[1].planStart, '2024-01-04', 'SS lag 2 shifts two working days')

// FF lag 0 = same day as pred end
dep = applyDependencies(
  [leaf('a', 'A', '2024-01-01', 5), leaf('b', 'B', '2024-01-10', 2, [link('a', 'FF')])],
  cal
)
assert.equal(dep.tasks[1].planEnd, '2024-01-05', 'FF lag 0 ends together with pred')

// SF lag 0 = working day before pred start
dep = applyDependencies(
  [leaf('a', 'A', '2024-01-08', 3), leaf('b', 'B', '2024-01-01', 2, [link('a', 'SF')])],
  cal
)
assert.equal(dep.tasks[1].planEnd, '2024-01-05', 'SF lag 0 ends the working day before pred starts')

// both edges locked -> duration derived
dep = applyDependencies(
  [
    leaf('a', 'A', '2024-01-01', 3),
    leaf('b', 'B', '2024-01-15', 4),
    leaf('c', 'C', '2024-01-20', 1, [link('a', 'FS'), link('b', 'FF')])
  ],
  cal
)
assert.equal(dep.tasks[2].planStart, '2024-01-04', 'both locked: start from FS')
assert.equal(dep.tasks[2].planEnd, '2024-01-18', 'both locked: end from FF (Mon after Fri +0)')
assert.equal(dep.tasks[2].duration, 11, 'both locked: duration derived from start/end')

// multiple start candidates -> latest wins
dep = applyDependencies(
  [
    leaf('a', 'A', '2024-01-01', 3),
    leaf('b', 'B', '2024-01-09', 3),
    leaf('c', 'C', '2024-01-20', 1, [link('a', 'FS'), link('b', 'FS')])
  ],
  cal
)
assert.equal(dep.tasks[2].planStart, '2024-01-12', 'start locked to the latest predecessor')

// inverted manual range repaired when a link pins the start
dep = applyDependencies(
  [leaf('a', 'A', '2024-01-08', 1), leaf('b', 'B', '2024-01-01', 3, [link('a', 'FS')])],
  cal
)
assert.equal(dep.tasks[1].planStart, '2024-01-09', 'start pinned by FS')
assert.equal(dep.tasks[1].planEnd, '2024-01-11', 'end recomputed from the pinned start + duration')
assert.equal(dep.violations.length, 0, 'inverted manual range is repaired, not flagged')

// pinned start without a duration: end kept, duration recomputed
const bNoDur = {
  ...leaf('b', 'B', '2024-01-05', null),
  planEnd: '2024-01-06',
  dependsOn: [link('a', 'FS')]
}
dep = applyDependencies([leaf('a', 'A', '2024-01-01', 1), bNoDur], cal)
assert.equal(dep.tasks[1].planStart, '2024-01-02', 'start pinned ahead of the task')
assert.equal(dep.tasks[1].planEnd, '2024-01-06', 'end kept when duration is unset')
assert.equal(dep.tasks[1].duration, 4, 'duration recomputed from pinned start and kept end')

// missing predecessor date -> violation, task untouched
const missingDate = [leaf('a', 'A', null, null), leaf('b', 'B', '2024-01-01', 1, [link('a', 'FS')])]
dep = applyDependencies(missingDate, cal)
assert.equal(dep.tasks[1].planStart, '2024-01-01', 'unusable link leaves the task unchanged')
assert.equal(dep.violations.length, 1, 'missing pred date is a violation')

// dangling link: validateLinks flags, stripInvalidLinks removes
const dangling = [
  leaf('a', 'A', '2024-01-01', 1, [link('ghost', 'FS')]),
  leaf('b', 'B', '2024-01-02', 1)
]
assert.equal(validateLinks(dangling).length, 1, 'dangling link reported')
const stripped = stripInvalidLinks(dangling)
assert.equal(stripped.removed, 1, 'dangling link removed')
assert.equal(stripped.tasks[0].dependsOn, undefined, 'dependsOn dropped when empty')

// non-leaf participants
const nonLeaf = [
  { ...leaf('p', 'P', null, null), children: [leaf('p1', 'P1', '2024-01-01', 1)] },
  leaf('c', 'C', '2024-01-01', 1, [link('p', 'FS')])
]
assert.equal(validateLinks(nonLeaf).length, 1, 'non-leaf predecessor reported')
assert.equal(stripInvalidLinks(nonLeaf).removed, 1, 'non-leaf link stripped')

// ancestor link forbidden
const ancestorTree = [
  {
    ...leaf('p', 'P', null, null),
    children: [leaf('p1', 'P1', null, null, [link('p', 'FS')])]
  }
]
assert.equal(validateLinks(ancestorTree).length, 1, 'ancestor link reported')

// cycle detection
const cyc = [
  leaf('a', 'A', null, null, [link('b', 'FS')]),
  leaf('b', 'B', null, null, [link('a', 'FS')])
]
assert.ok(detectCycle(cyc), 'cycle detected')
const cycResult = applyDependencies(cyc, cal)
assert.equal(cycResult.violations.length, 2, 'cycle reported per task')
assert.equal(cycResult.tasks[0].id, 'a', 'cycle leaves tasks unchanged')

// chained links resolve in dependency order
const chain = [
  leaf('a', 'A', '2024-01-01', 2),
  leaf('b', 'B', null, 2, [link('a', 'FS')]),
  leaf('c', 'C', null, 2, [link('b', 'FS')])
]
dep = applyDependencies(chain, cal)
assert.equal(dep.tasks[1].planStart, '2024-01-03', 'first successor after pred')
assert.equal(dep.tasks[2].planStart, '2024-01-05', 'second successor follows the computed pred')

// end-locked inverted date rule: end fixed, start/duration follow
const endLockedPrev = {
  ...leaf('x', 'X', '2024-01-01', 5),
  dependsOn: [link('p', 'FF')]
}
let lockedNext = applyDateRule(
  endLockedPrev,
  { ...endLockedPrev, planStart: '2024-01-03' },
  cal,
  linkConstraints(endLockedPrev)
)
assert.equal(lockedNext.duration, 3, 'end locked: start edit recomputes duration')
lockedNext = applyDateRule(
  endLockedPrev,
  { ...endLockedPrev, duration: 2 },
  cal,
  linkConstraints(endLockedPrev)
)
assert.equal(lockedNext.planStart, '2024-01-04', 'end locked: duration edit pulls start back')

// both locked: nothing recomputed
const bothLocked = {
  ...leaf('x', 'X', '2024-01-01', 5),
  dependsOn: [link('p', 'FS'), link('q', 'FF')]
}
lockedNext = applyDateRule(
  bothLocked,
  { ...bothLocked, planStart: '2024-01-03', duration: 9 },
  cal,
  linkConstraints(bothLocked)
)
assert.equal(lockedNext.planEnd, '2024-01-05', 'both locked: edits do not move derived fields')

// removeTaskLinks strips every link pointing at the removed task
const withLinks = [
  leaf('a', 'A', null, null, [link('gone', 'FS')]),
  leaf('b', 'B', null, null, [link('a', 'SS')]),
  leaf('gone', 'G', null, null)
]
const afterRemove = removeTaskLinks(withLinks, 'gone')
assert.equal(afterRemove[0].dependsOn, undefined, 'links to the removed task dropped')
assert.equal(afterRemove[1].dependsOn?.length, 1, 'unrelated links kept')

// eligibleLinkTargets excludes self, ancestors and descendants
const eligibleTree = [
  {
    ...leaf('p', 'P', null, null),
    children: [leaf('p1', 'P1', '2024-01-01', 1), leaf('p2', 'P2', '2024-01-02', 1)]
  },
  leaf('q', 'Q', '2024-01-03', 1)
]
const eligibleIds = eligibleLinkTargets(eligibleTree, 'p1').map((t) => t.id)
assert.deepEqual(eligibleIds, ['p2', 'q'], 'leaves outside the task are eligible (siblings too)')
assert.deepEqual(
  eligibleLinkTargets(eligibleTree, 'p').map((t) => t.id),
  [],
  'parents are never eligible (leaves only)'
)

// rollup interaction: parents pick up dependency-shifted child dates
const rollupDep = applyDependencies(
  [
    leaf('a', 'A', '2024-01-01', 3),
    leaf('b', 'B', '2024-01-10', 2, [link('a', 'FS')]),
    {
      ...leaf('p', 'P', null, null),
      children: [leaf('b2', 'B2', null, 2, [link('a', 'FS')])]
    }
  ],
  cal
)
const rolledDeps = rollupScheduleTasks(rollupDep.tasks, cal)
assert.equal(rolledDeps[2].planStart, '2024-01-04', 'parent rolls up the shifted child start')
assert.equal(rolledDeps[2].planEnd, '2024-01-05', 'parent rolls up the shifted child end')

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

// ---- plan indicator ----

const today = '2024-01-10'
assert.equal(
  planIndicator(mk('a', 100, '2024-01-01', '2024-01-05'), today),
  'green',
  '100% is green'
)
assert.equal(planIndicator(mk('b', 100, null, null), today), 'green', '100% with no dates is green')
assert.equal(
  planIndicator(mk('c', 50, '2024-01-01', '2024-01-15'), today),
  'yellow',
  'today inside plan window'
)
assert.equal(
  planIndicator(mk('d', 50, '2024-01-10', '2024-01-15'), today),
  'yellow',
  'today == planStart'
)
assert.equal(
  planIndicator(mk('e', 50, '2024-01-01', '2024-01-10'), today),
  'yellow',
  'today == planEnd'
)
assert.equal(
  planIndicator(mk('f', 50, '2024-01-01', '2024-01-09'), today),
  'red',
  'today past planEnd'
)
assert.equal(
  planIndicator(mk('g', 50, '2024-01-11', '2024-01-15'), today),
  'none',
  'today before planStart'
)
assert.equal(planIndicator(mk('h', 50, null, null), today), 'none', 'no plan dates')
assert.equal(
  planIndicator(mk('i', 50, '2024-01-01', null), today),
  'yellow',
  'only planStart, today on/after it'
)
assert.equal(
  planIndicator(mk('j', 50, '2024-01-11', null), today),
  'none',
  'only planStart, today before it'
)
assert.equal(
  planIndicator(mk('k', 50, null, '2024-01-15'), today),
  'yellow',
  'only planEnd, today on/before it'
)
assert.equal(
  planIndicator(mk('l', 50, null, '2024-01-09'), today),
  'red',
  'only planEnd, today past it'
)

// ---- column order ----

const allCols = [
  'indicator',
  'no',
  'title',
  'status',
  'owner',
  'duration',
  'planStart',
  'planEnd',
  'actualStart',
  'actualEnd',
  'percent',
  'note'
]
const fixedCols = ['indicator', 'no', 'title']

assert.deepEqual(
  normalizeColumnOrder(undefined, allCols, fixedCols),
  allCols,
  'no saved order -> default'
)
assert.deepEqual(
  normalizeColumnOrder(
    [
      'indicator',
      'no',
      'title',
      'note',
      'status',
      'owner',
      'duration',
      'planStart',
      'planEnd',
      'actualStart',
      'actualEnd',
      'percent'
    ],
    allCols,
    fixedCols
  ),
  [
    'indicator',
    'no',
    'title',
    'note',
    'status',
    'owner',
    'duration',
    'planStart',
    'planEnd',
    'actualStart',
    'actualEnd',
    'percent'
  ],
  'custom order kept'
)
assert.deepEqual(
  normalizeColumnOrder(
    [
      'no',
      'status',
      'indicator',
      'title',
      'owner',
      'duration',
      'planStart',
      'planEnd',
      'actualStart',
      'actualEnd',
      'percent',
      'note'
    ],
    allCols,
    fixedCols
  ),
  [
    'indicator',
    'no',
    'title',
    'status',
    'owner',
    'duration',
    'planStart',
    'planEnd',
    'actualStart',
    'actualEnd',
    'percent',
    'note'
  ],
  'fixed keys forced to the front in canonical order'
)
assert.deepEqual(
  normalizeColumnOrder(['bogus', 'status', 'note'], allCols, fixedCols),
  [
    'indicator',
    'no',
    'title',
    'status',
    'note',
    'owner',
    'duration',
    'planStart',
    'planEnd',
    'actualStart',
    'actualEnd',
    'percent'
  ],
  'unknown keys dropped, missing keys appended in default order'
)
assert.deepEqual(
  normalizeColumnOrder(['status', 'status', 'note'], allCols, fixedCols),
  [
    'indicator',
    'no',
    'title',
    'status',
    'note',
    'owner',
    'duration',
    'planStart',
    'planEnd',
    'actualStart',
    'actualEnd',
    'percent'
  ],
  'duplicates deduped'
)

// ---- title column width normalization ----

assert.equal(normalizeTitleWidth(undefined, 120, 600), null, 'missing width falls back to null')
assert.equal(normalizeTitleWidth('300', 120, 600), null, 'non-number width rejected')
assert.equal(normalizeTitleWidth(Number.NaN, 120, 600), null, 'NaN rejected')
assert.equal(normalizeTitleWidth(Number.POSITIVE_INFINITY, 120, 600), null, 'Infinity rejected')
assert.equal(normalizeTitleWidth(220.4, 120, 600), 220, 'fractional width rounded')
assert.equal(normalizeTitleWidth(50, 120, 600), 120, 'below-min width clamped to min')
assert.equal(normalizeTitleWidth(9999, 120, 600), 600, 'above-max width clamped to max')
assert.equal(normalizeTitleWidth(300, 120, 600), 300, 'in-range width kept')

// ---- estimate percent ----

assert.equal(estimatePercentComplete([], today), 0, 'empty tree')
assert.equal(
  estimatePercentComplete([mk('a', 100, '2024-01-01', '2024-02-01')], today),
  100,
  'leaf already 100 stays 100'
)
assert.equal(
  estimatePercentComplete([mk('b', 40, '2024-01-01', '2024-01-05')], today),
  100,
  'leaf planEnd before estimate date -> 100'
)
assert.equal(
  estimatePercentComplete([mk('c', 40, '2024-01-01', '2024-01-10')], today),
  100,
  'leaf planEnd on estimate date -> 100'
)
assert.equal(
  estimatePercentComplete([mk('d', 40, '2024-01-01', '2024-01-15')], today),
  40,
  'leaf planEnd after estimate date keeps filled value'
)
assert.equal(
  estimatePercentComplete([mk('e', 30, null, null)], today),
  30,
  'leaf without planEnd keeps filled value'
)

const estC1 = mk('c1', 0, '2024-01-01', '2024-01-05') // 5 working days, est 100
const estC2 = mk('c2', 50, '2024-01-08', '2024-01-12') // 5 working days, est 50
const estParent = { ...emptyTask(), id: 'p', children: [estC1, estC2] }
assert.equal(
  estimatePercentComplete([estParent], today),
  75,
  'parent is duration-weighted mean of estimates'
)
assert.equal(
  estimatePercentComplete([{ ...emptyTask(), id: 'g', children: [estParent] }], today),
  75,
  'nested rollup'
)
assert.equal(
  estimatePercentComplete(
    [{ ...emptyTask(), id: 'p2', children: [mk('c3', 100, null, null), mk('c4', 20, null, null)] }],
    today
  ),
  60,
  'no durations -> plain mean'
)
assert.equal(
  estimatePercentComplete(
    [mk('r1', 0, '2024-01-01', '2024-01-05'), mk('r2', 50, '2024-01-08', '2024-01-11')],
    today
  ),
  78,
  'multiple roots weighted (100*5 + 50*4) / 9'
)

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

// ---- owners ----

assert.deepEqual(parseOwners('Alice, Bob'), ['Alice', 'Bob'])
assert.deepEqual(parseOwners('  alice ,  BOB ,, '), ['alice', 'BOB'], 'trims, drops empties')
assert.deepEqual(parseOwners(''), [])
assert.deepEqual(parseOwners(' , '), [])
assert.equal(
  normalizeOwner('alice, Alice, BOB'),
  'alice, BOB',
  'case-insensitive dedupe keeps first spelling'
)
assert.equal(normalizeOwner('Bob, Alice'), 'Bob, Alice', 'order preserved')
assert.equal(normalizeOwner(' , '), '', 'empty segments normalize to empty')
assert.deepEqual(
  collectOwners([
    { ...emptyTask(), id: 'p', owner: 'Alice', children: [mk('c1', 0, null, null, 'c1')] },
    mk('c2', 0, null, null, 'c2')
  ]),
  ['Alice'],
  'collectOwners walks the tree'
)
const ownerTree: ScheduleTask[] = [
  {
    ...emptyTask(),
    id: 'p',
    owner: 'Alice',
    children: [{ ...mk('c1', 0, null, null, 'c1'), owner: 'alice' }]
  },
  { ...mk('c2', 0, null, null, 'c2'), owner: 'Bob' }
]
assert.deepEqual(
  collectOwners(ownerTree),
  ['Alice', 'Bob'],
  'distinct owners, first-seen order, case-insensitive'
)

// ---- owner stats ----

assert.deepEqual(ownerStats([]), [], 'no tasks -> no owners')

const statsTree: ScheduleTask[] = [
  {
    ...emptyTask(),
    id: 'p1',
    owner: 'Alice, Bob',
    status: 'in-progress',
    percentComplete: 50,
    duration: 2
  },
  {
    ...emptyTask(),
    id: 'l1',
    owner: 'alice',
    status: 'completed',
    percentComplete: 100,
    duration: 2
  },
  {
    ...emptyTask(),
    id: 'l2',
    owner: 'Bob',
    status: 'not-started',
    percentComplete: 0,
    duration: 1
  },
  {
    ...emptyTask(),
    id: 'l3',
    owner: 'Carol',
    status: 'pending',
    percentComplete: 30,
    duration: null
  },
  {
    ...emptyTask(),
    id: 'l4',
    owner: 'Carol',
    status: 'on-hold',
    percentComplete: 10,
    duration: null
  }
]
const stats = ownerStats(statsTree)
assert.deepEqual(
  stats.map((s) => s.name),
  ['Alice', 'Bob', 'Carol'],
  'first-seen display order, case-insensitive dedupe'
)
const alice = stats.find((s) => s.name === 'Alice')!
assert.equal(alice.assigned, 2, 'Alice credited on both "Alice" and "alice"')
assert.equal(alice.inProgress, 1)
assert.equal(alice.completed, 1)
assert.equal(alice.percentComplete, 75, 'duration-weighted mean (50*2 + 100*2) / 4')

const bob = stats.find((s) => s.name === 'Bob')!
assert.equal(bob.assigned, 2)
assert.equal(bob.inProgress, 1)
assert.equal(bob.notStarted, 1)
assert.equal(bob.percentComplete, 33, 'duration-weighted mean (50*2 + 0*1) / 3')

const carol = stats.find((s) => s.name === 'Carol')!
assert.equal(carol.assigned, 2, 'pending + on-hold both count toward assigned')
assert.equal(carol.notStarted, 0, 'pending/on-hold are not status buckets')
assert.equal(carol.inProgress, 0)
assert.equal(carol.completed, 0)
assert.equal(carol.percentComplete, 20, 'plain mean (30 + 10) / 2 when no durations')

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
assert.equal(design.percentComplete, '0%', 'percentComplete is a percent string')

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

// concurrency: parallel add_task calls must all persist (per-project planner lock)
r = await call('create_schedule', { name: 'Parallel' })
assert.equal(r.ok, true)
const parallelAdds = await Promise.all(
  Array.from({ length: 10 }, (_, i) => call('add_task', { schedule: 'Parallel', title: `P${i}` }))
)
assert.equal(
  parallelAdds.every((x) => (x as { ok: boolean }).ok),
  true
)
const parallel = await service.readSchedule('Build', 'parallel')
assert.equal(parallel!.tasks.length, 10, 'no lost updates under concurrent add_task')

// concurrency: parallel update_task calls on distinct tasks all persist
await Promise.all(
  parallel!.tasks.map((t, i) =>
    call('update_task', { schedule: 'Parallel', task: t.id, percentComplete: i * 10 })
  )
)
const afterUpdates = await service.readSchedule('Build', 'parallel')
assert.deepEqual(
  afterUpdates!.tasks.map((t) => t.percentComplete).sort((a, b) => a - b),
  [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
  'all concurrent update_task calls persisted'
)

// concurrency: parallel create_schedule with the same name — exactly one wins
const dupSchedules = await Promise.all([
  call('create_schedule', { name: 'Dup' }),
  call('create_schedule', { name: 'Dup' })
])
assert.equal(dupSchedules.filter((x) => (x as { ok: boolean }).ok).length, 1)

// add_task normalizes comma-separated owner (trim, case-insensitive dedupe)
r = await call('add_task', {
  schedule: 'Sprint 13',
  title: 'Owned',
  owner: ' alice ,  BOB , alice '
})
assert.equal(r.ok, true)
sched2 = await service.readSchedule('Build', 'sprint-13')
assert.equal(
  sched2!.tasks.find((t) => t.title === 'Owned')!.owner,
  'alice, BOB',
  'owner normalized on add'
)

// update_task normalizes owner
r = await call('update_task', { schedule: 'Sprint 13', task: 'Owned', owner: 'Bob, alice, bob' })
assert.equal(r.ok, true)
sched2 = await service.readSchedule('Build', 'sprint-13')
assert.equal(
  sched2!.tasks.find((t) => t.title === 'Owned')!.owner,
  'Bob, alice',
  'owner normalized on update'
)

// update_task rejects owner on parent tasks
r = await call('update_task', { schedule: 'Sprint 13', task: 'Wireframes', owner: 'X' })
assert.equal(r.ok, false, 'owner not editable on parent tasks')
assert.ok(String(r.error).includes('parent'), 'error mentions parent task')
sched2 = await service.readSchedule('Build', 'sprint-13')
assert.equal(
  sched2!.tasks.find((t) => t.title === 'Wireframes')!.owner,
  '',
  'parent owner unchanged'
)

// ---- batch mode (tasks array) ----

// batch add_task: shared defaults + per-item overrides + addAfter referencing an earlier record
r = await call('create_schedule', { name: 'Sprint 14' })
r = await call('add_task', {
  schedule: 'Sprint 14',
  owner: 'Amy',
  title: 'defaults-title',
  tasks: [
    { title: 'Design', planStart: '2024-01-01', planEnd: '2024-01-05' },
    { title: 'Build', owner: 'Bob', planStart: '2024-01-02', duration: 2 },
    { addAfter: 'Design', title: 'Research' },
    { parent: 'Build', title: 'Sub', planStart: '2024-01-03' },
    { parent: 'Build', title: 'Sub2', addAfter: 'Sub' }
  ]
})
assert.equal(r.ok, true)
assert.ok(!('taskId' in r), 'batch result has no single taskId')
assert.ok(r.results && r.results.length === 5)
assert.ok(
  r.results.every((x) => x.ok),
  'all batch records applied'
)
sched2 = await service.readSchedule('Build', 'sprint-14')
assert.deepEqual(
  sched2!.tasks.map((t) => t.title),
  ['Design', 'Research', 'Build'],
  'addAfter placed record 2 after record 0'
)
assert.equal(sched2!.tasks[0].owner, 'Amy', 'top-level owner default applied')
assert.equal(sched2!.tasks[1].owner, 'Amy', 'default owner on record 2')
assert.equal(sched2!.tasks[1].planEnd, null, 'planStart-only batch task gets no planEnd')
assert.equal(sched2!.tasks[2].owner, 'Bob', 'per-item owner overrides top-level default')
assert.deepEqual(
  sched2!.tasks[2].children.map((t) => t.title),
  ['Sub', 'Sub2'],
  'per-item parent nesting within the same batch'
)

// batch add_task: per-item errors are reported and do not abort other records
r = await call('add_task', {
  schedule: 'Sprint 14',
  tasks: [{ title: 'Good1' }, { title: '' }, { title: 'Good2' }]
})
assert.equal(
  (r as { results: Array<{ ok: boolean }> }).results.map((x) => x.ok).join(','),
  'true,false,true'
)
sched2 = await service.readSchedule('Build', 'sprint-14')
assert.deepEqual(
  sched2!.tasks.map((t) => t.title),
  ['Design', 'Research', 'Build', 'Good1', 'Good2'],
  'failed batch record skipped, others persisted'
)

// batch add_task: single-record output keys are unchanged (no tasks param)
r = await call('add_task', { schedule: 'Sprint 14', title: 'Solo', addAfter: 'Good1' })
assert.ok('taskId' in r)
sched2 = await service.readSchedule('Build', 'sprint-14')
assert.equal(sched2!.tasks[4].title, 'Solo', 'single-record addAfter still works')

// batch update_task: mixed hits/misses, per-item results, shared defaults
r = await call('update_task', {
  schedule: 'Sprint 14',
  status: 'in-progress',
  tasks: [
    { task: 'Design', percentComplete: 50 },
    { task: 'Sub2', percentComplete: 100, status: 'completed' },
    { task: 'missing-task', percentComplete: 10 },
    { task: 'Build', status: 'on-hold' }
  ]
})
assert.equal(r.results.length, 4)
assert.deepEqual(
  r.results.map((x) => (x as { ok: boolean }).ok),
  [true, true, false, true]
)
assert.ok(String(r.results[2].error).includes('not found'))
sched2 = await service.readSchedule('Build', 'sprint-14')
assert.equal(sched2!.tasks[0].percentComplete, 50)
assert.equal(
  sched2!.tasks[0].status,
  'in-progress',
  'top-level status default applied even on records that omit it'
)
assert.equal(
  sched2!.tasks[2].children[1].status,
  'completed',
  'per-record status overrides default'
)
assert.equal(sched2!.tasks[2].status, 'on-hold', 'explicit top-level status on parent task')

// batch update_task: parent plan-field rejection is per-item; parent status default not applied via status
// (status on parent is allowed; plan fields are rejected per record)
r = await call('update_task', {
  schedule: 'Sprint 14',
  tasks: [
    { task: 'Build', planStart: '2024-02-01' },
    { task: 'Sub', percentComplete: 25 }
  ]
})
assert.deepEqual(
  r.results.map((x) => (x as { ok: boolean }).ok),
  [false, true]
)
assert.ok(
  String(r.results[0].error).includes('derived'),
  'plan-field edit on parent rejected per record'
)
sched2 = await service.readSchedule('Build', 'sprint-14')
assert.equal(sched2!.tasks[2].children[0].percentComplete, 25, 'sibling record still applied')

// batch update_task: moves within the batch
r = await call('add_task', {
  schedule: 'Sprint 14',
  tasks: [{ title: 'Solo Batch', percentComplete: 10 }]
})
r = await call('update_task', {
  schedule: 'Sprint 14',
  tasks: [
    { task: 'Solo Batch', parent: '' },
    { task: 'Research', parent: 'Solo Batch' }
  ]
})
assert.ok(
  r.results.every((x) => x.ok),
  r
)
sched2 = await service.readSchedule('Build', 'sprint-14')
const soloBatch = sched2!.tasks.find((t) => t.title === 'Solo Batch')!
assert.ok(
  soloBatch.children.some((t) => t.title === 'Research'),
  'batch move carried through'
)

// batch add_task: batches larger than 30 records have no hard code limit
r = await call('create_schedule', { name: 'Big Batch' })
r = await call('add_task', {
  schedule: 'Big Batch',
  tasks: Array.from({ length: 35 }, (_, i) => ({ title: `T${i}`, planStart: '2024-01-01' }))
})
assert.ok(r.results.length === 35 && r.results.every((x) => x.ok), '35-record batch fully applied')
sched2 = await service.readSchedule('Build', 'big-batch')
assert.equal(sched2!.tasks.length, 35, 'records beyond 30 persist')

// add_task with an empty title in single-record mode errors
r = await call('add_task', { schedule: 'Big Batch', title: '   ' })
assert.equal(r.ok, false, 'empty single-record title is rejected')

console.log('planner tests passed')
