import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

export function isJsonText(text: string): boolean {
  if (!text.trim()) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

export function prettyJsonText(text: string): string {
  return JSON.stringify(JSON.parse(text), null, 2)
}

export function prettyJsonInCodeBlock(editor: Editor): boolean {
  const $from = editor.state.selection.$from
  let block: {
    node: { textContent: string; attrs: Record<string, unknown>; nodeSize: number }
    pos: number
  } | null = null
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'codeBlock') {
      block = { node: node as never, pos: $from.before(d) }
      break
    }
  }
  if (!block) return false
  const text = block.node.textContent
  if (!isJsonText(text)) return false
  const pretty = prettyJsonText(text)
  const schema = editor.state.schema
  if (!schema.nodes.codeBlock) return false
  const node = schema.nodes.codeBlock.create(
    { ...block.node.attrs, language: 'json' },
    pretty ? [schema.text(pretty)] : []
  )
  const caretOffset = Math.max(0, editor.state.selection.from - block.pos - 1)
  const tr = editor.state.tr
  tr.replaceWith(block.pos, block.pos + block.node.nodeSize, node)
  const caret = block.pos + Math.min(caretOffset + 1, pretty.length + 1)
  tr.setSelection(TextSelection.create(tr.doc, Math.max(1, caret)))
  editor.view.dispatch(tr)
  editor.commands.focus()
  return true
}
