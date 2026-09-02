import Module from 'node:module'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { OpenAI } from 'openai'
import type {
  AIProviderConfig,
  AskAnswer,
  AskQuestion,
  ModuleEvent,
  ModuleRun
} from '../src/shared/types'
import type { AIConfigStore } from '../src/main/ai/config'
import type { BotProfile } from '../src/shared/bots'
import {
  MAX_BOT_TURNS_PER_MESSAGE,
  extractBotTags,
  formatAskTranscriptLine,
  formatGroupDateLabel,
  formatGroupTimestamp,
  linkifyBotMentions,
  MAX_GROUP_BOTS,
  mergeMemoryEntries,
  parseBotReply,
  parseGroupAsk,
  planTagTriggers,
  resolveKanbanCardNames,
  splitMentionSegments
} from '../src/shared/bots'

const ROOT = '/tmp/ptnotes-bots-test-root'
const PROJECT = 'Bot Lab'

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return {
      app: { getPath: () => join(ROOT, 'userdata'), getAppPath: () => ROOT },
      shell: { showItemInFolder: () => {} }
    }
  }
  return origLoad.call(this, request, parent, isMain)
}

await fs.rm(ROOT, { recursive: true, force: true })

let passed = 0
function ok(name: string): void {
  passed++
  console.log(`  ✔ ${name}`)
}

// ---- pure routing logic ----
{
  const known = ['alice', 'bob', 'carol']
  assert.deepEqual(extractBotTags('hey @bob and @BOB plus @alice!', known), ['bob', 'alice'])
  assert.deepEqual(extractBotTags('email bob@test and @unknownbot', known), [])
  assert.deepEqual(extractBotTags('foo@bar', ['bar']), [], 'no tag without boundary')
  ok('extractBotTags: matching, dedupe, boundaries')

  const parsed = parseBotReply(
    '<think>secret</think>On it!\n```assign\n{"title":"T1","task":"Do the thing"}\n```\n ping @carol',
    known
  )
  assert.equal(parsed.content, 'On it!\n\n ping @carol')
  assert.deepEqual(parsed.assigns, [{ title: 'T1', task: 'Do the thing' }])
  assert.deepEqual(parsed.tags, ['carol'])
  ok('parseBotReply: assign block + think strip + tags')

  const parsed2 = parseBotReply('Starting now.\nASSIGN: Deep research on X', known)
  assert.equal(parsed2.content, 'Starting now.')
  assert.equal(parsed2.assigns.length, 1)
  assert.equal(parsed2.assigns[0].task, 'Deep research on X')
  ok('parseBotReply: ASSIGN: line fallback')

  const free = planTagTriggers(['bob'], 'free', 1, 8)
  assert.equal(free.triggers.length, 1)
  assert.equal(free.triggers[0].tagPolicy, 'relay')
  assert.equal(free.relaysLeft, 1, 'free turns do not consume the relay budget')

  const relay = planTagTriggers(['carol'], 'relay', 1, 8)
  assert.equal(relay.triggers.length, 1)
  assert.equal(relay.triggers[0].tagPolicy, 'none')
  assert.equal(relay.relaysLeft, 0)
  const relay2 = planTagTriggers(['alice'], 'relay', 0, 8)
  assert.equal(relay2.triggers.length, 0, 'relay budget exhausted → no trigger')
  ok('planTagTriggers: relay budget consumed exactly once')

  assert.equal(planTagTriggers(['bob'], 'none', 5, 8).triggers.length, 0)
  assert.equal(planTagTriggers(['bob'], 'free', 1, 0).triggers.length, 0, 'turn cap respected')
  ok('planTagTriggers: none policy + cap')

  assert.equal(planTagTriggers(['bob'], 'free', 1, 8).capped, false, 'under cap → not capped')
  assert.equal(
    planTagTriggers(['bob', 'carol'], 'free', 1, 1).capped,
    true,
    'tags > turns → capped'
  )
  assert.equal(planTagTriggers(['bob'], 'free', 1, 0).capped, true, 'no turns left → capped')
  assert.equal(planTagTriggers(['bob'], 'none', 1, 0).capped, false, 'none policy never capped')
  assert.equal(
    planTagTriggers(['bob'], 'relay', 0, 0).capped,
    false,
    'relay budget takes precedence'
  )
  ok('planTagTriggers: capped flag')

  assert.match(
    formatGroupTimestamp(new Date(2026, 0, 5, 14, 30).getTime(), new Date(2026, 0, 5).getTime()),
    /14|02/
  )
  assert.notEqual(
    formatGroupTimestamp(new Date(2026, 0, 5, 14, 30).getTime(), new Date(2026, 1, 5).getTime()),
    formatGroupTimestamp(
      new Date(2026, 0, 5, 14, 30).getTime(),
      new Date(2026, 0, 5, 15, 0).getTime()
    )
  )
  ok('formatGroupTimestamp: same-day vs other-day')

  assert.equal(
    formatGroupDateLabel(new Date(2026, 0, 5, 14, 30).getTime(), new Date(2026, 0, 5).getTime()),
    'Today'
  )
  assert.equal(
    formatGroupDateLabel(new Date(2026, 0, 5, 23, 59).getTime(), new Date(2026, 0, 6).getTime()),
    'Yesterday'
  )
  assert.equal(
    formatGroupDateLabel(new Date(2026, 0, 4).getTime(), new Date(2026, 0, 6).getTime()),
    'Jan 4'
  )
  assert.equal(
    formatGroupDateLabel(new Date(2025, 11, 31).getTime(), new Date(2026, 0, 2).getTime()),
    'Dec 31 2025'
  )
  assert.match(
    formatGroupDateLabel(new Date(2026, 8, 1).getTime(), new Date(2027, 8, 1).getTime()),
    / 2026$/
  )
  ok('formatGroupDateLabel: today/yesterday/Mmm D/Mmm D YYYY')

  assert.deepEqual(mergeMemoryEntries(['a', 'b'], ['b', 'c', ' '], 50), ['a', 'b', 'c'])
  assert.equal(
    mergeMemoryEntries(
      [],
      Array.from({ length: 60 }, (_, i) => `m${i}`),
      50
    ).length,
    50
  )
  ok('mergeMemoryEntries: dedupe + cap')

  const mentionBots = [
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' }
  ]
  const segs = splitMentionSegments('ping @bob and @alice, not @ghost', mentionBots)
  assert.deepEqual(segs, [
    { type: 'text', text: 'ping ' },
    { type: 'mention', botId: 'bob', name: 'Bob' },
    { type: 'text', text: ' and ' },
    { type: 'mention', botId: 'alice', name: 'Alice' },
    { type: 'text', text: ', not @ghost' }
  ])
  assert.equal(splitMentionSegments('no mentions here', mentionBots).length, 1)
  ok('splitMentionSegments: known ids only, display names')

  const linked = linkifyBotMentions(
    'ask @bob to check\n```\n@alice in code\n```\nand @ALICE too',
    mentionBots
  )
  assert.ok(linked.includes('[@Bob](mention:bob)'), linked)
  assert.ok(linked.includes('[@Alice](mention:alice)'), linked)
  assert.ok(linked.includes('@alice in code'), 'fenced block untouched')
  assert.equal(linkifyBotMentions('plain text', mentionBots), 'plain text')
  const brackety = linkifyBotMentions('hi @bob', [{ id: 'bob', name: 'Bo[b]' }])
  assert.ok(brackety.includes('[@Bo\\[b\\]](mention:bob)'), brackety)
  ok('linkifyBotMentions: markdown links + fence + label escaping')

  const cards = [
    { id: '550e8400-e29b-41d4-a716-446655440000', title: 'Launch Plan' },
    { id: 'abc123', title: 'Do $& things' }
  ]
  assert.equal(
    resolveKanbanCardNames('check kanban:550e8400-e29b-41d4-a716-446655440000 today', cards),
    'check kanban:Launch Plan today'
  )
  assert.equal(
    resolveKanbanCardNames('kanban:550e8400-e29b-41d4-a716-446655440000 and kanban:abc123', cards),
    'kanban:Launch Plan and kanban:Do $& things'
  )
  assert.equal(resolveKanbanCardNames('kanban:ABC123', cards), 'kanban:Do $& things')
  assert.equal(resolveKanbanCardNames('kanban:unknown-id', cards), 'kanban:unknown-id')
  assert.equal(resolveKanbanCardNames('xkanban:abc123', cards), 'xkanban:abc123')
  assert.equal(resolveKanbanCardNames('no tokens', cards), 'no tokens')
  assert.equal(resolveKanbanCardNames('kanban:abc123', []), 'kanban:abc123')
  ok('resolveKanbanCardNames: id → kanban:<title>, unknowns untouched')

  // parseGroupAsk: valid / malformed / wrong shape
  const validAsk = JSON.stringify({
    questions: [{ id: 'q1', question: 'Proceed?' }],
    status: 'pending'
  })
  const validPayload = parseGroupAsk(validAsk)
  assert.equal(validPayload?.status, 'pending')
  assert.equal(validPayload?.questions.length, 1)
  assert.equal(validPayload?.answers, undefined)
  assert.equal(parseGroupAsk('not json'), null)
  assert.equal(parseGroupAsk(''), null)
  assert.equal(parseGroupAsk('{}'), null)
  assert.equal(parseGroupAsk('[]'), null)
  assert.equal(parseGroupAsk(JSON.stringify({ questions: [], status: 'pending' })), null)
  assert.equal(
    parseGroupAsk(JSON.stringify({ questions: [{ id: 'q', question: 'x' }], status: 'bogus' })),
    null
  )
  assert.equal(
    parseGroupAsk(
      JSON.stringify({
        questions: [{ id: 'q', question: 'x' }],
        status: 'pending',
        answers: 'nope'
      })
    ),
    null
  )
  ok('parseGroupAsk: valid / malformed / wrong shape')

  // formatAskTranscriptLine: pending / answered / cancelled
  const askMsgBase = {
    id: 'm-ask',
    seq: 1,
    senderKind: 'ask' as const,
    botId: 'bob',
    senderName: 'Bob',
    ts: 0
  }
  assert.match(
    formatAskTranscriptLine({ ...askMsgBase, content: validAsk }),
    /\[Bob\] asked the user a question \(waiting for the answer\)/
  )
  assert.match(
    formatAskTranscriptLine({
      ...askMsgBase,
      content: JSON.stringify({
        questions: [{ id: 'q1', question: 'Proceed?' }],
        status: 'answered',
        answers: [{ id: 'q1', answer: 'Yes, go ahead' }]
      })
    }),
    /user answer: Proceed\?: Yes, go ahead/
  )
  assert.match(
    formatAskTranscriptLine({
      ...askMsgBase,
      content: JSON.stringify({
        questions: [{ id: 'q1', question: 'Proceed?' }],
        status: 'cancelled'
      })
    }),
    /the user dismissed it/
  )
  ok('formatAskTranscriptLine: pending / answered / cancelled')
}

// ---- BotsStore (SQLite) ----
const { BotsStore } = await import('../src/main/bots/db')

const store = new BotsStore(() => join(ROOT, 'root'), join(ROOT, 'userdata'))
await fs.mkdir(join(ROOT, 'root', PROJECT, '.data'), { recursive: true })

let alice: BotProfile, bob: BotProfile
{
  alice = store.saveBot({
    name: 'Alice',
    role: 'Project Manager',
    persona: 'Keeps things on track'
  })
  assert.equal(alice.id, 'alice')
  bob = store.saveBot({ name: 'Alice' })
  assert.equal(bob.id, 'alice-2', 'id uniqueness suffix')
  await store.deleteBot(bob.id)
  bob = store.saveBot({ name: 'Bob', role: 'Researcher' })
  const carol = store.saveBot({ name: 'Carol', role: 'Writer' })
  assert.deepEqual(
    store.listBots().map((b) => b.id),
    ['alice', 'bob', 'carol']
  )
  ok('bots: slug ids + uniqueness + list')

  const group = store.createGroup(PROJECT, {
    title: 'Launch plan',
    botIds: [alice.id, bob.id, carol.id],
    leaderBotId: alice.id
  })
  assert.ok(group.groupId)
  assert.equal(group.messageCount, 0)
  assert.throws(() => store.createGroup(PROJECT, { title: 'x', botIds: [], leaderBotId: 'x' }))
  assert.throws(() =>
    store.createGroup(PROJECT, { title: 'x', botIds: ['alice'], leaderBotId: 'bob' })
  )
  ok('groups: create + validation')

  const overCap = Array.from({ length: MAX_GROUP_BOTS + 1 }, (_, i) => `cap-bot-${i}`)
  assert.throws(() =>
    store.createGroup(PROJECT, { title: 'x', botIds: overCap, leaderBotId: overCap[0] })
  )
  const atCap = store.createGroup(PROJECT, {
    title: 'At cap',
    botIds: overCap.slice(0, MAX_GROUP_BOTS),
    leaderBotId: overCap[0]
  })
  assert.equal(atCap.botIds.length, MAX_GROUP_BOTS)
  assert.throws(() =>
    store.updateGroup(PROJECT, atCap.groupId, { botIds: overCap, leaderBotId: overCap[0] })
  )
  assert.equal(store.updateGroup(PROJECT, atCap.groupId, { title: 'Renamed' }).title, 'Renamed')
  assert.equal(store.deleteGroup(PROJECT, atCap.groupId), true)
  ok(`groups: max ${MAX_GROUP_BOTS} bots on create + update`)

  const m1 = store.appendMessage(PROJECT, group.groupId, {
    senderKind: 'user',
    senderName: 'You',
    content: 'hello',
    ts: Date.now()
  })
  assert.equal(m1.seq, 1)
  const m2 = store.appendMessage(PROJECT, group.groupId, {
    senderKind: 'bot',
    botId: 'alice',
    senderName: 'Alice',
    content: 'hi',
    ts: Date.now()
  })
  assert.equal(m2.seq, 2)
  const read = store.readGroup(PROJECT, group.groupId)
  assert.equal(read?.messages.length, 2)
  assert.equal(read?.messageCount, 2)
  ok('messages: monotonic seq + read back')

  store.setSummary(PROJECT, group.groupId, 'Summary so far', 1)
  const withSummary = store.readGroup(PROJECT, group.groupId)
  assert.equal(withSummary?.summary, 'Summary so far')
  assert.equal(withSummary?.summarizedUpToSeq, 1)
  ok('summary persisted')

  const clearable = store.createGroup(PROJECT, {
    title: 'Clearable',
    botIds: ['alice'],
    leaderBotId: 'alice'
  })
  store.appendMessage(PROJECT, clearable.groupId, {
    senderKind: 'user',
    senderName: 'You',
    content: 'to be cleared',
    ts: Date.now()
  })
  store.setSummary(PROJECT, clearable.groupId, 'Stale summary', 1)
  await store.appendGroupTrace(
    PROJECT,
    clearable.groupId,
    { type: 'header', startedAt: Date.now() },
    [JSON.stringify({ role: 'user', ts: Date.now(), content: 'x' })]
  )
  assert.ok(await store.readGroupTrace(PROJECT, clearable.groupId))
  await store.clearGroupMessages(PROJECT, clearable.groupId)
  const cleared = store.readGroup(PROJECT, clearable.groupId)
  assert.equal(cleared?.messages.length, 0)
  assert.equal(cleared?.messageCount, 0)
  assert.equal(cleared?.summary, undefined)
  assert.equal(cleared?.summarizedUpToSeq, undefined)
  assert.equal(await store.readGroupTrace(PROJECT, clearable.groupId), null)
  assert.equal(
    store.appendMessage(PROJECT, clearable.groupId, {
      senderKind: 'user',
      senderName: 'You',
      content: 'fresh start',
      ts: Date.now()
    }).seq,
    1
  )
  ok('messages: clear history resets messages, summary, trace and seq')

  const mems = store.saveMemories(PROJECT, 'bob', ['User prefers tables', 'Deadline is Friday'])
  assert.equal(mems.length, 2)
  const merged = store.saveMemories(PROJECT, 'bob', ['Deadline is Friday', 'Budget approved'])
  assert.deepEqual(
    merged.map((m) => m.content),
    ['User prefers tables', 'Deadline is Friday', 'Budget approved']
  )
  assert.equal(store.listMemories(PROJECT).length, 3)
  assert.equal(store.deleteMemory(PROJECT, 'bob', merged[0].id), true)
  ok('memories: merge + delete')

  const item = store.enqueueTask(PROJECT, {
    groupId: group.groupId,
    botId: 'bob',
    title: 'T',
    task: 'Do T',
    requestedBy: 'You'
  })
  assert.equal(store.nextQueuedTask(PROJECT, 'bob')?.queueId, item.queueId)
  store.setTaskRunning(PROJECT, item.queueId, 'run-1')
  assert.equal(store.nextQueuedTask(PROJECT, 'bob'), null, 'running task is not next queued')
  store.finishTask(PROJECT, item.queueId)
  assert.equal(store.nextQueuedTask(PROJECT, 'bob'), null)
  ok('task queue: single-flight lifecycle')

  // second project DB stays separate
  await fs.mkdir(join(ROOT, 'root', 'Other'), { recursive: true })
  assert.deepEqual(store.listGroups('Other'), [])
  ok('projects isolated')

  // a deleted bot's roster id is healed on listGroups even when deleteBot couldn't scrub it
  {
    const ghost = store.saveBot({ name: 'Ghost' })
    const ghostGroup = store.createGroup(PROJECT, {
      title: 'Ghost roster',
      botIds: ['alice', ghost.id],
      leaderBotId: ghost.id
    })
    // A second store instance has no open project DBs, so deleteBot skips roster scrubbing.
    const store2 = new BotsStore(() => join(ROOT, 'root'), join(ROOT, 'userdata'))
    assert.equal(store2.deleteBot(ghost.id), true)
    store2.closeAll()
    assert.deepEqual(store.getGroup(PROJECT, ghostGroup.groupId)?.botIds, ['alice', ghost.id])
    const healed = store.listGroups(PROJECT).find((g) => g.groupId === ghostGroup.groupId)
    assert.deepEqual(healed?.botIds, ['alice'], 'ghost id pruned')
    assert.equal(healed?.leaderBotId, 'alice', 'leader falls back to first remaining member')
    ok('groups: deleted-bot roster ids reconciled on listGroups')
  }
}

// ---- message paging (windowed history) ----
{
  const g = store.createGroup(PROJECT, { title: 'Paged', botIds: ['alice'], leaderBotId: 'alice' })
  const TOTAL = 250
  for (let i = 1; i <= TOTAL; i++) {
    store.appendMessage(PROJECT, g.groupId, {
      senderKind: 'user',
      senderName: 'You',
      content: `msg-${i}`,
      ts: Date.now()
    })
  }
  const full = store.readGroup(PROJECT, g.groupId)
  assert.equal(full?.messages.length, TOTAL, 'no opts → full history')
  assert.equal(full?.hasMore, undefined, 'no opts → no paging fields')
  assert.equal(full?.oldestSeq, undefined)

  const page1 = store.readGroup(PROJECT, g.groupId, { limit: 100 })
  assert.equal(page1?.messages.length, 100)
  assert.deepEqual(
    page1?.messages.map((m) => m.seq),
    Array.from({ length: 100 }, (_, i) => TOTAL - 99 + i),
    'latest 100 in ASC order'
  )
  assert.equal(page1?.hasMore, true)
  assert.equal(page1?.oldestSeq, TOTAL - 99)
  assert.equal(page1?.messageCount, TOTAL, 'meta count stays the true total')

  const page2 = store.readGroup(PROJECT, g.groupId, { limit: 100, beforeSeq: page1!.oldestSeq! })
  assert.deepEqual(
    page2?.messages.map((m) => m.seq),
    Array.from({ length: 100 }, (_, i) => TOTAL - 199 + i)
  )
  assert.equal(page2?.hasMore, true)
  assert.equal(page2?.oldestSeq, TOTAL - 199)

  const page3 = store.readGroup(PROJECT, g.groupId, { limit: 100, beforeSeq: page2!.oldestSeq! })
  assert.equal(page3?.messages.length, 50)
  assert.deepEqual(
    page3?.messages.map((m) => m.seq),
    Array.from({ length: 50 }, (_, i) => i + 1)
  )
  assert.equal(page3?.hasMore, false)
  assert.equal(page3?.oldestSeq, 1)
  ok('messages: paged read (latest page, beforeSeq cursor, hasMore)')
}

// ---- ask messages (bot-task ask_user payloads) ----
{
  const g = store.createGroup(PROJECT, {
    title: 'Ask store',
    botIds: ['alice'],
    leaderBotId: 'alice'
  })
  const ask = (status: string, extra = {}): string =>
    JSON.stringify({
      questions: [{ id: 'q1', question: 'Proceed?' }],
      status,
      ...extra
    })
  const kept = store.appendMessage(PROJECT, g.groupId, {
    senderKind: 'ask',
    botId: 'alice',
    senderName: 'Alice',
    content: ask('pending'),
    ts: Date.now()
  })
  const stale = store.appendMessage(PROJECT, g.groupId, {
    senderKind: 'ask',
    botId: 'alice',
    senderName: 'Alice',
    content: ask('pending'),
    ts: Date.now()
  })
  const done = store.appendMessage(PROJECT, g.groupId, {
    senderKind: 'ask',
    botId: 'alice',
    senderName: 'Alice',
    content: ask('answered', { answers: [{ id: 'q1', answer: 'Yes' }] }),
    ts: Date.now()
  })
  const transitional = store.appendMessage(PROJECT, g.groupId, {
    senderKind: 'ask',
    botId: 'alice',
    senderName: 'Alice',
    content: ask('pending'),
    ts: Date.now()
  })

  // updateAskMessage transitions
  const answered = store.updateAskMessage(PROJECT, g.groupId, transitional.id, {
    status: 'answered',
    answers: [{ id: 'q1', answer: 'Blue' }]
  })
  assert.equal(parseGroupAsk(answered!.content)?.status, 'answered')
  assert.deepEqual(parseGroupAsk(answered!.content)?.answers, [{ id: 'q1', answer: 'Blue' }])
  const cancelledBack = store.updateAskMessage(PROJECT, g.groupId, transitional.id, {
    status: 'cancelled'
  })
  assert.equal(parseGroupAsk(cancelledBack!.content)?.status, 'cancelled')
  assert.equal(store.updateAskMessage(PROJECT, g.groupId, 'nope', { status: 'cancelled' }), null)
  const plain = store.appendMessage(PROJECT, g.groupId, {
    senderKind: 'bot',
    botId: 'alice',
    senderName: 'Alice',
    content: 'not an ask',
    ts: Date.now()
  })
  assert.equal(store.updateAskMessage(PROJECT, g.groupId, plain.id, { status: 'cancelled' }), null)
  ok('updateAskMessage: transitions + null for unknown/non-ask ids')

  // reconcileAsks cancels pending asks not in keepIds, keeps active/answered ones
  const updated = store.reconcileAsks(PROJECT, new Set([kept.id]))
  assert.deepEqual(
    updated.map((u) => u.message.id),
    [stale.id],
    'only the stale pending ask'
  )
  assert.equal(updated[0].groupId, g.groupId)
  assert.equal(parseGroupAsk(updated[0].message.content)?.status, 'cancelled')
  assert.equal(
    parseGroupAsk(store.getMessage(PROJECT, g.groupId, kept.id)!.content)?.status,
    'pending',
    'active ask kept'
  )
  assert.equal(
    parseGroupAsk(store.getMessage(PROJECT, g.groupId, done.id)!.content)?.status,
    'answered',
    'answered ask untouched'
  )
  assert.equal(
    parseGroupAsk(store.getMessage(PROJECT, g.groupId, transitional.id)!.content)?.status,
    'cancelled',
    'resolved ask untouched by reconcile'
  )
  ok('reconcileAsks: cancels pending asks not in keepIds')
}

// ---- GroupChatManager orchestration (fake AI) ----
const { GroupChatManager } = await import('../src/main/bots/orchestrator')

const configStore = {
  loadResolved: async (): Promise<AIProviderConfig> => ({
    baseUrl: 'http://127.0.0.1:9999/v1',
    apiKey: '',
    model: 'fake-model'
  }),
  load: async (): Promise<AIProviderConfig> => ({
    baseUrl: 'http://127.0.0.1:9999/v1',
    apiKey: '',
    model: 'fake-model'
  })
} as unknown as AIConfigStore

/** Fake client: replies are popped per-bot, matched from "Respond now as @id" ('_default' otherwise). */
function makeFakeClient(
  replies: Map<string, string[]>,
  calls?: { messages: { role: string; content: string }[] }[]
): (cfg: AIProviderConfig) => OpenAI {
  return () => {
    const client = {
      chat: {
        completions: {
          create: async (params: { messages: { role: string; content: string }[] }) => {
            calls?.push(params)
            const last = params.messages[params.messages.length - 1].content ?? ''
            const m = String(last).match(/Respond now as @([a-z0-9-]+)/)
            const id = m?.[1] ?? '_default'
            const queue = replies.get(id) ?? []
            const content = queue.length > 0 ? (queue.shift() as string) : '(no scripted reply)'
            return { choices: [{ message: { content } }] }
          }
        }
      }
    }
    return client as unknown as OpenAI
  }
}

interface StartCall {
  botId?: string
  title: string
  prompt: string
  expect?: string
}

function makeStubModuleManager(startCalls: StartCall[]): {
  start: (
    project: string,
    moduleId: string,
    title: string,
    prompt: string,
    expect?: string,
    opts?: { botId?: string }
  ) => Promise<{
    ok: true
    runId: string
    module: { id: string; name: string; description: string }
    title: string
  }>
} {
  return {
    start: async (
      _project: string,
      _moduleId: string,
      title: string,
      prompt: string,
      expect?: string,
      opts?: { botId?: string }
    ) => {
      startCalls.push({ title, prompt, expect, botId: opts?.botId })
      return {
        ok: true as const,
        runId: `run-${startCalls.length}`,
        module: { id: 'bot-task', name: 'Bot Task', description: '' },
        title
      }
    }
  } as never
}

const group = store.createGroup(PROJECT, {
  title: 'Orchestration',
  botIds: ['alice', 'bob'],
  leaderBotId: 'alice'
})

// A: untagged message → leader acts → leader tags bob → bob assigns a task
{
  const startCalls: StartCall[] = []
  const m2 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeStubModuleManager(startCalls),
    broadcast: () => {},
    clientFactory: makeFakeClient(
      new Map([
        ['alice', ['I will hand this to @bob for the analysis.']],
        [
          'bob',
          [
            'On it.\n```assign\n{"title":"Market analysis","task":"Research the market for note:<name>"}\n```'
          ]
        ]
      ])
    )
  })
  await m2.send(PROJECT, group.groupId, 'Prepare a market analysis')
  const messages = store.listMessages(PROJECT, group.groupId)
  const names = messages.map((m) => `${m.senderKind}:${m.botId ?? m.senderName}`)
  assert.ok(names.includes('user:You'))
  assert.ok(names.includes('bot:alice'), 'leader responded')
  assert.ok(names.includes('bot:bob'), 'tagged bot responded')
  const sysMsgs = messages.filter((m) => m.senderKind === 'system')
  assert.ok(
    sysMsgs.some((m) => m.content.includes('started background task “Market analysis”')),
    JSON.stringify(sysMsgs)
  )
  assert.equal(startCalls.length, 1)
  assert.equal(startCalls[0].botId, 'bob')
  assert.equal(startCalls[0].title, 'Market analysis')
  assert.equal(
    startCalls[0].expect,
    'A concise report: what you did, the outcome, and the paths of any notes/files/cards you created.'
  )
  const bobMsg = messages.find((m) => m.senderKind === 'bot' && m.botId === 'bob')
  assert.ok(bobMsg && !bobMsg.content.includes('```'), 'assign block stripped from chat')
  const queueItem = store.listQueue(PROJECT).find((q) => q.title === 'Market analysis')
  assert.ok(queueItem, 'queue item created for bob')
  assert.equal(queueItem.originMsg, 'On it.', 'pre-task chat message stored as originMsg')
  store.finishTask(PROJECT, queueItem.queueId)
  ok('orchestration: leader → tag → assign → task started')
}

// B: user tags bob directly; bob relays to alice (budget=1); alice's tag must NOT trigger
{
  const startCalls: StartCall[] = []
  const m3 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeStubModuleManager(startCalls),
    broadcast: () => {},
    clientFactory: makeFakeClient(
      new Map([
        ['bob', ['Checking with @alice first.']],
        ['alice', ['Sure, ping @bob to continue.']]
      ])
    )
  })
  await m3.send(PROJECT, group.groupId, '@bob what do you think?')
  const messages = store.listMessages(PROJECT, group.groupId)
  const before = messages.findIndex(
    (m) => m.senderKind === 'user' && m.content.includes('what do you think')
  )
  const botTurns = messages.slice(before).filter((m) => m.senderKind === 'bot')
  assert.deepEqual(
    botTurns.map((m) => m.botId),
    ['bob', 'alice'],
    `bob then alice, no loop: ${JSON.stringify(botTurns.map((m) => m.botId))}`
  )
  ok('orchestration: user-tagged bot relays once, loop stopped')
}

// C: single-flight — busy bot queues the new assignment
{
  const startCalls: StartCall[] = [{ botId: 'bob', title: 'First', prompt: 'p' }]
  // simulate a running task for bob
  const item = store.enqueueTask(PROJECT, {
    groupId: group.groupId,
    botId: 'bob',
    title: 'First',
    task: 'First task',
    requestedBy: 'You'
  })
  store.setTaskRunning(PROJECT, item.queueId, 'run-busy')
  const m4 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeStubModuleManager(startCalls),
    broadcast: () => {},
    clientFactory: makeFakeClient(
      new Map([
        [
          'bob',
          ['Starting the second one too.\n```assign\n{"title":"Second task","task":"p2"}\n```']
        ]
      ])
    )
  })
  await m4.send(PROJECT, group.groupId, '@bob one more thing')
  const messages = store.listMessages(PROJECT, group.groupId)
  assert.ok(
    messages.some(
      (m) => m.senderKind === 'system' && m.content.includes('queued task “Second task”')
    ),
    'queued system message shown'
  )
  const after = store.listQueue(PROJECT).filter((q) => q.botId === 'bob')
  assert.equal(after.filter((q) => q.status === 'queued').length, 1, 'one queued item remains')
  const queuedRow = after.find((q) => q.status === 'queued')!
  assert.equal(queuedRow.originMsg, 'Starting the second one too.')
  // the running task finishes → the queued task starts on the SAME queue row (no duplicate row)
  m4.handleModuleEvent({
    runId: 'run-busy',
    project: PROJECT,
    type: 'done',
    run: {
      runId: 'run-busy',
      module: { id: 'bot-task', name: 'Bot Task', description: '' },
      project: PROJECT,
      title: 'First',
      prompt: 'p',
      status: 'done',
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      botId: 'bob',
      groupId: group.groupId,
      result: 'ok'
    }
  } as ModuleEvent)
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(startCalls.length, 2, 'queued task started after the running one finished')
  assert.equal(startCalls[1].title, 'Second task')
  const drained = store.listQueue(PROJECT).filter((q) => q.botId === 'bob')
  assert.equal(drained.length, 1, 'queue row reused — no duplicate row created')
  assert.equal(drained[0].queueId, queuedRow.queueId)
  assert.equal(drained[0].status, 'running')
  // cleanup the queue rows for later tests
  for (const q of drained) store.finishTask(PROJECT, q.queueId)
  ok('orchestration: single-flight queue')
}

// D: task completion report
{
  bob = store.saveBot({
    id: bob.id,
    name: 'Bob',
    role: 'Researcher',
    persona: 'Be friendly and precise'
  })
  const reportItem = store.enqueueTask(PROJECT, {
    groupId: group.groupId,
    botId: 'bob',
    title: 'Market analysis',
    task: 'Research the market for note:<name>',
    requestedBy: 'You',
    originMsg: 'On it, researching now.'
  })
  store.setTaskRunning(PROJECT, reportItem.queueId, 'run-report-1')
  const run: ModuleRun = {
    runId: 'run-report-1',
    module: { id: 'bot-task', name: 'Bot Task', description: '' },
    project: PROJECT,
    title: 'Market analysis',
    prompt: 'p',
    status: 'done',
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    botId: 'bob',
    groupId: group.groupId,
    result: 'Analysis done: created note:market.md'
  }
  const calls: { messages: { role: string; content: string }[] }[] = []
  const m5 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeStubModuleManager([]),
    broadcast: () => {},
    clientFactory: makeFakeClient(
      new Map([['_default', ['Done! The analysis is in note:market.md.']]]),
      calls
    )
  })
  m5.handleModuleEvent({
    runId: run.runId,
    project: PROJECT,
    type: 'done',
    run
  } as ModuleEvent)
  // wait for the async report to land
  await new Promise((r) => setTimeout(r, 300))
  const messages = store.listMessages(PROJECT, group.groupId)
  const report = messages.filter((m) => m.senderKind === 'bot' && m.botId === 'bob').at(-1)
  assert.ok(report && report.content.includes('note:market.md'), 'bot posted the report')
  assert.equal(report?.taskId, 'run-report-1')
  const reportCall = calls.at(-1)!
  const sys = reportCall.messages.find((m) => m.role === 'system')!.content
  const user = reportCall.messages.find((m) => m.role === 'user')!.content
  assert.ok(sys.includes('Be friendly and precise'), 'persona included in report prompt')
  assert.ok(user.includes('On it, researching now.'), 'pre-task message included for language')
  assert.ok(
    user.includes('Your last message to the group before starting this task'),
    'last-message reference labelled'
  )
  ok('orchestration: task completion report')
}

// E: stop cancels orchestration without crashing
{
  const m6 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeStubModuleManager([]),
    broadcast: () => {},
    clientFactory: makeFakeClient(new Map([['alice', ['Working on it.']]]))
  })
  const pending = m6.send(PROJECT, group.groupId, 'slow one')
  m6.stop(PROJECT, group.groupId)
  await pending
  ok('orchestration: stop resolves')
}

// F: group trace file written
{
  const trace = await store.readGroupTrace(PROJECT, group.groupId)
  assert.ok(trace, 'trace exists')
  const entries = (trace as { entries: { role?: string; content?: string }[] }).entries
  assert.ok(entries.length > 0, 'trace has entries')
  const sysContents = entries.filter((e) => e.role === 'system').map((e) => e.content ?? '')
  assert.ok(
    sysContents.some((c) => c.includes('You are Alice')),
    'leader system prompt traced'
  )
  assert.ok(
    sysContents.some((c) => c.includes('You are Bob')),
    'member system prompt traced'
  )
  assert.ok(
    entries.some((e) => e.role === 'assistant' && e.content?.includes('note:market.md')),
    'task report turn traced'
  )
  ok('trace: JSONL written (system + assistant)')
}

// F2: clear history drops the group's task queue, cancels live runs, suppresses reports
{
  store.appendMessage(PROJECT, group.groupId, {
    senderKind: 'user',
    senderName: 'You',
    content: 'history to clear',
    ts: Date.now()
  })
  const runningItem = store.enqueueTask(PROJECT, {
    groupId: group.groupId,
    botId: 'bob',
    title: 'Live task',
    task: 'p',
    requestedBy: 'You'
  })
  store.setTaskRunning(PROJECT, runningItem.queueId, 'run-clear-1')
  store.enqueueTask(PROJECT, {
    groupId: group.groupId,
    botId: 'bob',
    title: 'Waiting task',
    task: 'p',
    requestedBy: 'You'
  })
  const liveRun: ModuleRun = {
    runId: 'run-clear-1',
    module: { id: 'bot-task', name: 'Bot Task', description: '' },
    project: PROJECT,
    title: 'Live task',
    prompt: 'p',
    status: 'running',
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    botId: 'bob',
    groupId: group.groupId
  }
  const stopped: string[] = []
  const m7 = new GroupChatManager({
    store,
    configStore,
    moduleManager: {
      start: async () => ({
        ok: true as const,
        runId: 'run-x',
        module: { id: 'bot-task', name: 'Bot Task', description: '' },
        title: 'x'
      }),
      list: async () => [liveRun],
      stop: (runId: string) => stopped.push(runId)
    } as never,
    broadcast: () => {},
    clientFactory: makeFakeClient(new Map())
  })
  await m7.clearGroupHistory(PROJECT, group.groupId)
  assert.deepEqual(stopped, ['run-clear-1'], 'live bot-task run cancelled')
  assert.equal(
    store.listQueue(PROJECT).filter((q) => q.groupId === group.groupId).length,
    0,
    'task queue rows cleared'
  )
  assert.equal(store.listMessages(PROJECT, group.groupId).length, 0, 'messages cleared')
  assert.equal(await store.readGroupTrace(PROJECT, group.groupId), null, 'trace cleared')
  // the cancelled run's terminal event arrives later — its report must be suppressed
  m7.handleModuleEvent({
    runId: 'run-clear-1',
    project: PROJECT,
    type: 'status',
    run: { ...liveRun, status: 'cancelled' }
  } as ModuleEvent)
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(store.listMessages(PROJECT, group.groupId).length, 0, 'no report posted after clear')
  ok('orchestration: clear history drops queue + suppresses reports')
}

// G: group delete removes messages
{
  const g2 = store.createGroup(PROJECT, { title: 'Temp', botIds: ['alice'], leaderBotId: 'alice' })
  store.appendMessage(PROJECT, g2.groupId, {
    senderKind: 'user',
    senderName: 'You',
    content: 'x',
    ts: Date.now()
  })
  assert.equal(store.deleteGroup(PROJECT, g2.groupId), true)
  assert.equal(store.readGroup(PROJECT, g2.groupId), null)
  assert.equal(store.listMessages(PROJECT, g2.groupId).length, 0)
  ok('groups: delete cascades')
}

// H: turn cap — exactly MAX_BOT_TURNS_PER_MESSAGE turns run, then a notice is posted
{
  const lead = store.saveBot({ name: 'Cap Lead' })
  const memberIds: string[] = []
  for (let i = 0; i < 18; i++) memberIds.push(store.saveBot({ name: `Cap ${i}` }).id)
  // The product caps groups at MAX_GROUP_BOTS; the turn cap is a deeper loop guard, so
  // seed an oversized group directly in the DB to exercise it.
  const capGroupId = 'turn-cap-group'
  const rawDb = new DatabaseSync(join(ROOT, 'root', PROJECT, '.data', 'bots', 'groupchat.db'))
  rawDb
    .prepare(
      `INSERT INTO group_chats (group_id, title, bot_ids, leader_bot_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      capGroupId,
      'Cap',
      JSON.stringify([lead.id, ...memberIds]),
      lead.id,
      Date.now(),
      Date.now()
    )
  rawDb.close()
  const leaderTags = memberIds.map((id) => `@${id}`).join(' ')
  const replies = new Map<string, string[]>()
  replies.set(lead.id, [leaderTags])
  for (const id of memberIds) replies.set(id, ['ok'])
  const m7 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeStubModuleManager([]),
    broadcast: () => {},
    clientFactory: makeFakeClient(replies)
  })
  await m7.send(PROJECT, capGroupId, 'go')
  const messages = store.listMessages(PROJECT, capGroupId)
  const botTurns = messages.filter((m) => m.senderKind === 'bot')
  assert.equal(
    botTurns.length,
    MAX_BOT_TURNS_PER_MESSAGE,
    `exactly ${MAX_BOT_TURNS_PER_MESSAGE} turns run: ${botTurns.length}`
  )
  assert.ok(
    messages.some((m) => m.senderKind === 'system' && m.content.includes('bot turns')),
    'turn-cap notice posted'
  )
  ok('orchestration: turn cap notice')
}

// ---- ask_user bridge (bot tasks) ----

interface AskFn {
  (
    run: ModuleRun,
    req: { project: string; questions: AskQuestion[]; kind?: 'confirm' }
  ): Promise<{ answers: AskAnswer[]; cancelled?: boolean }>
}

/** Module-manager stub whose `start` fires the orchestrator's ask bridge and stores the promise. */
function makeAskModuleManager(
  startCalls: StartCall[],
  asks: { runId: string; promise: Promise<{ answers: AskAnswer[]; cancelled?: boolean }> }[],
  req: { project: string; questions: AskQuestion[]; kind?: 'confirm' }
): never {
  return {
    start: async (
      _project: string,
      _moduleId: string,
      title: string,
      prompt: string,
      expect?: string,
      opts?: { botId?: string; ask?: AskFn }
    ) => {
      startCalls.push({ title, prompt, expect, botId: opts?.botId })
      if (opts?.ask) {
        const runId = `run-ask-${asks.length + 1}`
        const fakeRun: ModuleRun = {
          runId,
          module: { id: 'bot-task', name: 'Bob Task', description: '' },
          project: PROJECT,
          title,
          prompt,
          status: 'running',
          steps: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          botId: opts.botId,
          groupId: group.groupId
        }
        const promise = opts.ask(fakeRun, req)
        promise.catch(() => {}) // rejections are asserted explicitly; never unhandled
        asks.push({ runId, promise })
      }
      return {
        ok: true as const,
        runId: `run-ask-${asks.length}`,
        module: { id: 'bot-task', name: 'Bot Task', description: '' },
        title
      }
    },
    list: async () => [],
    stop: () => {}
  } as never
}

const assignReply = 'I need details.\n```assign\n{"title":"Ask task","task":"p"}\n```'

// I: ask bridge — question + interactive ask message posted, resolveBotAsk unblocks the run
{
  const startCalls: StartCall[] = []
  const asks: { runId: string; promise: Promise<{ answers: AskAnswer[]; cancelled?: boolean }> }[] =
    []
  const m8 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeAskModuleManager(startCalls, asks, {
      project: PROJECT,
      questions: [{ id: 'color', question: 'Pick a color', options: ['Red', 'Blue'] }]
    }),
    broadcast: () => {},
    clientFactory: makeFakeClient(new Map([['alice', [assignReply]]]))
  })
  await m8.send(PROJECT, group.groupId, 'Do the ask task')
  const messages = store.listMessages(PROJECT, group.groupId)
  const askMsg = [...messages].reverse().find((m) => m.senderKind === 'ask')
  assert.ok(askMsg, 'interactive ask message posted')
  assert.equal(askMsg.botId, 'alice', 'ask attributed to the task owner bot')
  assert.equal(askMsg.taskId, asks[0].runId, 'ask message references the run')
  const payload = parseGroupAsk(askMsg.content)
  assert.equal(payload?.status, 'pending')
  assert.deepEqual(
    payload?.questions.map((q) => q.id),
    ['color']
  )
  const qMsg = messages.find(
    (m) => m.senderKind === 'bot' && m.content.includes('I need your input to continue')
  )
  assert.ok(qMsg, 'question text posted as a bot message')
  assert.equal(
    m8.resolveBotAsk(PROJECT, group.groupId, 'unknown-id', [], false),
    false,
    'unknown ask id → false'
  )
  assert.equal(
    m8.resolveBotAsk(PROJECT, group.groupId, askMsg.id, [{ id: 'color', answer: 'Blue' }], false),
    true
  )
  assert.deepEqual(await asks[0].promise, { answers: [{ id: 'color', answer: 'Blue' }] })
  const stored = store.getMessage(PROJECT, group.groupId, askMsg.id)
  assert.equal(parseGroupAsk(stored!.content)?.status, 'answered')
  assert.deepEqual(parseGroupAsk(stored!.content)?.answers, [{ id: 'color', answer: 'Blue' }])
  assert.equal(
    m8.resolveBotAsk(PROJECT, group.groupId, askMsg.id, [], false),
    false,
    'double resolve → false'
  )
  ok('orchestration: ask_user surfaces in chat + resolveBotAsk unblocks the run')
}

// J: secret questions rejected up-front (no message posted, immediate error)
{
  const startCalls: StartCall[] = []
  const asks: { runId: string; promise: Promise<{ answers: AskAnswer[]; cancelled?: boolean }> }[] =
    []
  // drain leftover running tasks so the single-flight check lets alice start a new one
  for (const q of store.listQueue(PROJECT)) {
    if (q.botId === 'alice') store.finishTask(PROJECT, q.queueId)
  }
  const g = store.createGroup(PROJECT, {
    title: 'Ask secret',
    botIds: ['alice'],
    leaderBotId: 'alice'
  })
  const m9 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeAskModuleManager(startCalls, asks, {
      project: PROJECT,
      questions: [{ id: 'pw', question: 'Type the password', secret: true }]
    }),
    broadcast: () => {},
    clientFactory: makeFakeClient(new Map([['alice', [assignReply]]]))
  })
  await m9.send(PROJECT, g.groupId, 'go')
  assert.equal(asks.length, 1, 'the stub fired the ask bridge')
  await assert.rejects(asks[0].promise, /secret/i)
  const askMsgs = store.listMessages(PROJECT, g.groupId).filter((m) => m.senderKind === 'ask')
  assert.equal(askMsgs.length, 0, 'no ask message posted for a secret ask')
  ok('orchestration: secret questions rejected up-front')
}

// K: clearGroupHistory cancels a pending ask
{
  const startCalls: StartCall[] = []
  const asks: { runId: string; promise: Promise<{ answers: AskAnswer[]; cancelled?: boolean }> }[] =
    []
  // drain leftover running tasks so the single-flight check lets alice start a new one
  for (const q of store.listQueue(PROJECT)) {
    if (q.botId === 'alice') store.finishTask(PROJECT, q.queueId)
  }
  const g = store.createGroup(PROJECT, {
    title: 'Ask clear',
    botIds: ['alice'],
    leaderBotId: 'alice'
  })
  const m10 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeAskModuleManager(startCalls, asks, {
      project: PROJECT,
      questions: [{ id: 'q1', question: 'Proceed?' }]
    }),
    broadcast: () => {},
    clientFactory: makeFakeClient(new Map([['alice', [assignReply]]]))
  })
  await m10.send(PROJECT, g.groupId, 'go')
  assert.equal(asks.length, 1)
  await m10.clearGroupHistory(PROJECT, g.groupId)
  assert.deepEqual(await asks[0].promise, { answers: [], cancelled: true })
  assert.equal(store.listMessages(PROJECT, g.groupId).length, 0, 'messages cleared')
  ok('orchestration: clear history cancels a pending ask')
}

// L: closeAll cancels pending asks and marks the message cancelled
{
  const startCalls: StartCall[] = []
  const asks: { runId: string; promise: Promise<{ answers: AskAnswer[]; cancelled?: boolean }> }[] =
    []
  // drain leftover running tasks so the single-flight check lets alice start a new one
  for (const q of store.listQueue(PROJECT)) {
    if (q.botId === 'alice') store.finishTask(PROJECT, q.queueId)
  }
  const g = store.createGroup(PROJECT, {
    title: 'Ask close',
    botIds: ['alice'],
    leaderBotId: 'alice'
  })
  const m11 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeAskModuleManager(startCalls, asks, {
      project: PROJECT,
      questions: [{ id: 'q1', question: 'Proceed?' }]
    }),
    broadcast: () => {},
    clientFactory: makeFakeClient(new Map([['alice', [assignReply]]]))
  })
  await m11.send(PROJECT, g.groupId, 'go')
  const askMsg = store.listMessages(PROJECT, g.groupId).find((m) => m.senderKind === 'ask')
  assert.ok(askMsg)
  m11.closeAll()
  assert.deepEqual(await asks[0].promise, { answers: [], cancelled: true })
  const stored = store.getMessage(PROJECT, g.groupId, askMsg.id)
  assert.equal(parseGroupAsk(stored!.content)?.status, 'cancelled', 'message marked cancelled')
  ok('orchestration: closeAll cancels pending asks')
}

// M: delete confirmations ride the ask bridge with a distinct prefix
{
  const startCalls: StartCall[] = []
  const asks: { runId: string; promise: Promise<{ answers: AskAnswer[]; cancelled?: boolean }> }[] =
    []
  // drain leftover running tasks so the single-flight check lets alice start a new one
  for (const q of store.listQueue(PROJECT)) {
    if (q.botId === 'alice') store.finishTask(PROJECT, q.queueId)
  }
  const g = store.createGroup(PROJECT, {
    title: 'Ask confirm',
    botIds: ['alice'],
    leaderBotId: 'alice'
  })
  const m12 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeAskModuleManager(startCalls, asks, {
      project: PROJECT,
      kind: 'confirm',
      questions: [
        {
          id: 'confirm',
          question: 'Delete kanban card "Deploy Docs" from "P"?',
          options: ['Yes', 'No']
        }
      ]
    }),
    broadcast: () => {},
    clientFactory: makeFakeClient(new Map([['alice', [assignReply]]]))
  })
  await m12.send(PROJECT, g.groupId, 'go')
  assert.equal(asks.length, 1, 'the stub fired the ask bridge for the confirm')
  const messages = store.listMessages(PROJECT, g.groupId)
  const qMsg = messages.find(
    (m) => m.senderKind === 'bot' && m.content.includes('Please confirm to continue')
  )
  assert.ok(qMsg, 'confirm prompt posted with the confirm prefix')
  assert.ok(
    !messages.some(
      (m) => m.senderKind === 'bot' && m.content.includes('I need your input to continue')
    ),
    'plain ask prefix not used for confirmations'
  )
  const askMsg = messages.find((m) => m.senderKind === 'ask')
  assert.ok(askMsg, 'interactive ask message posted')
  const payload = parseGroupAsk(askMsg!.content)
  assert.equal(payload?.status, 'pending')
  assert.deepEqual(payload?.questions[0]?.options, ['Yes', 'No'])
  assert.equal(
    m12.resolveBotAsk(PROJECT, g.groupId, askMsg!.id, [{ id: 'confirm', answer: 'Yes' }], false),
    true
  )
  assert.deepEqual(await asks[0].promise, { answers: [{ id: 'confirm', answer: 'Yes' }] })
  ok('orchestration: confirm-kind ask uses the confirm prefix + resolves like asks')
}

console.log(`\nbots tests passed (${passed} groups)`)
