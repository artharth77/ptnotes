import { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, promises as fs } from 'fs'
import type {
  BotMemoryEntry,
  BotProfile,
  BotTaskQueueItem,
  BotUpsertInput,
  GroupChatData,
  GroupChatMeta,
  GroupMessage,
  GroupMessagePageOpts,
  GroupPatch,
  GroupSenderKind,
  NewGroupInput
} from '@shared/bots'
import {
  GROUP_CHAT_PAGE_SIZE,
  MAX_GROUP_BOTS,
  MAX_MEMORY_ENTRIES,
  mergeMemoryEntries
} from '@shared/bots'
import type { AiTraceFile } from '@shared/types'

function validateId(id: string): string {
  if (!id || id === '.' || id === '..' || id.includes('/') || id.includes('\\')) {
    throw new Error(`Invalid id: ${id}`)
  }
  return id
}

interface BotRow {
  id: string
  name: string
  role: string
  role_details: string | null
  persona: string
  profile_id: string | null
  model: string | null
  created_at: number
  updated_at: number
}

interface GroupRow {
  group_id: string
  title: string
  bot_ids: string
  leader_bot_id: string
  summary: string | null
  summarized_up_to_seq: number | null
  created_at: number
  updated_at: number
}

interface MessageRow {
  id: string
  group_id: string
  seq: number
  sender_kind: string
  bot_id: string | null
  sender_name: string
  role: string | null
  is_leader: number | null
  content: string
  ts: number
  error: number | null
  task_id: string | null
}

interface QueueRow {
  queue_id: string
  group_id: string
  bot_id: string
  run_id: string | null
  title: string
  task: string
  requested_by: string
  origin_msg: string | null
  status: string
  created_at: number
}

function rowToBot(r: BotRow): BotProfile {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    ...(r.role_details ? { roleDetails: r.role_details } : {}),
    persona: r.persona,
    ...(r.profile_id ? { profileId: r.profile_id } : {}),
    ...(r.model ? { model: r.model } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function rowToGroup(r: GroupRow, project: string, messageCount: number): GroupChatMeta {
  let botIds: string[] = []
  try {
    const parsed = JSON.parse(r.bot_ids) as unknown
    if (Array.isArray(parsed)) botIds = parsed.filter((b): b is string => typeof b === 'string')
  } catch {
    botIds = []
  }
  return {
    groupId: r.group_id,
    project,
    title: r.title,
    botIds,
    leaderBotId: r.leader_bot_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount
  }
}

function rowToMessage(r: MessageRow): GroupMessage {
  return {
    id: r.id,
    seq: r.seq,
    senderKind: r.sender_kind as GroupSenderKind,
    ...(r.bot_id ? { botId: r.bot_id } : {}),
    senderName: r.sender_name,
    ...(r.role ? { role: r.role } : {}),
    ...(r.is_leader ? { isLeader: true } : {}),
    content: r.content,
    ts: r.ts,
    ...(r.error ? { error: true } : {}),
    ...(r.task_id ? { taskId: r.task_id } : {})
  }
}

function rowToQueueItem(r: QueueRow): BotTaskQueueItem {
  return {
    queueId: r.queue_id,
    groupId: r.group_id,
    botId: r.bot_id,
    ...(r.run_id ? { runId: r.run_id } : {}),
    title: r.title,
    task: r.task,
    requestedBy: r.requested_by,
    ...(r.origin_msg ? { originMsg: r.origin_msg } : {}),
    status: r.status === 'running' ? 'running' : 'queued',
    createdAt: r.created_at
  }
}

/**
 * SQLite persistence for the bots system:
 * - global bot profiles in `userData/bots.db`
 * - per-project group chats / messages / memories / task queue in
 *   `<project>/.data/bots/groupchat.db` (follows the project root)
 * - per-group raw AI trace JSONL files in `<project>/.data/bots/<groupId>.trace.jsonl`
 */
export class BotsStore {
  private botsDb: DatabaseSync | null = null
  private readonly projectDbs = new Map<string, DatabaseSync>()
  private getRoot: () => string
  private readonly userDataDir: string

  constructor(getRoot: () => string, userDataDir: string) {
    this.getRoot = getRoot
    this.userDataDir = userDataDir
  }

  setRootDir(root: string): void {
    this.closeAllProjects()
    this.getRoot = () => root
  }

  closeAllProjects(): void {
    for (const db of this.projectDbs.values()) {
      try {
        db.close()
      } catch {
        // already closed
      }
    }
    this.projectDbs.clear()
  }

  closeAll(): void {
    this.closeAllProjects()
    if (this.botsDb) {
      try {
        this.botsDb.close()
      } catch {
        // already closed
      }
      this.botsDb = null
    }
  }

  // ---- global bots DB ----

  private globalDb(): DatabaseSync {
    if (this.botsDb) return this.botsDb
    mkdirSync(this.userDataDir, { recursive: true })
    const db = new DatabaseSync(join(this.userDataDir, 'bots.db'))
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec(`CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      role_details TEXT,
      persona TEXT NOT NULL DEFAULT '',
      profile_id TEXT,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`)
    const cols = db.prepare('PRAGMA table_info(bots)').all() as unknown as { name: string }[]
    if (!cols.some((c) => c.name === 'role_details')) {
      db.exec('ALTER TABLE bots ADD COLUMN role_details TEXT')
    }
    this.botsDb = db
    return db
  }

  listBots(): BotProfile[] {
    const rows = this.globalDb()
      .prepare('SELECT * FROM bots ORDER BY name COLLATE NOCASE')
      .all() as unknown as BotRow[]
    return rows.map(rowToBot)
  }

  getBot(id: string): BotProfile | null {
    const row = this.globalDb()
      .prepare('SELECT * FROM bots WHERE id = ?')
      .get(validateId(id)) as unknown as BotRow | undefined
    return row ? rowToBot(row) : null
  }

  saveBot(input: BotUpsertInput): BotProfile {
    const db = this.globalDb()
    const now = Date.now()
    const name = String(input.name ?? '').trim()
    if (!name) throw new Error('Bot name is required.')
    const role = String(input.role ?? '').trim()
    const roleDetails = String(input.roleDetails ?? '').trim() || null
    const persona = String(input.persona ?? '').trim()
    const profileId = input.profileId?.trim() || null
    const model = input.model?.trim() || null

    if (input.id) {
      const id = validateId(input.id)
      const existing = this.getBot(id)
      if (!existing) throw new Error(`Bot not found: ${id}`)
      db.prepare(
        `UPDATE bots SET name = ?, role = ?, role_details = ?, persona = ?, profile_id = ?, model = ?, updated_at = ? WHERE id = ?`
      ).run(name, role, roleDetails, persona, profileId, model, now, id)
      return this.getBot(id)!
    }
    const base = name
      .trim()
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    let id = base || `bot-${now}`
    let n = 2
    while (this.getBot(id)) {
      id = `${base}-${n++}`
    }
    db.prepare(
      `INSERT INTO bots (id, name, role, role_details, persona, profile_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, role, roleDetails, persona, profileId, model, now, now)
    return this.getBot(id)!
  }

  /** Delete a bot and remove it from every group roster (leader falls back to the first remaining member). */
  deleteBot(id: string): boolean {
    const db = this.globalDb()
    const clean = validateId(id)
    const info = db.prepare('DELETE FROM bots WHERE id = ?').run(clean)
    if (info.changes === 0) return false
    for (const [project, pdb] of this.projectDbs) {
      const groups = pdb.prepare('SELECT * FROM group_chats').all() as unknown as GroupRow[]
      for (const g of groups) {
        let botIds: string[] = []
        try {
          const parsed = JSON.parse(g.bot_ids) as unknown
          if (Array.isArray(parsed))
            botIds = parsed.filter((b): b is string => typeof b === 'string')
        } catch {
          botIds = []
        }
        if (!botIds.includes(clean)) continue
        const nextIds = botIds.filter((b) => b !== clean)
        const nextLeader = g.leader_bot_id === clean ? (nextIds[0] ?? '') : g.leader_bot_id
        pdb
          .prepare('UPDATE group_chats SET bot_ids = ?, leader_bot_id = ? WHERE group_id = ?')
          .run(JSON.stringify(nextIds), nextLeader, g.group_id)
        void project
      }
    }
    return true
  }

  // ---- per-project group chat DB ----

  private botsDir(project: string): string {
    return join(this.getRoot(), project, '.data', 'bots')
  }

  private projectDb(project: string): DatabaseSync {
    const existing = this.projectDbs.get(project)
    if (existing) return existing
    const dir = this.botsDir(project)
    mkdirSync(dir, { recursive: true })
    const db = new DatabaseSync(join(dir, 'groupchat.db'))
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec(`CREATE TABLE IF NOT EXISTS group_chats (
      group_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      bot_ids TEXT NOT NULL,
      leader_bot_id TEXT NOT NULL,
      summary TEXT,
      summarized_up_to_seq INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      sender_kind TEXT NOT NULL,
      bot_id TEXT,
      sender_name TEXT NOT NULL,
      role TEXT,
      is_leader INTEGER,
      content TEXT NOT NULL,
      ts INTEGER NOT NULL,
      error INTEGER,
      task_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_group_messages ON group_messages (group_id, seq);
    CREATE TABLE IF NOT EXISTS bot_memories (
      bot_id TEXT NOT NULL,
      id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (bot_id, id)
    );
    CREATE TABLE IF NOT EXISTS bot_task_queue (
      queue_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      run_id TEXT,
      title TEXT NOT NULL,
      task TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      origin_msg TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );`)
    const queueCols = db.prepare('PRAGMA table_info(bot_task_queue)').all() as unknown as {
      name: string
    }[]
    if (!queueCols.some((c) => c.name === 'origin_msg')) {
      db.exec('ALTER TABLE bot_task_queue ADD COLUMN origin_msg TEXT')
    }
    this.projectDbs.set(project, db)
    return db
  }

  private metaFromRow(project: string, r: GroupRow): GroupChatMeta {
    const countRow = this.projectDb(project)
      .prepare('SELECT COUNT(*) AS c FROM group_messages WHERE group_id = ?')
      .get(r.group_id) as unknown as { c: number }
    return rowToGroup(r, project, countRow.c)
  }

  listGroups(project: string): GroupChatMeta[] {
    this.reconcileRosters(project)
    const rows = this.projectDb(project)
      .prepare('SELECT * FROM group_chats ORDER BY updated_at DESC')
      .all() as unknown as GroupRow[]
    return rows.map((r) => this.metaFromRow(project, r))
  }

  /**
   * Drop roster ids of bots that no longer exist in the global library and fall a dead
   * leader back to the first remaining member. deleteBot can only scrub rosters of
   * project DBs that are open at that moment; this heals the rest on first view.
   */
  private reconcileRosters(project: string): void {
    const pdb = this.projectDb(project)
    const valid = new Set(
      (this.globalDb().prepare('SELECT id FROM bots').all() as unknown as { id: string }[]).map(
        (r) => r.id
      )
    )
    const groups = pdb.prepare('SELECT * FROM group_chats').all() as unknown as GroupRow[]
    for (const g of groups) {
      let botIds: string[] = []
      try {
        const parsed = JSON.parse(g.bot_ids) as unknown
        if (Array.isArray(parsed)) botIds = parsed.filter((b): b is string => typeof b === 'string')
      } catch {
        botIds = []
      }
      const nextIds = botIds.filter((b) => valid.has(b))
      const nextLeader = nextIds.includes(g.leader_bot_id) ? g.leader_bot_id : (nextIds[0] ?? '')
      if (nextIds.length === botIds.length && nextLeader === g.leader_bot_id) continue
      pdb
        .prepare('UPDATE group_chats SET bot_ids = ?, leader_bot_id = ? WHERE group_id = ?')
        .run(JSON.stringify(nextIds), nextLeader, g.group_id)
    }
  }

  createGroup(project: string, input: NewGroupInput): GroupChatMeta {
    const title = String(input.title ?? '').trim() || 'Group chat'
    const botIds = [...new Set((input.botIds ?? []).filter((b) => typeof b === 'string' && b))]
    if (botIds.length === 0) throw new Error('A group chat needs at least one bot.')
    if (botIds.length > MAX_GROUP_BOTS) {
      throw new Error(`A group chat can have at most ${MAX_GROUP_BOTS} bots.`)
    }
    const leaderBotId = input.leaderBotId?.trim()
    if (!leaderBotId || !botIds.includes(leaderBotId)) {
      throw new Error('The group leader must be one of the assigned bots.')
    }
    const now = Date.now()
    const groupId = randomUUID()
    this.projectDb(project)
      .prepare(
        `INSERT INTO group_chats (group_id, title, bot_ids, leader_bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(groupId, title, JSON.stringify(botIds), leaderBotId, now, now)
    return this.getGroup(project, groupId)!
  }

  getGroup(project: string, groupId: string): GroupChatMeta | null {
    const row = this.projectDb(project)
      .prepare('SELECT * FROM group_chats WHERE group_id = ?')
      .get(validateId(groupId)) as unknown as GroupRow | undefined
    return row ? this.metaFromRow(project, row) : null
  }

  updateGroup(project: string, groupId: string, patch: GroupPatch): GroupChatMeta {
    const current = this.getGroup(project, groupId)
    if (!current) throw new Error(`Group chat not found: ${groupId}`)
    const title =
      patch.title !== undefined ? String(patch.title).trim() || current.title : current.title
    let botIds = current.botIds
    if (patch.botIds !== undefined) {
      botIds = [...new Set(patch.botIds.filter((b) => typeof b === 'string' && b))]
      if (botIds.length === 0) throw new Error('A group chat needs at least one bot.')
      if (botIds.length > MAX_GROUP_BOTS) {
        throw new Error(`A group chat can have at most ${MAX_GROUP_BOTS} bots.`)
      }
    }
    let leaderBotId = current.leaderBotId
    if (patch.leaderBotId !== undefined) {
      leaderBotId = patch.leaderBotId
    }
    if (!leaderBotId || !botIds.includes(leaderBotId)) {
      throw new Error('The group leader must be one of the assigned bots.')
    }
    this.projectDb(project)
      .prepare(
        'UPDATE group_chats SET title = ?, bot_ids = ?, leader_bot_id = ?, updated_at = ? WHERE group_id = ?'
      )
      .run(title, JSON.stringify(botIds), leaderBotId, Date.now(), groupId)
    return this.getGroup(project, groupId)!
  }

  deleteGroup(project: string, groupId: string): boolean {
    const db = this.projectDb(project)
    const clean = validateId(groupId)
    const info = db.prepare('DELETE FROM group_chats WHERE group_id = ?').run(clean)
    db.prepare('DELETE FROM group_messages WHERE group_id = ?').run(clean)
    db.prepare('DELETE FROM bot_task_queue WHERE group_id = ?').run(clean)
    void fs.rm(join(this.botsDir(project), `${clean}.trace.jsonl`), { force: true }).catch(() => {})
    void fs.rm(join(this.botsDir(project), `${clean}.trace.json`), { force: true }).catch(() => {})
    return info.changes > 0
  }

  async clearGroupMessages(project: string, groupId: string): Promise<void> {
    const db = this.projectDb(project)
    const clean = validateId(groupId)
    db.prepare('DELETE FROM group_messages WHERE group_id = ?').run(clean)
    db.prepare('DELETE FROM bot_task_queue WHERE group_id = ?').run(clean)
    db.prepare(
      'UPDATE group_chats SET summary = NULL, summarized_up_to_seq = NULL, updated_at = ? WHERE group_id = ?'
    ).run(Date.now(), clean)
    await this.deleteGroupTrace(project, clean)
  }

  readGroup(project: string, groupId: string, opts?: GroupMessagePageOpts): GroupChatData | null {
    const meta = this.getGroup(project, groupId)
    if (!meta) return null
    const row = this.projectDb(project)
      .prepare('SELECT summary, summarized_up_to_seq FROM group_chats WHERE group_id = ?')
      .get(groupId) as unknown as { summary: string | null; summarized_up_to_seq: number | null }
    const base = {
      ...meta,
      ...(row.summary ? { summary: row.summary } : {}),
      ...(row.summarized_up_to_seq ? { summarizedUpToSeq: row.summarized_up_to_seq } : {})
    }
    const paged = opts && (opts.limit !== undefined || opts.beforeSeq !== undefined)
    if (!paged) {
      return { ...base, messages: this.listMessages(project, groupId) }
    }
    const page = this.listMessagePage(project, groupId, opts)
    return {
      ...base,
      messages: page.messages,
      hasMore: page.hasMore,
      oldestSeq: page.oldestSeq ?? undefined
    }
  }

  listMessages(project: string, groupId: string): GroupMessage[] {
    const rows = this.projectDb(project)
      .prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY seq ASC')
      .all(validateId(groupId)) as unknown as MessageRow[]
    return rows.map(rowToMessage)
  }

  private listMessagePage(
    project: string,
    groupId: string,
    opts: GroupMessagePageOpts
  ): { messages: GroupMessage[]; hasMore: boolean; oldestSeq: number | null } {
    const limit = Math.max(1, Math.floor(opts.limit ?? GROUP_CHAT_PAGE_SIZE))
    const where = ['group_id = ?']
    const params: (string | number)[] = [validateId(groupId)]
    if (opts.beforeSeq !== undefined) {
      where.push('seq < ?')
      params.push(opts.beforeSeq)
    }
    // Fetch one extra row to detect whether older messages remain (gap-safe, single query).
    const rows = this.projectDb(project)
      .prepare(
        `SELECT * FROM group_messages WHERE ${where.join(' AND ')} ORDER BY seq DESC LIMIT ?`
      )
      .all(...params, limit + 1) as unknown as MessageRow[]
    const hasMore = rows.length > limit
    const kept = (hasMore ? rows.slice(0, limit) : rows).reverse()
    const messages = kept.map(rowToMessage)
    return { messages, hasMore, oldestSeq: messages.length > 0 ? messages[0].seq : null }
  }

  appendMessage(
    project: string,
    groupId: string,
    msg: Omit<GroupMessage, 'id' | 'seq'> & { id?: string }
  ): GroupMessage {
    const db = this.projectDb(project)
    const row = db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM group_messages WHERE group_id = ?')
      .get(groupId) as unknown as { maxSeq: number }
    const full: GroupMessage = {
      id: msg.id ?? randomUUID(),
      seq: row.maxSeq + 1,
      senderKind: msg.senderKind,
      ...(msg.botId ? { botId: msg.botId } : {}),
      senderName: msg.senderName,
      ...(msg.role ? { role: msg.role } : {}),
      ...(msg.isLeader ? { isLeader: true } : {}),
      content: msg.content,
      ts: msg.ts,
      ...(msg.error ? { error: true } : {}),
      ...(msg.taskId ? { taskId: msg.taskId } : {})
    }
    db.prepare(
      `INSERT INTO group_messages (id, group_id, seq, sender_kind, bot_id, sender_name, role, is_leader, content, ts, error, task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      full.id,
      groupId,
      full.seq,
      full.senderKind,
      full.botId ?? null,
      full.senderName,
      full.role ?? null,
      full.isLeader ? 1 : null,
      full.content,
      full.ts,
      full.error ? 1 : null,
      full.taskId ?? null
    )
    db.prepare('UPDATE group_chats SET updated_at = ? WHERE group_id = ?').run(Date.now(), groupId)
    return full
  }

  setSummary(project: string, groupId: string, summary: string, upToSeq: number): void {
    this.projectDb(project)
      .prepare('UPDATE group_chats SET summary = ?, summarized_up_to_seq = ? WHERE group_id = ?')
      .run(summary, upToSeq, groupId)
  }

  // ---- bot memories (per project) ----

  listMemories(project: string, botId?: string): BotMemoryEntry[] {
    const db = this.projectDb(project)
    const rows = botId
      ? (db
          .prepare('SELECT * FROM bot_memories WHERE bot_id = ? ORDER BY created_at ASC, id ASC')
          .all(botId) as unknown as {
          id: string
          bot_id: string
          content: string
          created_at: number
        }[])
      : (db
          .prepare('SELECT * FROM bot_memories ORDER BY bot_id, created_at ASC, id ASC')
          .all() as unknown as {
          id: string
          bot_id: string
          content: string
          created_at: number
        }[])
    return rows.map((r) => ({
      id: r.id,
      botId: r.bot_id,
      content: r.content,
      createdAt: r.created_at
    }))
  }

  /** Replace a bot's memory with the merged (existing + fresh) fact list, capped. */
  saveMemories(project: string, botId: string, fresh: string[]): BotMemoryEntry[] {
    const db = this.projectDb(project)
    const existing = this.listMemories(project, botId).map((m) => m.content)
    const merged = mergeMemoryEntries(existing, fresh, MAX_MEMORY_ENTRIES)
    db.prepare('DELETE FROM bot_memories WHERE bot_id = ?').run(botId)
    const insert = db.prepare(
      'INSERT INTO bot_memories (bot_id, id, content, created_at) VALUES (?, ?, ?, ?)'
    )
    const now = Date.now()
    merged.forEach((content, i) => {
      insert.run(botId, `${now}-${i}`, content, now)
    })
    return this.listMemories(project, botId)
  }

  deleteMemory(project: string, botId: string, memoryId: string): boolean {
    const info = this.projectDb(project)
      .prepare('DELETE FROM bot_memories WHERE bot_id = ? AND id = ?')
      .run(botId, memoryId)
    return info.changes > 0
  }

  // ---- background task queue (single-flight per bot) ----

  enqueueTask(
    project: string,
    item: Omit<BotTaskQueueItem, 'queueId' | 'runId' | 'status' | 'createdAt'> & {
      queueId?: string
    }
  ): BotTaskQueueItem {
    const originMsg: string | null = item.originMsg ?? null
    const full: BotTaskQueueItem = {
      queueId: item.queueId ?? randomUUID(),
      groupId: item.groupId,
      botId: item.botId,
      title: item.title,
      task: item.task,
      requestedBy: item.requestedBy,
      originMsg,
      runId: null,
      status: 'queued',
      createdAt: Date.now()
    }
    this.projectDb(project)
      .prepare(
        `INSERT INTO bot_task_queue (queue_id, group_id, bot_id, run_id, title, task, requested_by, origin_msg, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        full.queueId,
        full.groupId,
        full.botId,
        null,
        full.title,
        full.task,
        full.requestedBy,
        originMsg,
        'queued',
        full.createdAt
      )
    return full
  }

  listQueue(project: string, groupId?: string): BotTaskQueueItem[] {
    const rows = groupId
      ? (this.projectDb(project)
          .prepare('SELECT * FROM bot_task_queue WHERE group_id = ? ORDER BY created_at ASC')
          .all(groupId) as unknown as QueueRow[])
      : (this.projectDb(project)
          .prepare('SELECT * FROM bot_task_queue ORDER BY created_at ASC')
          .all() as unknown as QueueRow[])
    return rows.map(rowToQueueItem)
  }

  /** Oldest still-queued task for a bot across the whole project (single-flight). */
  nextQueuedTask(project: string, botId: string): BotTaskQueueItem | null {
    const row = this.projectDb(project)
      .prepare(
        "SELECT * FROM bot_task_queue WHERE bot_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1"
      )
      .get(botId) as unknown as QueueRow | undefined
    return row ? rowToQueueItem(row) : null
  }

  setTaskRunning(project: string, queueId: string, runId: string): void {
    this.projectDb(project)
      .prepare("UPDATE bot_task_queue SET status = 'running', run_id = ? WHERE queue_id = ?")
      .run(runId, queueId)
  }

  finishTask(project: string, queueId: string): void {
    this.projectDb(project).prepare('DELETE FROM bot_task_queue WHERE queue_id = ?').run(queueId)
  }

  /**
   * Reconcile the queue on startup: any task left `running` (app crashed / quit mid-run)
   * is dropped — its run is already marked cancelled by the module manager's crash recovery.
   */
  reconcileQueue(project: string): void {
    this.projectDb(project).prepare("DELETE FROM bot_task_queue WHERE status = 'running'").run()
  }

  // ---- per-group AI trace (JSONL, append-only) ----

  private tracePath(project: string, groupId: string): string {
    return join(this.botsDir(project), `${validateId(groupId)}.trace.jsonl`)
  }

  async appendGroupTrace(
    project: string,
    groupId: string,
    header: unknown,
    lines: string[]
  ): Promise<void> {
    const dir = this.botsDir(project)
    await fs.mkdir(dir, { recursive: true })
    const path = this.tracePath(project, groupId)
    try {
      await fs.access(path)
    } catch {
      await fs.appendFile(path, `${JSON.stringify(header)}\n`, 'utf8')
    }
    if (lines.length > 0) {
      await fs.appendFile(path, `${lines.join('\n')}\n`, 'utf8')
    }
  }

  async groupTraceMeta(
    project: string,
    groupId: string
  ): Promise<{ count: number; hasSystem: boolean }> {
    let raw: string
    try {
      raw = await fs.readFile(this.tracePath(project, groupId), 'utf8')
    } catch {
      return { count: 0, hasSystem: false }
    }
    const lines = raw.split('\n').filter((l) => l.trim())
    let count = 0
    let hasSystem = false
    for (let i = 0; i < lines.length; i++) {
      if (i === 0 && lines[i].includes('"type":"header"')) continue
      count++
      try {
        const entry = JSON.parse(lines[i]) as { role?: string }
        if (entry.role === 'system') hasSystem = true
      } catch {
        // skip malformed line
      }
    }
    return { count, hasSystem }
  }

  async readGroupTrace(project: string, groupId: string): Promise<AiTraceFile | null> {
    let raw: string
    try {
      raw = await fs.readFile(this.tracePath(project, groupId), 'utf8')
    } catch {
      return null
    }
    const lines = raw.split('\n').filter((l) => l.trim())
    if (lines.length === 0) return null
    let header: Record<string, unknown> | null = null
    const entries: unknown[] = []
    for (let i = 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]) as Record<string, unknown>
        if (i === 0 && parsed.type === 'header') {
          header = parsed
          continue
        }
        entries.push(parsed)
      } catch {
        // skip malformed line
      }
    }
    if (!header) return null
    const last = entries[entries.length - 1] as { ts?: number } | undefined
    return {
      ...header,
      updatedAt: last?.ts ?? (header.startedAt as number),
      entries,
      path: this.tracePath(project, groupId)
    } as AiTraceFile
  }

  async deleteGroupTrace(project: string, groupId: string): Promise<void> {
    await fs.rm(this.tracePath(project, groupId), { force: true }).catch(() => {})
  }
}
