import type { AskAnswer, AskQuestion } from './types'

/** Pane 0..N-1 = questions, pane N = confirm. */
export type AskPane = number

export interface AskFlowState {
  /** Current wizard pane (0..N-1 question, N = confirm). */
  pane: number
  /** Per-question cursor index into `options` (irrelevant for free-text). */
  cursor: number[]
  /** Per-question selected option texts; `null` for free-text questions. */
  selections: (string[] | null)[]
  /** Per-question free-text input (only used for questions without options). */
  freeText: string[]
  /** Per-question answered flag (derived, kept in sync by the reducer). */
  answered: boolean[]
}

export type AskFlowAction = 'next' | 'prev' | 'submit' | 'cancel'

export interface AskFlowResult {
  state: AskFlowState
  action?: AskFlowAction
}

export type AskFlowEvent =
  | { type: 'keydown'; key: string; shiftKey?: boolean }
  | { type: 'click'; index: number }
  | { type: 'text'; value: string }
  | { type: 'nav'; pane: number }

export function isMulti(q: AskQuestion): boolean {
  return !!q.multiple && !!q.options && q.options.length > 0
}

export function isFree(q: AskQuestion): boolean {
  return !q.options || q.options.length === 0
}

export function initFlow(questions: AskQuestion[]): AskFlowState {
  return {
    pane: 0,
    cursor: questions.map(() => 0),
    selections: questions.map(() => null),
    freeText: questions.map(() => ''),
    answered: questions.map(() => false)
  }
}

export function isAllAnswered(state: AskFlowState): boolean {
  return state.answered.every(Boolean)
}

/** Recompute per-question `answered` flags from selections / free text. */
function recompute(state: AskFlowState): AskFlowState {
  const answered = state.selections.map((sel, i) => {
    if (sel) return sel.length > 0
    return (state.freeText[i] ?? '').trim().length > 0
  })
  return { ...state, answered }
}

function toggleOption(
  state: AskFlowState,
  pane: number,
  index: number,
  opts: string[]
): AskFlowState {
  const selections = state.selections.map((s) => (s ? [...s] : null))
  const cur = selections[pane] ?? []
  const option = opts[index]
  const has = cur.includes(option)
  selections[pane] = has ? cur.filter((o) => o !== option) : [...cur, option]
  const cursor = [...state.cursor]
  cursor[pane] = index
  return recompute({ ...state, selections, cursor })
}

/** Commit the highlighted radio option and advance to the next pane. */
function commitRadio(
  state: AskFlowState,
  pane: number,
  opts: string[],
  nextPane: number
): AskFlowResult {
  const selections = state.selections.map((s) => (s ? [...s] : null))
  selections[pane] = [opts[state.cursor[pane]]]
  return { state: recompute({ ...state, selections, pane: nextPane }), action: 'next' }
}

/**
 * Advance the flow by one keyboard / mouse event. Returns the next state plus an
 * optional navigation action for the component (focus change, submit, cancel).
 */
export function reduce(
  state: AskFlowState,
  event: AskFlowEvent,
  questions: AskQuestion[]
): AskFlowResult {
  const N = questions.length
  const confirmPane = N

  switch (event.type) {
    case 'nav': {
      const pane = Math.max(0, Math.min(event.pane, confirmPane))
      return { state: { ...state, pane } }
    }
    case 'click': {
      const q = questions[state.pane]
      if (!q || state.pane >= N) return { state }
      const opts = q.options ?? []
      if (isFree(q) || event.index < 0 || event.index >= opts.length) return { state }
      if (isMulti(q)) return { state: toggleOption(state, state.pane, event.index, opts) }
      const selections = state.selections.map((s) => (s ? [...s] : null))
      selections[state.pane] = [opts[event.index]]
      const cursor = [...state.cursor]
      cursor[state.pane] = event.index
      return { state: recompute({ ...state, selections, cursor }) }
    }
    case 'text': {
      const q = questions[state.pane]
      if (!q || !isFree(q)) return { state }
      const freeText = [...state.freeText]
      freeText[state.pane] = event.value
      return { state: recompute({ ...state, freeText }) }
    }
    case 'keydown': {
      const key = event.key
      const shift = !!event.shiftKey
      if (key === 'Escape') return { state, action: 'cancel' }
      if (shift && key === 'Tab') {
        return { state: { ...state, pane: Math.max(0, state.pane - 1) }, action: 'prev' }
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const delta = key === 'ArrowRight' ? 1 : -1
        if (state.pane === confirmPane) {
          if (delta === -1) {
            return { state: { ...state, pane: confirmPane - 1 }, action: 'prev' }
          }
          return { state }
        }
        const q = questions[state.pane]!
        if (isFree(q)) return { state }
        const next = Math.max(0, Math.min(confirmPane, state.pane + delta))
        return { state: { ...state, pane: next }, action: delta === 1 ? 'next' : 'prev' }
      }
      if (state.pane === confirmPane) {
        if (key === 'Enter') {
          if (isAllAnswered(state)) return { state, action: 'submit' }
          const firstMissing = questions.findIndex((_, i) => !state.answered[i])
          return { state: { ...state, pane: firstMissing === -1 ? state.pane : firstMissing } }
        }
        return { state }
      }
      const q = questions[state.pane]!
      const opts = q.options ?? []
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        if (isFree(q) || opts.length === 0) return { state }
        const delta = key === 'ArrowDown' ? 1 : -1
        const next = (state.cursor[state.pane] + delta + opts.length) % opts.length
        const cursor = [...state.cursor]
        cursor[state.pane] = next
        return { state: { ...state, cursor } }
      }
      if (key === ' ' || key === 'Spacebar') {
        if (isFree(q)) return { state }
        if (isMulti(q))
          return { state: toggleOption(state, state.pane, state.cursor[state.pane], opts) }
        // radio: Space commits the highlighted option and advances
        return commitRadio(state, state.pane, opts, Math.min(confirmPane, state.pane + 1))
      }
      if (key === 'Enter' || key === 'Tab') {
        const nextPane = Math.min(confirmPane, state.pane + 1)
        if (isFree(q)) return { state: { ...state, pane: nextPane }, action: 'next' }
        if (isMulti(q)) {
          if (key === 'Enter') {
            return { state: toggleOption(state, state.pane, state.cursor[state.pane], opts) }
          }
          return { state: { ...state, pane: nextPane }, action: 'next' }
        }
        return commitRadio(state, state.pane, opts, nextPane)
      }
      return { state }
    }
  }
}

/** Build the submit payload from the current flow state (every question answered). */
export function buildAnswers(state: AskFlowState, questions: AskQuestion[]): AskAnswer[] {
  return questions.map((q, i) => {
    const sel = state.selections[i]
    if (sel) return { id: q.id, answer: sel.join(', '), selections: sel }
    return { id: q.id, answer: state.freeText[i] ?? '' }
  })
}
