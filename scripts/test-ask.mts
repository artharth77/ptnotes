import Module from 'node:module'
import assert from 'node:assert/strict'
import type { AskQuestion } from '../src/shared/types'

const ROOT = '/tmp/ptnotes-ask-test-root'

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return { app: { getPath: () => ROOT } }
  }
  return origLoad.call(this, request, parent, isMain)
}

// ---- ask_user tool (main process) ----

const { tools } = await import('../src/main/ai/tools')
import type { ToolContext } from '../src/main/ai/tools'

const askTool = tools.find((t) => t.definition.function.name === 'ask_user')
assert.ok(askTool, 'ask_user tool exists')

const baseCtx: ToolContext = {
  service: {} as ToolContext['service'],
  activeProject: 'Research',
  confirm: async () => true
}

const callAsk = async (
  args: Record<string, unknown>,
  ask?: ToolContext['ask']
): Promise<unknown> => {
  const res = await askTool.execute(args, { ...baseCtx, ask })
  return JSON.parse(res)
}

// validation failures
let r = await callAsk({}, async () => ({ answers: [] }))
assert.equal(r.ok, false, 'no questions → error')
r = await callAsk({ questions: [] }, async () => ({ answers: [] }))
assert.equal(r.ok, false, 'empty questions → error')
r = await callAsk(
  { questions: Array.from({ length: 9 }, (_, i) => ({ id: `q${i}`, question: `Q${i}` })) },
  async () => ({ answers: [] })
)
assert.equal(r.ok, false, '9 questions → error')
r = await callAsk({ questions: [{ id: '', question: 'Hi' }] }, async () => ({ answers: [] }))
assert.equal(r.ok, false, 'empty id → error')
r = await callAsk({ questions: [{ id: 'q1', question: '   ' }] }, async () => ({ answers: [] }))
assert.equal(r.ok, false, 'empty question → error')
r = await callAsk({ questions: [{ id: 'q1', question: 'Pick', options: ['only'] }] }, async () => ({
  answers: []
}))
assert.equal(r.ok, false, '1 option → error')
r = await callAsk(
  { questions: [{ id: 'q1', question: 'Pick', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }] },
  async () => ({ answers: [] })
)
assert.equal(r.ok, false, '7 options → error')

// missing interactive chat context → error
r = await callAsk({ questions: [{ id: 'q1', question: 'Pick', options: ['a', 'b'] }] }, undefined)
assert.equal(r.ok, false, 'ask_user without ctx.ask → error')
assert.match(r.error, /interactive chat/)

// answered path: ctx.ask receives project + cleaned questions, result echoes answers
const asked: { project?: string; questions?: AskQuestion[] } = {}
r = await callAsk(
  {
    questions: [
      { id: 'q1', question: 'Choose', options: ['A', 'B'] },
      { id: 'q2', question: 'Pick any', options: ['X', 'Y', 'Z'], multiple: true },
      { id: 'q3', question: 'Type' }
    ]
  },
  async (req) => {
    asked.project = req.project
    asked.questions = req.questions
    return {
      answers: [
        { id: 'q1', answer: 'A' },
        { id: 'q2', answer: 'X, Z', selections: ['X', 'Z'] },
        { id: 'q3', answer: 'hello' }
      ]
    }
  }
)
assert.equal(r.ok, true)
assert.equal(r.cancelled, false)
assert.deepEqual(
  r.answers.map((a: { id: string }) => a.id),
  ['q1', 'q2', 'q3']
)
assert.equal(asked.project, 'Research', 'ctx.ask receives the active project')
assert.equal(asked.questions?.length, 3)
assert.deepEqual(asked.questions?.[0], { id: 'q1', question: 'Choose', options: ['A', 'B'] })
assert.deepEqual(asked.questions?.[1], {
  id: 'q2',
  question: 'Pick any',
  options: ['X', 'Y', 'Z'],
  multiple: true
})
assert.deepEqual(asked.questions?.[2], { id: 'q3', question: 'Type' }, 'free-text keeps no options')

// cancelled path
r = await callAsk(
  { questions: [{ id: 'q1', question: 'Choose', options: ['A', 'B'] }] },
  async () => ({ answers: [], cancelled: true })
)
assert.equal(r.ok, false)
assert.equal(r.cancelled, true)
assert.deepEqual(r.answers, [])

// ---- shared/ask flow reducer ----

const { buildAnswers, initFlow, isAllAnswered, reduce } = await import('../src/shared/ask')

const qs: AskQuestion[] = [
  { id: 'q1', question: 'Choose one?', options: ['A', 'B', 'C'] },
  { id: 'q2', question: 'Pick any?', options: ['X', 'Y'], multiple: true },
  { id: 'q3', question: 'Type it?' }
]

// initFlow
let s = initFlow(qs)
assert.deepEqual(s, {
  pane: 0,
  cursor: [0, 0, 0],
  selections: [null, null, null],
  freeText: ['', '', ''],
  answered: [false, false, false]
})
assert.equal(isAllAnswered(s), false)

// arrows move the cursor (with wrap)
s = reduce(s, { type: 'keydown', key: 'ArrowDown' }, qs).state
assert.equal(s.cursor[0], 1)
s = reduce(s, { type: 'keydown', key: 'ArrowDown' }, qs).state
assert.equal(s.cursor[0], 2)
s = reduce(s, { type: 'keydown', key: 'ArrowDown' }, qs).state
assert.equal(s.cursor[0], 0, 'down wraps to 0')
s = reduce(s, { type: 'keydown', key: 'ArrowUp' }, qs).state
assert.equal(s.cursor[0], 2, 'up wraps to last')

// radio Enter commits highlighted option + advances
let res = reduce(s, { type: 'keydown', key: 'Enter' }, qs)
assert.deepEqual(res.state.selections[0], ['C'])
assert.equal(res.state.answered[0], true)
assert.equal(res.state.pane, 1)
assert.equal(res.action, 'next')

// radio Tab also commits + advances
let t = initFlow(qs)
t = reduce(t, { type: 'keydown', key: 'ArrowDown' }, qs).state
t = reduce(t, { type: 'keydown', key: 'Tab' }, qs).state
assert.deepEqual(t.selections[0], ['B'], 'radio tab commits highlighted option')
assert.equal(t.pane, 1, 'radio tab advances')

// radio Space also commits + advances
t = initFlow(qs)
t = reduce(t, { type: 'keydown', key: 'ArrowDown' }, qs).state
const spRes = reduce(t, { type: 'keydown', key: ' ' }, qs)
assert.deepEqual(spRes.state.selections[0], ['B'], 'radio space commits highlighted option')
assert.equal(spRes.state.pane, 1, 'radio space advances')
assert.equal(spRes.action, 'next')

// checkbox Space toggles the highlighted option (no advance)
s = res.state
res = reduce(s, { type: 'keydown', key: ' ' }, qs)
assert.deepEqual(res.state.selections[1], ['X'])
assert.equal(res.state.pane, 1, 'space toggles without advancing')

// checkbox Enter toggles, Tab advances (no commit)
res = reduce(res.state, { type: 'keydown', key: 'Enter' }, qs)
assert.deepEqual(res.state.selections[1], [], 'enter toggles off')
res = reduce(res.state, { type: 'keydown', key: 'Enter' }, qs)
assert.deepEqual(res.state.selections[1], ['X'], 'enter toggles on')
assert.equal(res.state.pane, 1, 'enter still on same pane')
res = reduce(res.state, { type: 'keydown', key: 'Tab' }, qs)
assert.equal(res.state.pane, 2, 'tab advances to next question')
assert.equal(res.action, 'next')
assert.equal(res.state.answered[1], true)

// free-text input + Enter advance
res = reduce(res.state, { type: 'text', value: 'hello' }, qs)
assert.equal(res.state.freeText[2], 'hello')
assert.equal(res.state.answered[2], true)
res = reduce(res.state, { type: 'keydown', key: 'Enter' }, qs)
assert.equal(res.state.pane, 3, 'free-text enter advances to confirm')
assert.equal(res.action, 'next')

// arrows do nothing on free-text pane
const before = res.state
s = reduce(before, { type: 'keydown', key: 'ArrowDown' }, qs).state
assert.equal(s.cursor[2], 0, 'free-text ignores arrows')

// Shift+Tab on confirm returns to last question
res = reduce(s, { type: 'keydown', key: 'Tab', shiftKey: true }, qs)
assert.equal(res.state.pane, 2)
assert.equal(res.action, 'prev')

// left/right navigate like shift+tab/tab (except free-text)
let lr = initFlow(qs)
lr = reduce(lr, { type: 'keydown', key: 'ArrowRight' }, qs).state
assert.equal(lr.pane, 1, 'right advances to next question')
assert.equal(lr.cursor[0], 0, 'right does not move the option cursor')
lr = reduce(lr, { type: 'keydown', key: 'ArrowRight' }, qs).state
assert.equal(lr.pane, 2, 'right advances again')
res = reduce(lr, { type: 'keydown', key: 'ArrowRight' }, qs)
assert.equal(res.state.pane, 2, 'right ignored on free-text question')
assert.equal(res.action, undefined)
lr = reduce(res.state, { type: 'keydown', key: 'Tab' }, qs).state
assert.equal(lr.pane, 3, 'tab advances to confirm')
res = reduce(lr, { type: 'keydown', key: 'ArrowRight' }, qs)
assert.equal(res.state.pane, 3, 'right on confirm does nothing')
lr = reduce(lr, { type: 'keydown', key: 'ArrowLeft' }, qs).state
assert.equal(lr.pane, 2, 'left from confirm returns to last question')
res = reduce(lr, { type: 'keydown', key: 'ArrowLeft' }, qs)
assert.equal(res.state.pane, 2, 'left ignored on free-text question')
lr = reduce(res.state, { type: 'keydown', key: 'Tab', shiftKey: true }, qs).state
assert.equal(lr.pane, 1, 'shift+tab moves past free-text question')
lr = reduce(lr, { type: 'keydown', key: 'ArrowLeft' }, qs).state
assert.equal(lr.pane, 0, 'left moves back to first question')
res = reduce(lr, { type: 'keydown', key: 'ArrowLeft' }, qs)
assert.equal(res.state.pane, 0, 'left on first question stays')
assert.equal(res.action, 'prev')
// radio pane left/right do not commit; free-text pane ignores left/right
lr = initFlow(qs)
lr = reduce(lr, { type: 'nav', pane: 1 }, qs).state
res = reduce(lr, { type: 'keydown', key: 'ArrowLeft' }, qs)
assert.equal(res.state.pane, 0, 'left on radio goes to previous question')
assert.equal(res.state.selections[1], null, 'left on radio does not commit')
lr = initFlow(qs)
lr = reduce(lr, { type: 'nav', pane: 2 }, qs).state
res = reduce(lr, { type: 'keydown', key: 'ArrowRight' }, qs)
assert.equal(res.state.pane, 2, 'free-text ignores right')
assert.equal(res.action, undefined)

// confirm pane Enter submits when all answered
s = reduce(s, { type: 'nav', pane: 3 }, qs).state
res = reduce(s, { type: 'keydown', key: 'Enter' }, qs)
assert.equal(res.action, 'submit', 'all answered → submit')
assert.equal(res.state.pane, 3)

// confirm gate: Enter with unanswered questions jumps to the first missing
let partial = initFlow(qs)
partial = reduce(partial, { type: 'nav', pane: 3 }, qs).state
assert.equal(partial.pane, 3, 'nav to confirm')
res = reduce(partial, { type: 'keydown', key: 'Enter' }, qs)
assert.notEqual(res.action, 'submit', 'unanswered → no submit')
assert.equal(res.state.pane, 0, 'jumps to first unanswered question')
partial = reduce(res.state, { type: 'click', index: 1 }, qs).state
assert.deepEqual(partial.selections[0], ['B'], 'click selects radio option')
assert.equal(partial.cursor[0], 1, 'click follows cursor')
res = reduce(partial, { type: 'nav', pane: 3 }, qs).state
res = reduce(res, { type: 'keydown', key: 'Enter' }, qs)
assert.equal(res.state.pane, 1, 'next unanswered after q1 answered')

// Escape cancels
res = reduce(s, { type: 'keydown', key: 'Escape' }, qs)
assert.equal(res.action, 'cancel')

// buildAnswers joins multi-select and echoes free text
const ans = buildAnswers(s, qs)
assert.deepEqual(ans, [
  { id: 'q1', answer: 'C', selections: ['C'] },
  { id: 'q2', answer: 'X', selections: ['X'] },
  { id: 'q3', answer: 'hello' }
])

// multi-select join in buildAnswers
s = initFlow(qs)
s = reduce(s, { type: 'click', index: 0 }, qs).state
s = reduce(s, { type: 'nav', pane: 1 }, qs).state
s = reduce(s, { type: 'click', index: 0 }, qs).state
s = reduce(s, { type: 'click', index: 1 }, qs).state
const multi = buildAnswers(s, qs)
assert.equal(multi[1]?.answer, 'X, Y', 'multi-select joined')
assert.deepEqual(multi[1]?.selections, ['X', 'Y'])

console.log('ask_user tests passed')
