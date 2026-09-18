import Module from 'node:module'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import type { GlobalJobRunnerDeps } from '../src/main/jobs/globalRunner'

const ROOT = '/tmp/ptnotes-jobs-test-root'

interface FakeCall {
  messages: Array<{ role: string; content: string }>
}

/** Stand-in for the `openai` SDK: records calls, answers via a swappable responder. */
class FakeOpenAI {
  static calls: FakeCall[] = []
  static responder: (n: number, call: FakeCall) => Promise<string> = async () => 'ok'
  chat = {
    completions: {
      create: async (params: { messages: Array<{ role: string; content: string }> }) => {
        const n = FakeOpenAI.calls.length
        FakeOpenAI.calls.push({ messages: params.messages })
        const content = await FakeOpenAI.responder(n, { messages: params.messages })
        return { choices: [{ message: { content } }] }
      }
    }
  }
}

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return { app: { getPath: () => ROOT, getAppPath: () => ROOT } }
  }
  if (request === 'openai') {
    return { __esModule: true, OpenAI: FakeOpenAI, default: FakeOpenAI }
  }
  return origLoad.call(this, request, parent, isMain)
}

await fs.rm(ROOT, { recursive: true, force: true })

const {
  ruleMinutes,
  sanitizeTimeRule,
  shouldRunExact,
  shouldRunNext,
  computeNextRunAt,
  planJobPrune,
  isNoResponse,
  GLOBAL_PROJECT_KEY,
  projectLabel
} = await import('../src/shared/scheduleJobs')
const { JobsStore } = await import('../src/main/jobs/db')
const { JobScheduler } = await import('../src/main/jobs/scheduler')
const { GlobalJobRunner } = await import('../src/main/jobs/globalRunner')

const MIN = 60_000
/** Local wall-clock timestamp: new Date(2026, 5, 17, 12, 3).getTime(). */
const L = (m: number, d: number, h: number, min: number): number =>
  new Date(2026, m, d, h, min).getTime()

// ---- rule expansion ----

assert.deepEqual(ruleMinutes({ kind: 'hourly', fromHours: 9, toHours: 11, minute: 5 }), [
  5 + 9 * 60,
  5 + 10 * 60,
  5 + 11 * 60
])
const r30 = ruleMinutes({ kind: 'every30', fromHours: 9, toHours: 9 })
assert.deepEqual(r30, [540, 570])
const r10 = ruleMinutes({ kind: 'every10', fromHours: 9, toHours: 9 })
assert.deepEqual(r10, [540, 550, 560, 570, 580, 590])
assert.deepEqual(ruleMinutes({ kind: 'list', times: ['09:15', 'bad', '23:05'] }), [555, 1385])

// ---- time rule sanitize ----

assert.deepEqual(sanitizeTimeRule({ kind: 'list', times: ['09:15', 'x', '25:99', '  08:00 '] }), {
  kind: 'list',
  times: ['08:00', '09:15']
})
assert.deepEqual(sanitizeTimeRule({ kind: 'hourly', fromHours: 5, toHours: 99, minute: 70 }), {
  kind: 'hourly',
  fromHours: 5,
  toHours: 23,
  minute: 59
})
assert.deepEqual(sanitizeTimeRule(null), { kind: 'hourly', fromHours: 0, toHours: 23, minute: 0 })

// ---- exact condition (±2 minutes, dedupe) ----

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
// Wed 2026-06-17 local 12:03
const nowWed = L(5, 17, 12, 3)
const ruleAt903 = { kind: 'hourly', fromHours: 9, toHours: 17, minute: 3 }

assert.ok(shouldRunExact(ruleAt903, ALL_DAYS, nowWed), 'fires at the slot minute')
assert.ok(shouldRunExact(ruleAt903, ALL_DAYS, nowWed + MIN), 'fires 1 min after the slot')
assert.ok(shouldRunExact(ruleAt903, ALL_DAYS, nowWed + 2 * MIN), 'fires 2 min after the slot')
assert.ok(!shouldRunExact(ruleAt903, ALL_DAYS, nowWed - 1 * MIN), 'before the slot does not fire')
assert.ok(!shouldRunExact(ruleAt903, ALL_DAYS, nowWed - 3 * MIN), 'before the window does not fire')
assert.ok(
  !shouldRunExact(ruleAt903, ALL_DAYS, nowWed, nowWed - 1 * MIN),
  'recent run (<3 min ago) dedupes'
)
assert.ok(
  !shouldRunExact(ruleAt903, ALL_DAYS, nowWed, nowWed - 2 * MIN),
  'run 2 min ago still dedupes (3-min guard)'
)
assert.ok(
  shouldRunExact(ruleAt903, ALL_DAYS, nowWed, nowWed - 3 * MIN),
  'run exactly 3 min ago fires again'
)
assert.ok(
  shouldRunExact(ruleAt903, ALL_DAYS, nowWed, nowWed - 5 * MIN),
  'old previous run still fires'
)
const monday = L(5, 15, 12, 3)
assert.ok(!shouldRunExact(ruleAt903, [0], monday), 'not the scheduled day → no fire')

// midnight wrap: a 23:59 slot fires in 00:00–00:01 of the following day
const midnightRule = { kind: 'list', times: ['23:59'] }
assert.ok(
  shouldRunExact(midnightRule, ALL_DAYS, L(5, 18, 0, 1)),
  'late yesterday slot still fires 1 min after midnight'
)
assert.ok(
  !shouldRunExact(midnightRule, ALL_DAYS, L(5, 18, 0, 3)),
  'window closes 2 min after midnight'
)
assert.ok(!shouldRunExact(midnightRule, ALL_DAYS, L(5, 17, 23, 57)), 'before the slot: no fire')

// ---- next condition (+ pre-computed next fire time) ----

assert.ok(!shouldRunNext(nowWed, undefined), 'no nextRunAt → no fire')
assert.ok(!shouldRunNext(nowWed - 10, nowWed), 'before nextRunAt → no fire')
assert.ok(shouldRunNext(nowWed + 10, nowWed), 'at/after nextRunAt → fire')

// computeNextRunAt: from Wed 12:03 with hourly 9–17 @ :30 → next is Wed 12:30
const ruleAt930 = { kind: 'hourly', fromHours: 9, toHours: 17, minute: 30 }
const nextSameDay = computeNextRunAt(ruleAt930, ALL_DAYS, nowWed + 1)
assert.equal(nextSameDay, L(5, 17, 12, 30), 'next slot later today')
// after the day's last slot → next day's first slot
const afterLast = L(5, 17, 17, 30)
assert.equal(
  computeNextRunAt(ruleAt930, ALL_DAYS, afterLast + 1),
  L(5, 18, 9, 30),
  'rolls to next allowed day'
)
// day filter respected
const sundayOnly = computeNextRunAt(
  { kind: 'hourly', fromHours: 8, toHours: 8, minute: 0 },
  [0],
  L(5, 15, 9, 0)
)
assert.equal(sundayOnly, L(5, 21, 8, 0), 'next allowed Sunday only')

// ---- retention plan ----

const now = 1_800_000_000_000
assert.deepEqual(
  planJobPrune(
    [
      { runId: 'old', startedAt: now - 31 * 24 * 3_600_000 },
      { runId: 'new', startedAt: now - 10 * 24 * 3_600_000 }
    ],
    now
  ),
  ['old']
)

// ---- NO RESPONSE detection (markdown/case/whitespace variants) ----

assert.ok(isNoResponse('**NO RESPONSE**'), 'canonical marker')
assert.ok(isNoResponse('NO RESPONSE'), 'without emphasis')
assert.ok(isNoResponse('*no response*'), 'lowercase + single emphasis')
assert.ok(isNoResponse('`NO  RESPONSE`'), 'code + double space')
assert.ok(isNoResponse('done.\n\nNO RESPONSE'), 'prose + trailing marker')

assert.ok(!isNoResponse('Here is today\u2019s summary.'), 'normal answer notifies')
assert.ok(!isNoResponse('no one responded'), 'unrelated phrase stays notified')

// ---- JobsStore CRUD ----

const store = new JobsStore(() => ROOT)
await fs.mkdir(ROOT, { recursive: true })

const saved = store.saveJob('pj', {
  title: 'Weekly digest',
  enabled: true,
  days: [1, 3, 5],
  timeRule: { kind: 'every30', fromHours: 9, toHours: 17 },
  condition: 'exact',
  prompt: 'Summarize',
  language: ''
})
assert.equal(store.listJobs('pj').length, 1)
assert.equal(saved.title, 'Weekly digest')
assert.deepEqual(saved.days, [1, 3, 5])

const updated = store.saveJob('pj', {
  id: saved.id,
  title: 'Renamed',
  enabled: false,
  days: [1],
  timeRule: { kind: 'list', times: ['09:15', '09:30'] },
  condition: 'next',
  prompt: 'Summarize 2',
  language: 'Thai',
  conditionMeta: { nextRunAt: 12345 }
})
assert.equal(updated.title, 'Renamed')
assert.equal(updated.enabled, false)
assert.equal(updated.nextRunAt, 12345)
assert.equal(updated.language, 'Thai')

store.setJobEnabled('pj', saved.id, true)
assert.ok(store.getJob('pj', saved.id)!.enabled)

const run = store.startRun('pj', saved.id, 'Renamed')
store.finishRun('pj', run.runId, 'done', { notice: 'hello' })
const runs = store.listRuns('pj', saved.id)
assert.equal(runs.length, 1)
assert.equal(runs[0].status, 'done')
assert.equal(runs[0].notice, 'hello')

// trace append + read-by-run-id round trip
await store.appendRunTrace(
  'pj',
  run.runId,
  { type: 'header', project: 'pj', key: run.runId, kind: 'module', startedAt: 1 },
  [JSON.stringify({ role: 'user', ts: 2, content: 'hi', seq: 0 })]
)
const trace = await store.readRunTraceByRunId('pj', run.runId)
assert.ok(trace, 'trace file readable')
assert.equal(trace!.entries.length, 1)
assert.ok(trace!.path!.endsWith('.trace.jsonl'), '"path" must point at file')

await store.deleteJob('pj', saved.id)
assert.equal(store.listJobs('pj').length, 0)
assert.equal(
  await fs.access(join(ROOT, 'pj', '.data', 'jobs', 'traces', `${run.runId}.trace.jsonl`)).then(
    () => true,
    () => false
  ),
  false,
  'deleteJob removes the run trace file'
)

// error paths
assert.throws(() =>
  store.saveJob('pj', {
    title: '',
    enabled: true,
    days: [1],
    timeRule: { kind: 'hourly', fromHours: 0, toHours: 23, minute: 0 },
    condition: 'exact',
    prompt: 'x'
  })
)
assert.throws(() =>
  store.saveJob('pj', {
    title: 'T',
    enabled: true,
    days: [],
    timeRule: { kind: 'hourly', fromHours: 0, toHours: 1, minute: 0 },
    condition: 'exact',
    prompt: 'x'
  })
)

// ---- job scope (project vs global) ----

assert.equal(projectLabel(''), 'All projects', 'sentinel key labels as All projects')
assert.equal(projectLabel('my-proj'), 'my-proj', 'project key labels as itself')

const gJob = store.saveJob(GLOBAL_PROJECT_KEY, {
  title: 'Global job',
  enabled: false,
  days: [1],
  timeRule: { kind: 'hourly', fromHours: 9, toHours: 17, minute: 0 },
  condition: 'exact',
  prompt: 'g',
  scope: 'global'
})
assert.equal(gJob.scope, 'global', 'global scope round-trips')
assert.equal(store.listJobs(GLOBAL_PROJECT_KEY).length, 1, 'global job lives under the root DB key')
assert.ok(
  !store.listJobs('pj').some((j) => j.id === gJob.id),
  'project list unaffected by global job'
)

const pJob = store.saveJob('pj2', {
  title: 'Project job',
  enabled: false,
  days: [1],
  timeRule: { kind: 'hourly', fromHours: 9, toHours: 17, minute: 0 },
  condition: 'exact',
  prompt: 'p'
})
assert.equal(pJob.scope, 'project', 'scope defaults to project')

// cross-scope saves are rejected
assert.throws(() =>
  store.saveJob('pj2', {
    title: 'Bad',
    enabled: true,
    days: [1],
    timeRule: { kind: 'hourly', fromHours: 9, toHours: 17, minute: 0 },
    condition: 'exact',
    prompt: 'x',
    scope: 'global'
  })
)
assert.throws(() =>
  store.saveJob(GLOBAL_PROJECT_KEY, {
    title: 'Bad',
    enabled: true,
    days: [1],
    timeRule: { kind: 'hourly', fromHours: 9, toHours: 17, minute: 0 },
    condition: 'exact',
    prompt: 'x',
    scope: 'project'
  })
)

// updating without a scope keeps the stored scope
const gRenamed = store.saveJob(GLOBAL_PROJECT_KEY, {
  id: gJob.id,
  title: 'Global job 2',
  enabled: false,
  days: [1],
  timeRule: { kind: 'hourly', fromHours: 9, toHours: 17, minute: 0 },
  condition: 'exact',
  prompt: 'g2'
})
assert.equal(gRenamed.scope, 'global', 'update without scope keeps stored scope')

await store.deleteJob(GLOBAL_PROJECT_KEY, gJob.id)
await store.deleteJob('pj2', pJob.id)
assert.equal(
  store.listJobs(GLOBAL_PROJECT_KEY).length,
  0,
  'global DB empty again for scheduler tests'
)

// ---- scope move (recreate in the other scope, delete old job + traces) ----

const mvSrc = store.saveJob('mvproj', {
  title: 'Move me',
  enabled: true,
  days: [1],
  timeRule: { kind: 'hourly', fromHours: 9, toHours: 17, minute: 0 },
  condition: 'next',
  prompt: 'move',
  conditionMeta: { nextRunAt: 999 }
})
const mvRun = store.startRun('mvproj', mvSrc.id, 'Move me')
store.finishRun('mvproj', mvRun.runId, 'done', { notice: 'n' })
await store.appendRunTrace(
  'mvproj',
  mvRun.runId,
  { type: 'header', project: 'mvproj', key: mvRun.runId, kind: 'module', startedAt: 1 },
  [JSON.stringify({ role: 'user', ts: 2, content: 'hi', seq: 0 })]
)
const mvTracePath = join(ROOT, 'mvproj', '.data', 'jobs', 'traces', `${mvRun.runId}.trace.jsonl`)
assert.ok(
  await fs.access(mvTracePath).then(
    () => true,
    () => false
  ),
  'trace file exists before the move'
)

const moved = await store.moveJobScope('mvproj', GLOBAL_PROJECT_KEY, mvSrc.id, {
  title: 'Moved',
  enabled: false,
  days: [2],
  timeRule: { kind: 'list', times: ['10:00'] },
  condition: 'next',
  prompt: 'moved',
  language: 'Thai',
  scope: 'global',
  conditionMeta: { nextRunAt: 12345 }
})
assert.notEqual(moved.id, mvSrc.id, 'move creates a new job id')
assert.equal(moved.scope, 'global', 'moved job has the destination scope')
assert.equal(moved.title, 'Moved', 'moved job carries the edited fields')
assert.equal(moved.nextRunAt, 12345, 'moved job gets the new nextRunAt')
assert.equal(moved.lastRunAt, undefined, 'moved job starts with no run history')
assert.equal(store.getJob('mvproj', mvSrc.id), null, 'old job deleted from the source DB')
assert.equal(store.listRuns('mvproj', mvSrc.id).length, 0, 'old run rows deleted')
assert.equal(
  await fs.access(mvTracePath).then(
    () => true,
    () => false
  ),
  false,
  'old trace file deleted'
)
assert.ok(store.getJob(GLOBAL_PROJECT_KEY, moved.id), 'new job lives in the global DB')
assert.equal(store.listJobs('mvproj').length, 0, 'source project DB has no jobs left')

// move back to a project scope
const movedBack = await store.moveJobScope(GLOBAL_PROJECT_KEY, 'mvproj2', moved.id, {
  title: 'Moved back',
  enabled: true,
  days: [3],
  timeRule: { kind: 'hourly', fromHours: 9, toHours: 17, minute: 0 },
  condition: 'exact',
  prompt: 'back',
  scope: 'project'
})
assert.notEqual(movedBack.id, moved.id, 'second move creates another new id')
assert.equal(movedBack.scope, 'project', 'moved back to project scope')
assert.equal(store.getJob(GLOBAL_PROJECT_KEY, moved.id), null, 'old global job deleted')
assert.ok(store.getJob('mvproj2', movedBack.id), 'job lives in the destination project DB')

// error paths
assert.rejects(
  store.moveJobScope('mvproj2', GLOBAL_PROJECT_KEY, movedBack.id, {
    title: 'X',
    enabled: true,
    days: [1],
    timeRule: { kind: 'hourly', fromHours: 9, toHours: 17, minute: 0 },
    condition: 'exact',
    prompt: 'x',
    scope: 'project'
  }),
  /unchanged/,
  'same scope is rejected'
)
assert.rejects(
  store.moveJobScope('mvproj2', GLOBAL_PROJECT_KEY, 'nope', {
    title: 'X',
    enabled: true,
    days: [1],
    timeRule: { kind: 'hourly', fromHours: 9, toHours: 17, minute: 0 },
    condition: 'exact',
    prompt: 'x',
    scope: 'global'
  }),
  /not found/,
  'missing source job is rejected'
)

await store.deleteJob('mvproj2', movedBack.id)
assert.equal(store.listJobs(GLOBAL_PROJECT_KEY).length, 0, 'global DB empty after move tests')

// ---- scheduler tick (controlled clock + fake runner) ----

const store2 = new JobsStore(() => ROOT)
const fired: Array<{ project: string; jobTitle: string }> = []
const notifies: unknown[] = []
const scheduler = new JobScheduler({
  listProjects: async () => ['proj-a'],
  store: store2,
  runnerFor: (project) => ({
    run: async (job) => {
      fired.push({ project, jobTitle: job.title })
      return {
        run: { runId: 'r', jobId: job.id, title: job.title, startedAt: Date.now(), status: 'done' },
        status: 'done' as const,
        statusNotice: 'result here',
        notify: true
      }
    }
  }),
  broadcast: (evt) => notifies.push(evt)
})

// create + enable an hourly job whose minute is in the past of "now"
const j = store2.saveJob('proj-a', {
  title: 'Hourly',
  enabled: true,
  days: [0, 1, 2, 3, 4, 5, 6],
  timeRule: { kind: 'hourly', fromHours: 0, toHours: 23, minute: 0 },
  condition: 'exact',
  prompt: 'go'
})

const nowTick = L(5, 17, 12, 1) // :01 → within ±2 of :00 slot
await scheduler.tick(nowTick)
assert.equal(fired.length, 1, 'due exact job fired')
assert.deepEqual(
  notifies.filter((n) => (n as { type: string }).type === 'notify').length,
  1,
  'notify: ' + JSON.stringify(notifies.slice(0, 3))
)
assert.ok((store2.getJob('proj-a', j.id)!.lastRunAt ?? 0) > 0, 'lastRunAt recorded')

// dedupe: a tick 1 minute later still inside the window + dedupe window → no fire
await scheduler.tick(nowTick + MIN)
assert.equal(fired.length, 1, 'dedupe blocks re-fire')

// next hourly window (13:00) → fires again
await scheduler.tick(nowTick + 60 * MIN)
assert.equal(fired.length, 2, 'fires again after dedupe window')

// next condition: stores nextRunAt before run, only fires once reached
const jNext = store2.saveJob('proj-a', {
  title: 'NextJob',
  enabled: true,
  days: [0, 1, 2, 3, 4, 5, 6],
  timeRule: { kind: 'hourly', fromHours: 8, toHours: 20, minute: 15 },
  condition: 'next',
  prompt: 'go',
  conditionMeta: { nextRunAt: nowTick + 2 * MIN }
})
await scheduler.tick(nowTick) // not due yet
assert.ok(!store2.getJob('proj-a', jNext.id)!.lastRunAt, 'not fired before nextRunAt')
await scheduler.tick(nowTick + 2 * MIN + 1_000)
assert.ok(store2.getJob('proj-a', jNext.id)!.nextRunAt, 'nextRunAt was recomputed')
assert.ok(
  fired.some((f) => f.jobTitle === 'NextJob'),
  'next-condition job fired'
)

// ---- scheduler global pass (no projects at all) ----

const store3 = new JobsStore(() => ROOT)
const gfired: string[] = []
const gScheduler = new JobScheduler({
  listProjects: async () => [],
  store: store3,
  runnerFor: (project) => ({
    run: async (job) => {
      gfired.push(project)
      return {
        run: { runId: 'r', jobId: job.id, title: job.title, startedAt: Date.now(), status: 'done' },
        status: 'done' as const,
        statusNotice: 'global result',
        notify: true
      }
    }
  }),
  broadcast: () => {}
})
const gj = store3.saveJob(GLOBAL_PROJECT_KEY, {
  title: 'Global hourly',
  enabled: true,
  days: [0, 1, 2, 3, 4, 5, 6],
  timeRule: { kind: 'hourly', fromHours: 0, toHours: 23, minute: 0 },
  condition: 'exact',
  prompt: 'go',
  scope: 'global'
})
await gScheduler.tick(L(5, 17, 12, 1)) // :01 → within the :00 slot window
assert.equal(gfired.length, 1, 'global job fires with zero projects')
assert.equal(gfired[0], GLOBAL_PROJECT_KEY, 'global job runs under the empty key')
assert.ok((store3.getJob(GLOBAL_PROJECT_KEY, gj.id)!.lastRunAt ?? 0) > 0, 'global lastRunAt set')

// ---- GlobalJobRunner fan-out (mocked openai) ----

const fakeConfigStore = {
  load: async () => ({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k', model: 'm' })
}
const runnerDeps = (projects: string[]): GlobalJobRunnerDeps => ({
  root: () => ROOT,
  listProjects: async () => projects,
  service: {} as never,
  configStore: fakeConfigStore as never,
  moduleManager: {} as never,
  moduleRegistry: { list: () => [] } as never,
  disabledModules: [],
  db: store3,
  signal: new AbortController().signal
})
// fresh job so the fan-out scenarios see only their own run rows
const gj2 = store3.saveJob(GLOBAL_PROJECT_KEY, {
  title: 'Fanout job',
  enabled: true,
  days: [0, 1, 2, 3, 4, 5, 6],
  timeRule: { kind: 'hourly', fromHours: 0, toHours: 23, minute: 0 },
  condition: 'exact',
  prompt: 'go',
  scope: 'global'
})
const isSummaryCall = (call: FakeCall): boolean =>
  call.messages.some((m) => m.role === 'user' && m.content.startsWith('## Project:'))

// A: two projects, both succeed → 2 child calls + 1 summary, children recorded
FakeOpenAI.calls = []
FakeOpenAI.responder = async (_n, call) =>
  isSummaryCall(call) ? 'SUMMARY(alpha,beta)' : 'child answer'
let grunner = new GlobalJobRunner(runnerDeps(['alpha', 'beta']))
let gRun = store3.startRun(GLOBAL_PROJECT_KEY, gj2.id, gj2.title)
let gres = await grunner.run(gj2, gRun)
assert.equal(gres.status, 'done', 'A: all children done → done')
assert.equal(gres.notify, true, 'A: summary notifies')
assert.equal(gres.statusNotice, 'SUMMARY(alpha,beta)', 'A: notice is the summary')
assert.equal(FakeOpenAI.calls.length, 3, 'A: 2 children + 1 summary call')
assert.ok(isSummaryCall(FakeOpenAI.calls[2]), 'A: third call is the summarizer')
const aRuns = store3.listRuns(GLOBAL_PROJECT_KEY, gj2.id)
assert.equal(aRuns.length, 3, 'A: 2 child rows + 1 parent row')
assert.ok(aRuns.some((r) => r.title === 'Fanout job · alpha' && r.status === 'done'))
assert.ok(aRuns.some((r) => r.title === 'Fanout job · beta' && r.status === 'done'))
assert.equal(aRuns.filter((r) => r.title === gj2.title).length, 1, 'A: one parent row')
const aTrace = await store3.readRunTraceByRunId(GLOBAL_PROJECT_KEY, gRun.runId)
assert.ok(aTrace, 'A: parent trace readable')
assert.equal(
  aTrace!.entries.filter((e) => e.role === 'tool' && e.name === 'run-project').length,
  2,
  'A: parent trace has one run-project entry per child'
)

// B: one child fails → still done, summary includes the failure
FakeOpenAI.calls = []
let bChildCalls = 0
FakeOpenAI.responder = async (_n, call) => {
  if (isSummaryCall(call)) return 'SUMMARY-with-failure'
  bChildCalls++
  if (bChildCalls === 2) throw new Error('child boom')
  return 'ok answer'
}
grunner = new GlobalJobRunner(runnerDeps(['alpha', 'beta']))
gRun = store3.startRun(GLOBAL_PROJECT_KEY, gj2.id, gj2.title)
gres = await grunner.run(gj2, gRun)
assert.equal(gres.status, 'done', 'B: partial failure → done')
assert.equal(gres.statusNotice, 'SUMMARY-with-failure', 'B: summary still notifies')
assert.equal(FakeOpenAI.calls.length, 3, 'B: summary still runs')
assert.ok(
  FakeOpenAI.calls[2].messages.some((m) => m.content.includes('(run failed: Error: child boom)')),
  'B: failure section reaches the summarizer'
)
const bRuns = store3.listRuns(GLOBAL_PROJECT_KEY, gj2.id)
assert.ok(
  bRuns.some((r) => r.status === 'failed' && r.title.includes(' · ')),
  'B: failed child row recorded'
)

// C: all children fail → failed, no summary call
FakeOpenAI.calls = []
FakeOpenAI.responder = async (_n, call) => {
  if (isSummaryCall(call)) return 'must not be called'
  throw new Error('boom')
}
grunner = new GlobalJobRunner(runnerDeps(['alpha', 'beta']))
gRun = store3.startRun(GLOBAL_PROJECT_KEY, gj2.id, gj2.title)
gres = await grunner.run(gj2, gRun)
assert.equal(gres.status, 'failed', 'C: all failed → failed')
assert.equal(gres.notify, false, 'C: no notification')
assert.equal(FakeOpenAI.calls.length, 2, 'C: no summarizer call')

// D: single project → passthrough, no summarizer call
FakeOpenAI.calls = []
FakeOpenAI.responder = async () => 'solo answer'
grunner = new GlobalJobRunner(runnerDeps(['solo']))
gRun = store3.startRun(GLOBAL_PROJECT_KEY, gj2.id, gj2.title)
gres = await grunner.run(gj2, gRun)
assert.equal(gres.status, 'done', 'D: single project done')
assert.equal(gres.statusNotice, 'solo answer', 'D: child answer passed through')
assert.equal(FakeOpenAI.calls.length, 1, 'D: no summarizer call')

// E: summary is NO RESPONSE → no notification
FakeOpenAI.calls = []
FakeOpenAI.responder = async (_n, call) =>
  isSummaryCall(call) ? '**NO RESPONSE**' : 'child answer'
grunner = new GlobalJobRunner(runnerDeps(['alpha', 'beta']))
gRun = store3.startRun(GLOBAL_PROJECT_KEY, gj2.id, gj2.title)
gres = await grunner.run(gj2, gRun)
assert.equal(gres.status, 'done', 'E: still done')
assert.equal(gres.notify, false, 'E: NO RESPONSE suppresses the notification')
assert.equal(gres.statusNotice, undefined, 'E: notice suppressed')

store.closeAll()
store2.closeAll()
store3.closeAll()
await fs.rm(ROOT, { recursive: true, force: true })
console.log('test-jobs: all assertions passed')
