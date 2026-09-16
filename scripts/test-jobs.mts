import Module from 'node:module'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'

const ROOT = '/tmp/ptnotes-jobs-test-root'

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
  ruleMinutes,
  sanitizeTimeRule,
  shouldRunExact,
  shouldRunNext,
  computeNextRunAt,
  planJobPrune
} = await import('../src/shared/scheduleJobs')
const { JobsStore } = await import('../src/main/jobs/db')
const { JobScheduler } = await import('../src/main/jobs/scheduler')

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

assert.ok(shouldRunExact(ruleAt903, ALL_DAYS, nowWed), 'within ±2 min window fires')
assert.ok(!shouldRunExact(ruleAt903, ALL_DAYS, nowWed - 3 * MIN), 'before the window does not fire')
assert.ok(
  !shouldRunExact(ruleAt903, ALL_DAYS, nowWed, nowWed - 1 * MIN),
  'recent run (<2 min ago) dedupes'
)
assert.ok(
  shouldRunExact(ruleAt903, ALL_DAYS, nowWed, nowWed - 5 * MIN),
  'old previous run still fires'
)
const monday = L(5, 15, 12, 3)
assert.ok(!shouldRunExact(ruleAt903, [0], monday), 'not the scheduled day → no fire')

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

store.closeAll()
store2.closeAll()
await fs.rm(ROOT, { recursive: true, force: true })
console.log('test-jobs: all assertions passed')
