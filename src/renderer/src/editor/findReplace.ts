import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import { findMatchesInTextRuns, type FindRange, type TextRun } from '@shared/find'

export interface FindPluginState {
  query: string
  matchCase: boolean
  results: FindRange[]
  index: number
}

interface SetMeta {
  type: 'set'
  query: string
  matchCase: boolean
}

interface SetIndexMeta {
  type: 'setIndex'
  index: number
}

interface ClearMeta {
  type: 'clear'
}

type FindMeta = SetMeta | SetIndexMeta | ClearMeta

export const ptnotesFindKey = new PluginKey<FindPluginState>('ptnotesFind')

const emptyState: FindPluginState = { query: '', matchCase: false, results: [], index: 0 }

function buildTextRuns(doc: Node): TextRun[] {
  const runs: TextRun[] = []
  let index = 0
  doc.descendants((node, pos) => {
    if (node.isText) {
      const current = runs[index]
      if (current) {
        current.text += node.text ?? ''
      } else {
        runs[index] = { text: node.text ?? '', pos }
      }
    } else {
      index += 1
    }
  })
  return runs.filter((r): r is TextRun => Boolean(r))
}

const findPlugin = new Plugin<FindPluginState>({
  key: ptnotesFindKey,
  state: {
    init: () => emptyState,
    apply(tr, oldState) {
      const meta = tr.getMeta(ptnotesFindKey) as FindMeta | undefined
      let next = oldState

      if (meta?.type === 'clear') {
        next = { ...emptyState }
      } else if (meta?.type === 'set') {
        next = { ...next, query: meta.query, matchCase: meta.matchCase, index: 0 }
      } else if (meta?.type === 'setIndex') {
        next = { ...next, index: meta.index }
      }

      if (tr.docChanged || meta?.type === 'set') {
        if (next.query) {
          const results = findMatchesInTextRuns(buildTextRuns(tr.doc), next.query, next.matchCase)
          next = {
            ...next,
            results,
            index: results.length ? Math.min(next.index, results.length - 1) : 0
          }
        } else {
          next = { ...next, results: [], index: 0 }
        }
      }

      return next
    }
  },
  props: {
    decorations(state) {
      const { results, index } = ptnotesFindKey.getState(state) ?? emptyState
      if (!results.length) return DecorationSet.empty
      const decos = results.map((r, i) =>
        Decoration.inline(r.from, r.to, {
          class: i === index ? 'find-match find-match-current' : 'find-match'
        })
      )
      return DecorationSet.create(state.doc, decos)
    }
  }
})

export const FindReplace = Extension.create({
  name: 'ptnotesFindReplace',
  addProseMirrorPlugins() {
    return [findPlugin]
  }
})

export function getFindState(editor: Editor): FindPluginState {
  return ptnotesFindKey.getState(editor.state) ?? emptyState
}

function scrollMatchIntoView(editor: Editor, match: FindRange): void {
  const rect = editor.view.coordsAtPos(match.from)
  if (!rect) return
  const content = editor.view.dom.closest('.editor-content')
  if (!content) return
  const cRect = content.getBoundingClientRect()
  const margin = 12
  if (rect.top < cRect.top) {
    content.scrollTop += rect.top - cRect.top - margin
  } else if (rect.bottom > cRect.bottom) {
    content.scrollTop += rect.bottom - cRect.bottom + margin
  }
}

function selectMatch(editor: Editor, index: number): void {
  const { results } = getFindState(editor)
  const match = results[index]
  if (!match) return
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to))
  )
  scrollMatchIntoView(editor, match)
}

export function setFind(editor: Editor, query: string, matchCase: boolean): void {
  editor.view.dispatch(editor.state.tr.setMeta(ptnotesFindKey, { type: 'set', query, matchCase }))
  selectMatch(editor, 0)
}

export function clearFind(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(ptnotesFindKey, { type: 'clear' }))
}

export function findStep(editor: Editor, dir: 1 | -1): void {
  const { results, index } = getFindState(editor)
  if (!results.length) return
  const nextIndex = (index + dir + results.length) % results.length
  const match = results[nextIndex]
  editor.view.dispatch(
    editor.state.tr
      .setMeta(ptnotesFindKey, { type: 'setIndex', index: nextIndex })
      .setSelection(TextSelection.create(editor.state.doc, match.from, match.to))
  )
  scrollMatchIntoView(editor, match)
}

export function replaceCurrent(editor: Editor, replacement: string): void {
  const { results, index } = getFindState(editor)
  const match = results[index]
  if (!match) return
  editor.view.dispatch(editor.state.tr.insertText(replacement, match.from, match.to))
}

export function replaceAll(editor: Editor, replacement: string): void {
  const { query, matchCase } = getFindState(editor)
  if (!query) return
  const results = findMatchesInTextRuns(buildTextRuns(editor.state.doc), query, matchCase)
  if (!results.length) return
  const tr = editor.state.tr
  for (let i = results.length - 1; i >= 0; i -= 1) {
    tr.insertText(replacement, results[i].from, results[i].to)
  }
  editor.view.dispatch(tr)
}
