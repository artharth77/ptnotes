import { promises as fs } from 'fs'
import { createHash, randomUUID } from 'crypto'
import { dirname, join } from 'path'
import type { Schedule, SnapshotMeta } from '@shared/types'
import {
  canonicalScheduleString,
  normalizeSnapshotTag,
  parseSnapshotFilename,
  planSnapshotPrune,
  snapshotFilename
} from '@shared/snapshots'

const TAGS_FILE = 'tags.json'

type TagMap = Record<string, { tag: string; taggedAt: number }>

/** sha256 of the canonical schedule content (first 64 hex chars). */
export function scheduleSnapshotHash(schedule: Schedule): string {
  return createHash('sha256').update(canonicalScheduleString(schedule)).digest('hex')
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(tmp, content, 'utf8')
    await fs.rename(tmp, path)
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
}

function isScheduleLike(value: unknown): value is Schedule {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  return typeof s.id === 'string' && Array.isArray(s.tasks)
}

async function readTagMap(dir: string): Promise<TagMap> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, TAGS_FILE), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: TagMap = {}
    for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      if (typeof e.tag !== 'string' || !e.tag.trim()) continue
      out[name] = { tag: e.tag, taggedAt: typeof e.taggedAt === 'number' ? e.taggedAt : 0 }
    }
    return out
  } catch {
    return {}
  }
}

async function writeTagMap(dir: string, map: TagMap): Promise<void> {
  if (Object.keys(map).length === 0) {
    await fs.unlink(join(dir, TAGS_FILE)).catch(() => {})
    return
  }
  await atomicWrite(join(dir, TAGS_FILE), JSON.stringify(map, null, 2))
}

interface SnapshotEntry {
  name: string
  ts: number
  hash: string
}

async function listSnapshotEntries(dir: string): Promise<SnapshotEntry[]> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const entries: SnapshotEntry[] = []
  for (const name of names) {
    const parsed = parseSnapshotFilename(name)
    if (parsed) entries.push({ name, ...parsed })
  }
  entries.sort((a, b) => b.ts - a.ts)
  return entries
}

/** All snapshot metas (newest first) with tag labels merged in. */
export async function listSnapshotMetas(dir: string): Promise<SnapshotMeta[]> {
  const [entries, tags] = await Promise.all([listSnapshotEntries(dir), readTagMap(dir)])
  const metas: SnapshotMeta[] = []
  for (const entry of entries) {
    let size = 0
    try {
      size = (await fs.stat(join(dir, entry.name))).size
    } catch {
      // vanished between readdir and stat — still list it with size 0
    }
    metas.push({
      ts: entry.ts,
      hash: entry.hash,
      size,
      tag: tags[entry.name]?.tag ?? null
    })
  }
  return metas
}

/** Enforce the retention plan; also drops tag entries of pruned files. */
export async function pruneSnapshotDir(dir: string, now: number): Promise<void> {
  const [entries, tags] = await Promise.all([listSnapshotEntries(dir), readTagMap(dir)])
  if (entries.length === 0) return
  const plan = planSnapshotPrune(
    entries.map((e) => ({ name: e.name, ts: e.ts, hash: e.hash })),
    now,
    new Set(Object.keys(tags))
  )
  for (const name of plan.delete) {
    await fs.unlink(join(dir, name)).catch(() => {})
    delete tags[name]
  }
  await writeTagMap(dir, tags)
}

/**
 * Capture a snapshot of the schedule unless the newest snapshot already holds
 * the same content (hash dedup — survives restarts via the filename hash),
 * then enforce retention (which also collapses older same-content snapshots
 * into the newest instance, so a revert A → B → A never keeps duplicates).
 * `force` skips the dedup check (restore's pre-capture uses it, nudged a
 * minute back, so both sides of a restore survive pruning). Callers that must
 * not fail wrap this themselves.
 */
export async function captureScheduleSnapshot(
  dir: string,
  schedule: Schedule,
  now: number,
  opts?: { force?: boolean }
): Promise<void> {
  const hash16 = scheduleSnapshotHash(schedule).slice(0, 16)
  await fs.mkdir(dir, { recursive: true })
  if (!opts?.force) {
    const entries = await listSnapshotEntries(dir)
    if (entries.length > 0 && entries[0].hash === hash16) return
  }
  await atomicWrite(join(dir, snapshotFilename(now, hash16)), JSON.stringify(schedule, null, 2))
  await pruneSnapshotDir(dir, now)
}

/** Set / rename / clear (null) the user tag of the snapshot at `ts`. */
export async function setSnapshotTag(
  dir: string,
  ts: number,
  rawTag: string | null
): Promise<void> {
  const entries = await listSnapshotEntries(dir)
  const entry = entries.find((e) => e.ts === ts)
  if (!entry) throw new Error(`Snapshot not found`)
  const tags = await readTagMap(dir)
  const tag = rawTag === null ? null : normalizeSnapshotTag(rawTag)
  if (!tag) {
    delete tags[entry.name]
  } else {
    tags[entry.name] = { tag, taggedAt: Date.now() }
  }
  await writeTagMap(dir, tags)
}

/** Read one snapshot's schedule content; null when missing or invalid. */
export async function readSnapshotFile(dir: string, ts: number): Promise<Schedule | null> {
  const entries = await listSnapshotEntries(dir)
  const entry = entries.find((e) => e.ts === ts)
  if (!entry) return null
  try {
    const schedule: unknown = JSON.parse(await fs.readFile(join(dir, entry.name), 'utf8'))
    return isScheduleLike(schedule) ? schedule : null
  } catch {
    return null
  }
}

/** Explicitly delete one snapshot (the only way a tagged one disappears). */
export async function deleteSnapshotFile(dir: string, ts: number): Promise<void> {
  const entries = await listSnapshotEntries(dir)
  const entry = entries.find((e) => e.ts === ts)
  if (!entry) throw new Error('Snapshot not found')
  await fs.unlink(join(dir, entry.name)).catch(() => {})
  const tags = await readTagMap(dir)
  if (tags[entry.name]) {
    delete tags[entry.name]
    await writeTagMap(dir, tags)
  }
}

/** Move a snapshot dir to a new key (schedule rename). Skips if target exists. */
export async function moveSnapshotDir(oldDir: string, newDir: string): Promise<void> {
  try {
    await fs.access(oldDir)
  } catch {
    return
  }
  const exists = await fs
    .access(newDir)
    .then(() => true)
    .catch(() => false)
  if (exists) return
  try {
    await fs.mkdir(dirname(newDir), { recursive: true })
    await fs.rename(oldDir, newDir)
  } catch {
    // same-volume rename can still fail (e.g. target busy) — fall back to copy
    await fs.mkdir(newDir, { recursive: true })
    const names = await fs.readdir(oldDir)
    for (const name of names) {
      await fs.copyFile(join(oldDir, name), join(newDir, name)).catch(() => {})
    }
    await fs.rm(oldDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Remove a schedule's whole snapshot dir (schedule deleted). */
export async function deleteSnapshotDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
}
