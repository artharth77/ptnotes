import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiRadioboxBlank,
  mdiRadioboxMarked
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'
import { MdiIcon } from './MdiIcon'
import {
  buildAnswers,
  initFlow,
  isAllAnswered,
  isFree,
  isMulti,
  reduce,
  type AskFlowState
} from '@shared/ask'
import type { AskAnswer, AskQuestion } from '@shared/types'

function answerText(state: AskFlowState, i: number): string {
  const sel = state.selections[i]
  if (sel && sel.length > 0) return sel.join(', ')
  const text = state.freeText[i] ?? ''
  return text.trim() ? text : 'Not answered'
}

/**
 * Wizard-style dialog for the `ask_user` tool. Rendered with a `key` bound to
 * `askRequest.id` (see App.tsx) so the flow state resets on every new request.
 */
export function AskUserDialog(): React.JSX.Element | null {
  const askRequest = useAppStore((s) => s.askRequest)
  const setAskRequest = useAppStore((s) => s.setAskRequest)

  const questions = useMemo<AskQuestion[]>(() => askRequest?.questions ?? [], [askRequest])
  const confirmPane = questions.length
  const [flow, setFlow] = useState<AskFlowState>(() => initFlow(questions))
  const pane = Math.min(flow.pane, confirmPane)
  const paneRef = useRef<HTMLDivElement>(null)
  const freeTextRef = useRef<HTMLInputElement>(null)
  const respondedRef = useRef(false)

  const focusPane = useCallback(() => {
    requestAnimationFrame(() => {
      if (freeTextRef.current) freeTextRef.current.focus()
      else paneRef.current?.focus()
    })
  }, [])

  useEffect(() => {
    focusPane()
  }, [focusPane])

  const go = useCallback(
    (next: number) => {
      setFlow((s) => ({ ...s, pane: Math.max(0, Math.min(confirmPane, next)) }))
      focusPane()
    },
    [confirmPane, focusPane]
  )

  const submit = useCallback(async () => {
    if (respondedRef.current) return
    respondedRef.current = true
    const answers: AskAnswer[] = buildAnswers(flow, questions)
    if (askRequest) {
      await window.ptnotes.ai.askResponse({ id: askRequest.id, answers })
    }
    setAskRequest(null)
  }, [flow, questions, askRequest, setAskRequest])

  const cancel = useCallback(async () => {
    if (respondedRef.current) return
    respondedRef.current = true
    if (askRequest) {
      await window.ptnotes.ai.askResponse({ id: askRequest.id, answers: [], cancelled: true })
    }
    setAskRequest(null)
  }, [askRequest, setAskRequest])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        void cancel()
        return
      }
      const cur = questions[flow.pane]
      const isText = !!cur && isFree(cur)
      if (!isText) {
        e.preventDefault()
      }
      const result = reduce(flow, { type: 'keydown', key: e.key, shiftKey: e.shiftKey }, questions)
      if (result.state !== flow) setFlow(result.state)
      switch (result.action) {
        case 'next':
        case 'prev':
          focusPane()
          break
        case 'submit':
          void submit()
          break
        case 'cancel':
          void cancel()
          break
      }
    },
    [flow, questions, cancel, submit, focusPane]
  )

  if (!askRequest) return null
  const q = questions[pane]
  const allAnswered = isAllAnswered(flow)

  return (
    <Modal title="Answer the assistant" onClose={() => void cancel()} className="ask-dialog">
      <div className="ask-layout">
        <nav className="ask-nav">
          {questions.map((qitem, i) => (
            <button
              key={qitem.id}
              className={`ask-nav-item${pane === i ? ' active' : ''}${
                flow.answered[i] ? '' : ' unanswered'
              }`}
              onClick={() => go(i)}
            >
              <span className="ask-nav-index">{i + 1}.</span>
              <span className="ask-nav-text" title={qitem.question}>
                {qitem.question}
              </span>
            </button>
          ))}
          <button
            className={`ask-nav-item${pane === confirmPane ? ' active' : ''}`}
            onClick={() => go(confirmPane)}
          >
            <span className="ask-nav-text">Confirm</span>
          </button>
        </nav>

        <div
          className="ask-pane"
          ref={paneRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          role="dialog"
          aria-label={pane === confirmPane ? 'Confirm answers' : `Question ${pane + 1}`}
        >
          {q ? (
            <>
              <div className="ask-question-full">{q.question}</div>
              {isFree(q) ? (
                <input
                  ref={freeTextRef}
                  className="ask-free-text"
                  value={flow.freeText[pane]}
                  onChange={(e) =>
                    setFlow(reduce(flow, { type: 'text', value: e.target.value }, questions).state)
                  }
                  placeholder="Type your answer…"
                />
              ) : (
                <div className="ask-options" role={isMulti(q) ? 'group' : 'radiogroup'}>
                  {(q.options ?? []).map((opt, i) => {
                    const checked = (flow.selections[pane] ?? []).includes(opt)
                    return (
                      <div
                        key={opt}
                        role={isMulti(q) ? 'checkbox' : 'radio'}
                        aria-checked={checked}
                        className={`ask-option${checked ? ' checked' : ''}${
                          i === flow.cursor[pane] ? ' cursor' : ''
                        }`}
                        onClick={() =>
                          setFlow(reduce(flow, { type: 'click', index: i }, questions).state)
                        }
                      >
                        <span className="ask-option-bullet">
                          <MdiIcon
                            path={
                              isMulti(q)
                                ? checked
                                  ? mdiCheckboxMarked
                                  : mdiCheckboxBlankOutline
                                : checked
                                  ? mdiRadioboxMarked
                                  : mdiRadioboxBlank
                            }
                            size={16}
                          />
                        </span>
                        <span className="ask-option-label">{opt}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="ask-confirm-summary">
              {questions.map((qitem, i) => (
                <div key={qitem.id} className="ask-confirm-row">
                  <span className="ask-confirm-q">
                    {i + 1}. {qitem.question}
                  </span>
                  <span className={`ask-confirm-a${flow.answered[i] ? '' : ' missing'}`}>
                    {answerText(flow, i)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="ask-nav-actions">
            <button className="btn" disabled={pane === 0} onClick={() => go(pane - 1)}>
              Previous
            </button>
            {pane < confirmPane ? (
              <button className="btn primary" onClick={() => go(pane + 1)}>
                Next
              </button>
            ) : (
              <button className="btn primary" disabled={!allAnswered} onClick={() => void submit()}>
                Confirm
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
