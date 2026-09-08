/**
 * Pure snapshot helpers — filename codec, canonical hashing input and the GFS
 * retention plan. Mirrors `planner.ts`: no runtime imports, fully unit-testable.
 */
import type { Schedule } from './planner'

/** List-item summary of a stored snapshot. */
export interface SnapshotMeta {
  /** Snapshot epoch ms (UTC). */
  ts: number
  /** First 16 hex chars of the sha256 of the canonical content. */
  hash: string
  /** File size in bytes. */
  size: number
  /** User label; tagged snapshots are exempt from retention pruning. */
  tag: string | null
}

/** Retention windows (ms): 1/min for 10 min, 1/hour for 24 h, 1/day for 7 d, 1/week for 30 d. */
export const SNAPSHOT_MINUTE = 60_000
export const SNAPSHOT_TEN_MINUTES = 10 * SNAPSHOT_MINUTE
export const SNAPSHOT_HOUR = 3_600_000
export const SNAPSHOT_ONE_DAY = 24 * SNAPSHOT_HOUR
export const SNAPSHOT_ONE_WEEK = 7 * SNAPSHOT_ONE_DAY
export const SNAPSHOT_ONE_MONTH = 30 * SNAPSHOT_ONE_DAY

/** `YYYYMMDDTHHMMSSmmm` in UTC — Windows-safe and sorts lexicographically = chronologically. */
export function snapshotFilename(ts: number, hash16: string): string {
  const d = new Date(ts)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  const stamp =
    `${p(d.getUTCFullYear())}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${p(d.getUTCMilliseconds(), 3)}`
  return `${stamp}-${hash16}.json`
}

const SNAPSHOT_NAME_RE = /^(\d{8}T\d{9})-([0-9a-f]{16})\.json$/

/** Decode a snapshot filename into `{ ts, hash }`, or null if not a snapshot file. */
export function parseSnapshotFilename(name: string): { ts: number; hash: string } | null {
  const m = SNAPSHOT_NAME_RE.exec(name)
  if (!m) return null
  const s = m[1]
  const ts = Date.UTC(
    Number(s.slice(0, 4)),
    Number(s.slice(4, 6)) - 1,
    Number(s.slice(6, 8)),
    Number(s.slice(9, 11)),
    Number(s.slice(11, 13)),
    Number(s.slice(13, 15)),
    Number(s.slice(15, 18))
  )
  return { ts, hash: m[2] }
}

/**
 * Canonical snapshot-hash input: the schedule JSON minus `updatedAt`, which is
 * stamped on every save — without this, a no-op save would always hash as new.
 */
export function canonicalScheduleString(schedule: Schedule): string {
  return JSON.stringify({
    id: schedule.id,
    name: schedule.name,
    createdAt: schedule.createdAt,
    tasks: schedule.tasks,
    columnVisibility: schedule.columnVisibility,
    columnOrder: schedule.columnOrder
  })
}

/** Normalize a user snapshot tag: single-line, collapsed whitespace, max 64 chars. */
export function normalizeSnapshotTag(tag: string): string {
  return tag.replace(/\s+/g, ' ').trim().slice(0, 64)
}

/** Which retention bucket a snapshot's ts falls into, given its age. */
function snapshotBucketKey(ts: number, age: number): string {
  if (age <= SNAPSHOT_TEN_MINUTES) return `min:${Math.floor(ts / SNAPSHOT_MINUTE)}`
  if (age <= SNAPSHOT_ONE_DAY) return `hour:${Math.floor(ts / SNAPSHOT_HOUR)}`
  if (age <= SNAPSHOT_ONE_WEEK) return `day:${Math.floor(ts / SNAPSHOT_ONE_DAY)}`
  return `week:${Math.floor(ts / SNAPSHOT_ONE_WEEK)}`
}

/**
 * GFS retention plan over snapshots sorted by ts (any order in, sorted here).
 * Tagged snapshots always survive; the newest untagged snapshot per bucket
 * (1/min ≤ 10 min, 1/hour ≤ 24 h, 1/day ≤ 7 d, 1/week ≤ 30 d) is kept and
 * everything older than one month is purged. On top of that, identical content
 * collapses to its newest instance: reverting to an earlier state (A → B → A)
 * must not keep two snapshots with the same hash — the newest one wins because
 * the newest snapshot always mirrors the live content.
 */
export function planSnapshotPrune(
  entries: ReadonlyArray<{ name: string; ts: number; hash: string }>,
  now: number,
  taggedNames: ReadonlySet<string>
): { keep: Set<string>; delete: Set<string> } {
  const sorted = [...entries].sort((a, b) => b.ts - a.ts)
  const keep = new Set<string>()
  const remove = new Set<string>()
  const seenBuckets = new Set<string>()
  const seenHashes = new Set<string>()
  for (const entry of sorted) {
    if (taggedNames.has(entry.name)) {
      keep.add(entry.name)
      seenHashes.add(entry.hash)
      continue
    }
    const age = now - entry.ts
    if (age > SNAPSHOT_ONE_MONTH) {
      remove.add(entry.name)
      continue
    }
    const bucket = snapshotBucketKey(entry.ts, age)
    const bucketTaken = seenBuckets.has(bucket)
    seenBuckets.add(bucket)
    if (bucketTaken || seenHashes.has(entry.hash)) {
      remove.add(entry.name)
      continue
    }
    seenHashes.add(entry.hash)
    keep.add(entry.name)
  }
  return { keep, delete: remove }
}
