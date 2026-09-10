import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

const MERGEABLE = new Set(['paragraph', 'heading', 'codeBlock'])

interface BlockEntry {
  node: PMNode
  start: number
  end: number
}

/**
 * Toolbar/code-block toggle that merges the selected blocks into ONE code
 * block (newline-joined) instead of one block per paragraph. Toggling OFF
 * converts each selected codeBlock back into paragraphs (one per line).
 */
export function toggleCodeBlockMerged(editor: Editor): void {
  const { selection } = editor.state
  if (selection.empty) {
    editor.chain().focus().toggleCodeBlock().run()
    return
  }
  const blocks = selectedBlocks(editor)
  if (blocks.length === 0) {
    editor.chain().focus().toggleCodeBlock().run()
    return
  }
  if (!blocks.every((b) => MERGEABLE.has(b.node.type.name))) {
    editor.chain().focus().toggleCodeBlock().run()
    return
  }
  if (blocks.some((b) => b.node.type.name === 'codeBlock')) {
    turnOff(editor, blocks)
    return
  }
  mergeIntoOne(editor, blocks)
}

function selectedBlocks(editor: Editor): BlockEntry[] {
  const sel = editor.state.selection
  const range = sel.$from.blockRange(sel.$to)
  if (!range) return []
  const { parent, startIndex, endIndex, depth } = range
  const contentStart = range.$from.start(depth)
  const blocks: BlockEntry[] = []
  let idx = 0
  parent.forEach((child, offset) => {
    if (idx >= startIndex && idx < endIndex) {
      const start = contentStart + offset
      blocks.push({ node: child, start, end: start + child.nodeSize })
    }
    idx++
  })
  return blocks
}

function mergeIntoOne(editor: Editor, blocks: BlockEntry[]): void {
  const schema = editor.state.schema
  if (!schema.nodes.codeBlock) {
    editor.chain().focus().toggleCodeBlock().run()
    return
  }
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  const firstCode = blocks.find((b) => b.node.type.name === 'codeBlock')
  const language = (firstCode?.node.attrs.language as string | undefined) ?? ''
  const text = blocks.map((b) => b.node.textContent).join('\n')
  const node = schema.nodes.codeBlock.create({ language }, text ? [schema.text(text)] : [])
  const caretOffset = Math.max(0, editor.state.selection.from - first.start - 1)
  const tr = editor.state.tr
  tr.replaceWith(first.start, last.end, node)
  const caret = first.start + Math.min(caretOffset + 1, text.length + 1)
  tr.setSelection(TextSelection.create(tr.doc, Math.max(1, caret)))
  editor.view.dispatch(tr)
  editor.commands.focus()
}

function turnOff(editor: Editor, blocks: BlockEntry[]): void {
  const first = blocks[0]
  const json: { type: string; content?: { type: string; text?: string }[] }[] = []
  const last = blocks[blocks.length - 1]
  for (const b of blocks) {
    b.node.textContent.split('\n').forEach((line) => {
      json.push(
        line
          ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
          : { type: 'paragraph' }
      )
    })
  }
  editor
    .chain()
    .focus()
    .insertContentAt({ from: first.start, to: last.end }, json)
    .setTextSelection(Math.max(1, first.start + 1))
    .run()
}
