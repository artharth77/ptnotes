import Module from 'node:module'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'

const ROOT = '/tmp/ptnotes-snapshots-test-root'

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
const { scheduleSnapshotHash } = await import('../src/main/service/snapshots')
const {
  canonicalScheduleString,
  normalizeSnapshotTag,
  parseSnapshotFilename,
  planSnapshotPrune,
  snapshotFilename
} = await import('../src/shared/snapshots')
import type { Schedule, ScheduleTask } from '../src/shared/types'

// ---- filename codec ----

const CODEC_TS = 1725000000123
const codecName = snapshotFilename(CODEC_TS, 'a1b2c3d4e5f60718')
const codecParsed = parseSnapshotFilename(codecName)
assert.ok(codecParsed, 'valid snapshot name parses')
assert.equal(codecParsed.ts, CODEC_TS, 'ts round-trips exactly through the filename')
assert.equal(codecParsed.hash, 'a1b2c3d4e5f60718')
assert.equal(parseSnapshotFilename('tags.json'), null)
assert.equal(parseSnapshotFilename('foo.json'), null)
assert.equal(parseSnapshotFilename('20260101T00000000-zzz.json'), null)

// ---- canonical hash input ignores updatedAt ----

const canonA: Schedule = { id: 'x', name: 'X', createdAt: 1, updatedAt: 100, tasks: [] }
const canonB: Schedule = { id: 'x', name: 'X', createdAt: 1, updatedAt: 999, tasks: [] }
assert.equal(canonicalScheduleString(canonA), canonicalScheduleString(canonB))

// ---- tag normalization ----

assert.equal(normalizeSnapshotTag('  a   b \n c '), 'a b c')
assert.equal(normalizeSnapshotTag('x'.repeat(100)), 'x'.repeat(64))

// ---- retention plan (fully controlled clock) ----

const MIN = 60_000
const H = 3_600_000
const D = 86_400_000
const NOW = 3003 * D // aligned to week/day/hour/minute boundaries

function mk(
  ts: number,
  hash = ts.toString(16).padStart(16, '0')
): {
  name: string
  ts: number
  hash: string
} {
  return { name: snapshotFilename(ts, hash), ts, hash }
}

const entries = [
  mk(NOW - 90_000), // minute bucket -2
  mk(NOW - 30_000), // minute bucket -1
  mk(NOW - 120_000), // minute bucket -2 (dup → deleted)
  mk(NOW - 65 * MIN), // hour bucket -1 (newest of its bucket)
  mk(NOW - 125 * MIN), // hour bucket -3 (dup of 121min's bucket, older → deleted)
  mk(NOW - 121 * MIN), // hour bucket -3
  mk(NOW - 25 * H), // day bucket -2
  mk(NOW - 49 * H), // day bucket -3
  mk(NOW - 47 * H), // day bucket -2 (dup → deleted)
  mk(NOW - 8 * D), // week bucket -2
  mk(NOW - 15 * D), // week bucket -3
  mk(NOW - 14 * D), // week bucket -2 (dup → deleted)
  mk(NOW - 40 * D), // > 1 month → purged
  mk(NOW - 40 * D, 'b'.repeat(16)) // > 1 month but tagged → kept
]
const tagged = new Set([entries[13].name])
const plan = planSnapshotPrune(entries, NOW, tagged)
assert.equal(plan.keep.size, 9, 'keeps newest per bucket + tagged')
assert.equal(plan.delete.size, 5)
for (const idx of [2, 4, 8, 11, 12]) {
  assert.ok(plan.delete.has(entries[idx].name), `entry ${idx} pruned`)
}
assert.ok(plan.keep.has(entries[13].name), 'tagged snapshot survives purge window')

// ---- retention plan: identical content collapses to the newest instance ----

const HA = 'a1'.padEnd(16, '0')
const HB = 'b2'.padEnd(16, '0')
const dupEntries = [
  mk(NOW - 30_000, HA), // newest content-A snapshot → kept
  mk(NOW - 90_000, HB), // content-B → kept (distinct minute bucket)
  mk(NOW - 65 * MIN, HA), // revert back to A → same hash as newest → pruned
  mk(NOW - 8 * D, HA), // older A but TAGGED → kept
  mk(NOW - 9 * D, HA) // older untagged A → pruned (hash already present)
]
const dupTagged = new Set([dupEntries[3].name])
const dupPlan = planSnapshotPrune(dupEntries, NOW, dupTagged)
assert.deepEqual(
  [...dupPlan.keep].sort(),
  [dupEntries[0].name, dupEntries[1].name, dupEntries[3].name].sort(),
  'keeps newest A, B and the tagged older A'
)
assert.deepEqual(
  [...dupPlan.delete].sort(),
  [dupEntries[2].name, dupEntries[4].name].sort(),
  'older same-content snapshots collapse into the newest instance'
)

// ---- service level ----

const service = new PTNotesService()
const PROJ = 'SnapProj'
await service.createProject(PROJ)

function task(id: string, title: string): ScheduleTask {
  return {
    id,
    title,
    status: 'not-started',
    owner: '',
    duration: null,
    planStart: null,
    planEnd: null,
    actualStart: null,
    actualEnd: null,
    percentComplete: 0,
    note: '',
    children: []
  }
}

const snapDir = (id: string): string => `${service.root}/${PROJ}/.data/snapshots/planner/${id}`

/** Craft a backdated snapshot file with a deterministic fake hash. */
async function craftSnapshot(
  dir: string,
  scheduleId: string,
  ts: number,
  hash: string,
  tasks: ScheduleTask[]
): Promise<void> {
  const schedule: Schedule = {
    id: scheduleId,
    name: scheduleId,
    createdAt: ts,
    updatedAt: ts,
    tasks
  }
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(`${dir}/${snapshotFilename(ts, hash)}`, JSON.stringify(schedule, null, 2))
}

// capture on create + save, dedup on no-op save

const alpha = await service.createSchedule(PROJ, 'Alpha')
const sid = alpha.id
let snaps = await service.listSnapshots(PROJ, sid)
assert.ok(snaps.length >= 1, 'baseline captured on create')

let sched = await service.readSchedule(PROJ, sid)
assert.ok(sched)
sched = { ...sched, tasks: [task('t1', 'First')] }
await service.saveSchedule(PROJ, sched)
snaps = await service.listSnapshots(PROJ, sid)
const newest = snaps[0]

// newest snapshot content matches the save
const newestFile = await service.readSnapshot(PROJ, sid, newest.ts)
assert.ok(newestFile)
assert.deepEqual(
  newestFile.tasks.map((t) => t.title),
  ['First']
)

// no-op save (only updatedAt bumped) → dedup skips: newest ts unchanged
sched = { ...sched, updatedAt: sched.updatedAt + 1 }
await service.saveSchedule(PROJ, sched)
snaps = await service.listSnapshots(PROJ, sid)
assert.equal(snaps[0].ts, newest.ts, 'no new snapshot when canonical content is unchanged')

// revert to earlier content (A → B → A) → the older same-hash snapshot
// collapses into the newest instance instead of leaving a duplicate

const firstContent = { ...sched }
const firstHash = scheduleSnapshotHash(firstContent).slice(0, 16)
sched = { ...sched, tasks: [task('t2', 'Second')] }
await service.saveSchedule(PROJ, sched)
await service.saveSchedule(PROJ, firstContent)
snaps = await service.listSnapshots(PROJ, sid)
const reverted = snaps.filter((m) => m.hash === firstHash)
assert.equal(reverted.length, 1, 'reverted content keeps a single snapshot instance')
assert.equal(snaps[0].hash, firstHash, 'reverted state is the newest snapshot')

// retention on real files: purge > 30d, tag exemption, distinct buckets survive

const T = Date.now()
const retro = await service.createSchedule(PROJ, 'Retro')
const rid = retro.id
const rdir = snapDir(rid)
const t25h = T - 25 * H
const t49h = T - 49 * H
const t8d = T - 8 * D
const t15d = T - 15 * D
const t40d = T - 40 * D
const t40dTagged = T - 40 * D + 1
const craftedTasks = [task('r1', 'Crafted')]
await craftSnapshot(rdir, rid, t25h, '1'.repeat(16), craftedTasks)
await craftSnapshot(rdir, rid, t49h, '2'.repeat(16), craftedTasks)
await craftSnapshot(rdir, rid, t8d, '3'.repeat(16), craftedTasks)
await craftSnapshot(rdir, rid, t15d, '4'.repeat(16), craftedTasks)
await craftSnapshot(rdir, rid, t40d, 'e'.repeat(16), craftedTasks)
await craftSnapshot(rdir, rid, t40dTagged, 'f'.repeat(16), craftedTasks)
// tags written before the prune-triggering save → tag exemption applies
await service.setSnapshotTag(PROJ, rid, t40dTagged, 'pinned-old')
await service.setSnapshotTag(PROJ, rid, t25h, '  milestone   one  ')

let rsched = await service.readSchedule(PROJ, rid)
assert.ok(rsched)
rsched = { ...rsched, tasks: [task('tr1', 'Trigger')] }
await service.saveSchedule(PROJ, rsched) // captures + prunes

snaps = await service.listSnapshots(PROJ, rid)
const tsSet = new Set(snaps.map((m) => m.ts))
const hashSet = new Set(snaps.map((m) => m.hash))
assert.ok(tsSet.has(t25h), '25h-old snapshot kept (day bucket)')
assert.ok(tsSet.has(t49h), '49h-old snapshot kept (distinct day bucket)')
assert.ok(tsSet.has(t8d), '8d-old snapshot kept (week bucket)')
assert.ok(tsSet.has(t15d), '15d-old snapshot kept (distinct week bucket)')
assert.ok(hashSet.has('f'.repeat(16)), 'tagged >30d snapshot kept')
assert.ok(!hashSet.has('e'.repeat(16)), 'untagged >30d snapshot purged')
assert.equal(snaps.find((m) => m.ts === t25h)?.tag, 'milestone one', 'tag normalized + listed')

// tag rename / clear / unknown-ts error

await service.setSnapshotTag(PROJ, rid, t25h, 'renamed')
snaps = await service.listSnapshots(PROJ, rid)
assert.equal(snaps.find((m) => m.ts === t25h)?.tag, 'renamed')
await service.setSnapshotTag(PROJ, rid, t25h, null)
snaps = await service.listSnapshots(PROJ, rid)
assert.equal(snaps.find((m) => m.ts === t25h)?.tag, null)
await assert.rejects(() => service.setSnapshotTag(PROJ, rid, 12345, 'x'), /Snapshot not found/)

// explicit delete removes file + tag entry

await service.deleteSnapshot(PROJ, rid, t49h)
snaps = await service.listSnapshots(PROJ, rid)
assert.ok(!snaps.some((m) => m.ts === t49h), 'deleted snapshot gone')
await assert.rejects(() => service.deleteSnapshot(PROJ, rid, t49h), /Snapshot not found/)

// restore: captures pre-restore state, writes snapshot back, re-stamps updatedAt

const res = await service.createSchedule(PROJ, 'Res')
const resid = res.id
const oldTasks = [task('o1', 'Old task')]
await craftSnapshot(snapDir(resid), resid, T - 2 * H, '9'.repeat(16), oldTasks)
let live = await service.readSchedule(PROJ, resid)
assert.ok(live)
live = { ...live, tasks: [task('n1', 'New task')] }
await service.saveSchedule(PROJ, live)

const restored = await service.restoreSnapshot(PROJ, resid, T - 2 * H)
assert.equal(restored.id, resid, 'restored content stamped with the current schedule id')
assert.deepEqual(
  restored.tasks.map((t) => t.title),
  ['Old task']
)
assert.ok(restored.updatedAt > T - 2 * H, 'updatedAt re-stamped on restore')
live = await service.readSchedule(PROJ, resid)
assert.ok(live)
assert.deepEqual(
  live.tasks.map((t) => t.title),
  ['Old task']
)

snaps = await service.listSnapshots(PROJ, resid)
const contents = await Promise.all(snaps.map((m) => service.readSnapshot(PROJ, resid, m.ts)))
const titles = new Set(contents.flatMap((c) => (c ? c.tasks.map((t) => t.title) : [])))
assert.ok(titles.has('New task'), 'pre-restore state captured (restore is reversible)')
assert.ok(titles.has('Old task'), 'restored state captured as newest history entry')

await assert.rejects(() => service.restoreSnapshot(PROJ, resid, 987654), /Snapshot not found/)

// corrupt tags.json tolerated

await fs.writeFile(`${snapDir(resid)}/tags.json`, '{ not json', 'utf8')
snaps = await service.listSnapshots(PROJ, resid)
assert.ok(snaps.length >= 1)
assert.ok(
  snaps.every((m) => m.tag === null),
  'corrupt tag map reads as empty'
)
const corruptTargetTs = snaps[0].ts
await service.setSnapshotTag(PROJ, resid, corruptTargetTs, 'after-corrupt')
snaps = await service.listSnapshots(PROJ, resid)
assert.equal(snaps.find((m) => m.ts === corruptTargetTs)?.tag, 'after-corrupt')

// rename moves the snapshot dir (tags included); delete removes it

snaps = await service.listSnapshots(PROJ, sid)
await service.setSnapshotTag(PROJ, sid, snaps[0].ts, 'keepme')
const renamed = await service.renameSchedule(PROJ, sid, 'Alpha Prime')
const newId = renamed.id
assert.equal(newId, 'alpha-prime')
const moved = await service.listSnapshots(PROJ, newId)
assert.equal(moved.length, snaps.length, 'snapshot dir moved on rename')
assert.equal(moved.find((m) => m.ts === snaps[0].ts)?.tag, 'keepme', 'tags survive rename')
assert.equal((await service.listSnapshots(PROJ, sid)).length, 0, 'old snapshot key empty')

await service.deleteSchedule(PROJ, newId)
assert.equal((await service.listSnapshots(PROJ, newId)).length, 0, 'snapshots removed on delete')
await assert.rejects(() => fs.access(snapDir(newId)), 'snapshot dir removed from disk')

console.log('snapshots tests passed')
