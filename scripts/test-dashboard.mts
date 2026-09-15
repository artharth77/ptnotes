/**
 * Dashboard aggregation tests — pure shared logic, no Electron dependencies.
 * Run: tsx --tsconfig tsconfig.node.json scripts/test-dashboard.mts
 *   (or included via `npm run test` once appended to package.json test chain)
 */
import assert from 'node:assert/strict'
import type { KanbanBoard, KanbanColumn, KanbanCard } from '../src/shared/kanban'
import type { ProjectCalendar, Schedule, ScheduleTask, ScheduleStatus } from '../src/shared/planner'
import type { NoteMeta } from '../src/shared/types'
import {
  buildActivityFromDates,
  buildDashboardSnapshot,
  buildRecentNotes,
  computeKanbanStats,
  computePlannerHealth,
  computeWorkload,
  findOverdueItems
} from '../src/shared/dashboard'

const TODAY = '2025-09-15'

function makeCol(id: string, title: string, color: string): KanbanColumn {
  return { id, title, color, highlightOverdue: true }
}

function makeCard(
  overrides: Partial<KanbanCard> & { id: string; title: string; columnId: string }
): KanbanCard {
  const now = Date.now() - 86400000
  return {
    assignee: '',
    storyPoints: null,
    dueDate: null,
    priority: 'medium' as const,
    comments: [],
    createdAt: now,
    updatedAt: now,
    attributes: {},
    labels: [],
    ...overrides
  }
}

function makeTask(
  id: string,
  title: string,
  overrides: Partial<ScheduleTask> & { status: ScheduleStatus; planStart: string; planEnd: string }
): ScheduleTask {
  return {
    id,
    title,
    description: '',
    owner: '',
    percentComplete: overrides.status === 'completed' ? 100 : (overrides.percentComplete ?? 0),
    duration: 1,
    children: [],
    priority: 'medium',
    tags: [],
    blockedBy: [],
    actualStart:
      overrides.status !== 'not-started' && !overrides.actualStart
        ? overrides.planStart
        : (overrides.actualStart ?? null),
    actualEnd: overrides.status === 'completed' ? overrides.planEnd : null,
    ...overrides
  }
}

const COLUMNS: KanbanColumn[] = [
  makeCol('todo', 'To Do', '#e53e3e'),
  makeCol('prog', 'In Progress', '#3182ce'),
  makeCol('done', 'Done', '#2f855a'),
  makeCol('hold', 'On Hold', '#b7791f')
]

const CARDS: KanbanCard[] = [
  makeCard({
    id: 'c1',
    title: 'Design home page',
    columnId: 'todo',
    assignee: 'Alice',
    dueDate: '2025-09-12',
    storyPoints: 5,
    priority: 'high'
  }),
  makeCard({
    id: 'c2',
    title: 'Setup CI pipeline',
    columnId: 'todo',
    assignee: 'Bob',
    dueDate: '2025-09-15',
    storyPoints: 3
  }),
  makeCard({
    id: 'c3',
    title: 'Write README',
    columnId: 'todo',
    assignee: '',
    dueDate: '2025-09-18',
    storyPoints: 1,
    priority: 'low'
  }),
  makeCard({
    id: 'c4',
    title: 'API login endpoint',
    columnId: 'prog',
    assignee: 'Alice',
    dueDate: '2025-09-14',
    storyPoints: 8,
    priority: 'high'
  }),
  makeCard({
    id: 'c5',
    title: 'Password reset flow',
    columnId: 'prog',
    assignee: 'Bob',
    dueDate: '2025-09-20',
    storyPoints: 5
  }),
  makeCard({
    id: 'c6',
    title: 'Landing page copy',
    columnId: 'done',
    assignee: 'Alice',
    dueDate: '2025-09-01',
    storyPoints: 2
  }),
  makeCard({
    id: 'c7',
    title: 'Repo init',
    columnId: 'done',
    assignee: '',
    dueDate: '2025-08-01',
    storyPoints: 1
  }),
  makeCard({
    id: 'c8',
    title: 'Security audit follow-up',
    columnId: 'hold',
    assignee: 'Alice',
    dueDate: '2025-09-22',
    storyPoints: 13,
    priority: 'high'
  })
]

const BOARD: KanbanBoard = { version: 1, columns: COLUMNS, cards: CARDS }

const TASKS: ScheduleTask[] = [
  makeTask('t1', 'Project planning', {
    status: 'completed',
    planStart: '2025-09-01',
    planEnd: '2025-09-03',
    duration: 3,
    percentComplete: 100,
    owner: 'Alice'
  }),
  makeTask('t2', 'Frontend', {
    status: 'in-progress',
    planStart: '2025-09-04',
    planEnd: '2025-09-13',
    duration: 8,
    percentComplete: 60,
    owner: 'Alice',
    children: [
      makeTask('t2a', 'Header component', {
        status: 'completed',
        planStart: '2025-09-04',
        planEnd: '2025-09-05',
        duration: 2,
        owner: 'Alice',
        percentComplete: 100
      }),
      makeTask('t2b', 'Login form', {
        status: 'in-progress',
        planStart: '2025-09-06',
        planEnd: '2025-09-09',
        duration: 4,
        owner: 'Bob',
        percentComplete: 50
      }),
      makeTask('t2c', 'Dashboard UI', {
        status: 'not-started',
        planStart: '2025-09-10',
        planEnd: '2025-09-13',
        duration: 2,
        owner: 'Alice',
        percentComplete: 0
      })
    ]
  }),
  makeTask('t3', 'Backend API', {
    status: 'in-progress',
    planStart: '2025-09-05',
    planEnd: '2025-09-18',
    duration: 10,
    percentComplete: 40,
    owner: 'Bob',
    children: [
      makeTask('t3a', 'Auth', {
        status: 'completed',
        planStart: '2025-09-05',
        planEnd: '2025-09-08',
        duration: 4,
        owner: 'Bob',
        percentComplete: 100
      }),
      makeTask('t3b', 'Projects CRUD', {
        status: 'pending',
        planStart: '2025-09-09',
        planEnd: '2025-09-15',
        duration: 4,
        owner: 'Alice',
        percentComplete: 0
      }),
      makeTask('t3c', 'File uploads', {
        status: 'not-started',
        planStart: '2025-09-16',
        planEnd: '2025-09-18',
        duration: 2,
        owner: 'Bob',
        percentComplete: 0
      })
    ]
  })
]

const SCHEDULE: Schedule = {
  id: 's1',
  name: 'Launch v1.0',
  description: '',
  owner: 'Alice',
  tasks: TASKS,
  milestones: [],
  createdAt: Date.now() - 1_000_000,
  updatedAt: Date.now() - 500_000
}

const CALENDAR: ProjectCalendar = {
  workingDays: [1, 2, 3, 4, 5],
  holidays: []
}

const NOTES: NoteMeta[] = [
  {
    id: 'welcome',
    name: 'Welcome',
    updatedAt: Date.now() - 86400000 * 3,
    createdAt: Date.now() - 86400000 * 10,
    starred: false,
    snippet: ''
  },
  {
    id: 'specs',
    name: 'Product Specs',
    updatedAt: Date.now() - 86400000,
    createdAt: Date.now() - 86400000 * 8,
    starred: true,
    snippet: ''
  },
  {
    id: 'retro',
    name: 'Retro notes',
    updatedAt: Date.now() - 86400000 * 5,
    createdAt: Date.now() - 86400000 * 9,
    starred: false,
    snippet: ''
  }
]

function run(): void {
  // --- Kanban stats ---
  const stats = computeKanbanStats(BOARD)
  assert.equal(stats.totalCards, 8, 'total cards should be 8')
  assert.equal(stats.totalDone, 2, 'done cards = 2 (Done column)')
  assert.equal(stats.totalActive, 6, 'active cards = total - done = 6')
  const byId = new Map(stats.rows.map((r) => [r.columnId, r]))
  assert.equal(byId.get('todo')?.count, 3, 'To Do = 3')
  assert.equal(byId.get('prog')?.count, 2, 'In Progress = 2')
  assert.equal(byId.get('done')?.isDone, true, 'Done column isDone = true')
  assert.equal(byId.get('hold')?.isDone, false, 'On Hold isDone = false')

  // --- Workload per assignee ---
  const workload = computeWorkload(BOARD, [SCHEDULE])
  const byOwner = new Map(workload.map((w) => [w.owner, w]))
  const alice = byOwner.get('Alice')
  const bob = byOwner.get('Bob')
  const unassigned = byOwner.get('(unassigned)')
  assert.ok(alice, 'Alice row exists')
  assert.ok(bob, 'Bob row exists')
  assert.ok(unassigned, 'Unassigned row exists (c3 active card in To Do no owner)')
  // Alice kanban active cards = c1(ToDo) + c4(Prog) + c8(Hold) = 3; done columns excluded.
  // Alice planner non-completed tasks: t2 + t2c + t3b (t1/t2a/t3a done, t2b/t3c Bob).
  assert.equal(
    alice.kanbanCards,
    3,
    'Alice kanbanCards = 3 (active non-done cols, c3 reassigned unassigned)'
  )
  // Total items >= 6 → bucket low/medium (≥8 high threshold → 3+3=6 medium; adjust to ≥6)
  assert.ok(alice.totalItems >= 6, `Alice totalItems >= 6, got ${alice.totalItems}`)
  // Bob: kanban active c2(ToDo)+c5(Prog)=2; planner t2b + t3 + t3c non-completed = 3 → total 5 → bucket medium.
  assert.equal(bob.kanbanCards, 2, 'Bob kanbanCards = 2')
  assert.equal(bob.bucket, 'medium', 'Bob total 5 → bucket medium (4-7)')
  // Unassigned: kanban active = c3 only = 1; planner no empty owner non-completed → totalItems 1 → low.
  assert.equal(unassigned.kanbanCards, 1, 'Unassigned kanbanCards = 1 (c3)')
  assert.equal(unassigned.bucket, 'low', 'Unassigned totalItems = 1 → bucket low')

  // --- Overdue items triage (upcomingDays default 7 = through 2025-09-22 inclusive? diff <=7 from TODAY 2025-09-15 → 2025-09-15..2025-09-22) ---
  const overdue = findOverdueItems(BOARD, [SCHEDULE], TODAY, 7)
  // Expected overdue (diff < 0): cards c1(09-12), c4(09-14); planner t2(planEnd 09-13, not done), t2b(09-09), t3b(09-15? today not overdue).
  assert.ok(overdue.overdue.length >= 2, `overdue cards >=2, got ${overdue.overdue.length}`)
  // Expected today (diff=0): c2(09-15) + maybe planner today (t3b 09-15).
  const todayCount = overdue.today.length
  assert.ok(todayCount >= 1, `today items >=1, got ${todayCount}`)
  // Upcoming (1..7): cards c3(09-18, 3d), c5(09-20,5d), c8(09-22,7d); planner t3c(09-18, 3d), t3(09-18).
  assert.ok(overdue.upcoming.length >= 2, `upcoming >=2, got ${overdue.upcoming.length}`)
  assert.equal(
    overdue.total,
    overdue.overdue.length + overdue.today.length + overdue.upcoming.length,
    'overdue.total equals sum of three buckets'
  )

  // --- Planner health ---
  const health = computePlannerHealth([SCHEDULE], CALENDAR, TODAY)
  assert.equal(health.scheduleCount, 1, 'schedule count = 1')
  // Leaf tasks = t1, t2a, t2b, t2c, t3a, t3b, t3c = 7 leaf.
  assert.equal(health.totalLeafTasks, 7, 'leaf tasks = 7')
  assert.ok(
    health.totalTasks >= 9,
    `totalTasks = tree nodes (parents + leaf) >= 9, got ${health.totalTasks}`
  )
  // Owner unique set: Alice, Bob = 2 (ownerCount).
  assert.equal(health.ownerCount, 2, `ownerCount = 2, got ${health.ownerCount}`)
  // Critical path days: longest duration chain (BackEnd → t3a,t3b,t3c total durations max vs Frontend chain max) → at least 10 (t3 duration 10 + children chains may be higher or same).
  assert.ok(
    health.criticalPathDays >= 10,
    `criticalPathDays >= longest task duration 10, got ${health.criticalPathDays}`
  )
  // Completed: t1, t2a, t3a → 3 leaf completed.
  assert.ok(health.onTimeTasks >= 3, `onTime >= completed tasks 3, got ${health.onTimeTasks}`)
  // Late active tasks (status != completed, planEnd < today): t2, t2b.
  assert.ok(health.lateTasks >= 2, `late active tasks >= 2, got ${health.lateTasks}`)
  // Percent complete via weighted duration: overallPercentComplete.
  assert.ok(
    health.percentComplete > 0 && health.percentComplete < 100,
    `percentComplete between 0-100, got ${health.percentComplete}`
  )

  // --- Recent notes sort ---
  const recent = buildRecentNotes(NOTES, 5)
  assert.equal(recent.length, 3, '3 notes total')
  assert.equal(recent[0].id, 'specs', 'Most recently updated = specs (updated 1d ago)')
  assert.equal(recent[recent.length - 1].id, 'retro', 'Oldest updated = retro (5d ago)')
  // starred preserved
  assert.equal(recent.find((n) => n.id === 'specs')?.starred, true, 'specs starred = true')

  // --- Activity feed (sorted union) ---
  const files = [
    { name: 'sow.pdf', path: 'files/sow.pdf', mtime: Date.now() - 60_000 },
    { name: 'design.zip', path: 'files/archive/design.zip', mtime: Date.now() - 3600_000 * 26 }
  ]
  const chats = [
    { name: 'Brainstorming', path: 'chat/abc123.json', mtime: Date.now() - 3600_000 * 4 }
  ]
  const kanbanMs = Date.now() - 3600_000

  const activity = buildActivityFromDates(NOTES, kanbanMs, [SCHEDULE], files, chats, 8)
  assert.equal(
    activity.length,
    8,
    'activity limited to 8 items (3 notes + 1 kanban + 1 schedule + 2 files + 1 chat = 8)'
  )
  // First item = newest: files[0] sow.pdf (2h ago) newest.
  assert.equal(activity[0].kind, 'files', 'newest activity kind = files (sow.pdf)')
  assert.equal(activity[0].name, 'sow.pdf', 'newest activity name = sow.pdf')
  // Strict desc by updatedAt
  for (let i = 1; i < activity.length; i++) {
    assert.ok(
      activity[i - 1].updatedAt >= activity[i].updatedAt,
      `activity sorted desc at i=${i}: ${activity[i - 1].updatedAt} vs ${activity[i].updatedAt}`
    )
  }

  // --- Full snapshot builder ---
  const snap = buildDashboardSnapshot({
    projectId: 'test-proj',
    projectName: 'Test Project',
    kanban: BOARD,
    schedules: [SCHEDULE],
    notes: NOTES,
    calendar: CALENDAR,
    todayIso: TODAY,
    kanbanUpdatedAt: kanbanMs,
    filesMtimes: files,
    chatsUpdatedAt: chats
  })
  assert.equal(snap.projectId, 'test-proj')
  assert.equal(snap.projectName, 'Test Project')
  assert.ok(snap.generatedAt > 0, 'generatedAt timestamp set')
  assert.equal(snap.kanbanStats.totalCards, 8, 'snapshot kanban total cards = 8')
  assert.equal(snap.workload.length, byOwner.size, 'workload size matches distinct owners set')
  assert.equal(snap.overdue.total, overdue.total, 'snapshot overdue total matches findOverdueItems')
  assert.equal(snap.plannerHealth.ownerCount, health.ownerCount)
  assert.equal(snap.recentNotes.length, recent.length)
  assert.ok(snap.activity.length > 0, 'snapshot activity populated')

  console.log('✅ dashboard tests passed')
  console.log(
    '   kanban:',
    stats.totalCards,
    'cards, done',
    stats.totalDone,
    'active',
    stats.totalActive
  )
  console.log(
    '   workload owners:',
    workload.length,
    '→ Alice bucket',
    alice.bucket,
    'Bob bucket',
    bob.bucket
  )
  console.log(
    '   overdue:',
    overdue.overdue.length,
    '/ today:',
    overdue.today.length,
    '/ upcoming:',
    overdue.upcoming.length,
    '/ total',
    overdue.total
  )
  console.log(
    '   planner %%complete:',
    health.percentComplete.toFixed(1),
    '% / late',
    health.lateTasks,
    '/ onTime',
    health.onTimeTasks
  )
}

run()
