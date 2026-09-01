import Module from 'node:module'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { OpenAI } from 'openai'
import type { AIProviderConfig, ModuleEvent, ModuleRun } from '../src/shared/types'
import type { AIConfigStore } from '../src/main/ai/config'
import type { BotProfile } from '../src/shared/bots'
import {
  extractBotTags,
  formatGroupDateLabel,
  formatGroupTimestamp,
  linkifyBotMentions,
  mergeMemoryEntries,
  parseBotReply,
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
function makeFakeClient(replies: Map<string, string[]>): (cfg: AIProviderConfig) => OpenAI {
  return () => {
    const client = {
      chat: {
        completions: {
          create: async (params: { messages: { role: string; content: string }[] }) => {
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
  // cleanup the queue rows for later tests
  for (const q of after) store.finishTask(PROJECT, q.queueId)
  ok('orchestration: single-flight queue')
}

// D: task completion report
{
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
  const m5 = new GroupChatManager({
    store,
    configStore,
    moduleManager: makeStubModuleManager([]),
    broadcast: () => {},
    clientFactory: makeFakeClient(
      new Map([['_default', ['Done! The analysis is in note:market.md.']]])
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
  const entries = (trace as { entries: unknown[] }).entries
  assert.ok(entries.length > 0, 'trace has entries')
  ok('trace: JSONL written')
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

console.log(`\nbots tests passed (${passed} groups)`)
