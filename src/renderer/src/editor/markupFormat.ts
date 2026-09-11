import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
])

export type MarkupMode = 'html' | 'xml'

export function isMarkupText(text: string, mode: MarkupMode): boolean {
  if (!/<[a-zA-Z!/]/.test(text)) return false
  if (mode === 'html') return true
  if (typeof DOMParser !== 'function') return false
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml')
  } catch {
    return false
  }
  return doc.querySelector('parsererror') == null
}

interface MarkupToken {
  kind: 'tag' | 'text'
  value: string
}

function tokenizeMarkup(text: string): MarkupToken[] {
  return (text.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) ?? []).map((value) => ({
    kind: (value.startsWith('<') ? 'tag' : 'text') as 'tag' | 'text',
    value
  }))
}

function tagName(value: string): string {
  const m = value.match(/^<\/?\s*([a-zA-Z][\w:-]*)/)
  return m?.[1]?.toLowerCase() ?? ''
}

const indentAt = (depth: number): string => '  '.repeat(Math.max(0, depth))

interface InlineState {
  name: string
  open: string
  text: string
  depth: number
}

interface RawState {
  name: string
  buf: string
  depth: number
}

export function prettyMarkupText(text: string, _mode: MarkupMode): string {
  const tokens = tokenizeMarkup(text)
  const lines: string[] = []
  let depth = 0
  let inline: InlineState | null = null
  let raw: RawState | null = null
  const emit = (line: string): void => {
    if (line.trimEnd() || lines.length) lines.push(line.trimEnd())
  }

  for (const token of tokens) {
    if (raw) {
      if (token.kind === 'tag') {
        const name = tagName(token.value)
        if (token.value.startsWith('</') && name === raw.name) {
          for (const l of raw.buf.replace(/^\n/, '').split('\n')) {
            lines.push(l.replace(/[ \t]+$/, ''))
          }
          lines.push(indentAt(raw.depth) + token.value)
          depth = raw.depth
          raw = null
          continue
        }
        raw.buf += token.value
        continue
      }
      raw.buf += token.value
      continue
    }

    if (inline) {
      if (token.kind === 'text') {
        inline.text += token.value.trim()
        continue
      }
      const name = tagName(token.value)
      if (token.value.startsWith('</') && name === inline.name) {
        lines.push(indentAt(inline.depth) + inline.open + inline.text + token.value)
        depth = inline.depth
        inline = null
        continue
      }
      lines.push(indentAt(inline.depth) + inline.open + inline.text)
      depth = inline.depth + 1
      inline = null
    }

    if (token.kind === 'text') {
      const trimmed = token.value.trim()
      if (trimmed) lines.push(indentAt(depth) + trimmed)
      continue
    }

    const value = token.value
    const name = tagName(value)
    if (value.startsWith('</')) {
      depth = Math.max(0, depth - 1)
      lines.push(indentAt(depth) + value)
      continue
    }
    const isNeutral =
      value.endsWith('/>') ||
      value.startsWith('<!--') ||
      value.startsWith('<!') ||
      (value.startsWith('<?') && name === '') ||
      VOID_ELEMENTS.has(name)
    if (isNeutral) {
      lines.push(indentAt(depth) + value)
      continue
    }
    if (name === 'pre' || name === 'textarea') {
      raw = { name, buf: '', depth: depth }
      lines.push(indentAt(depth) + value)
    } else {
      inline = { name, open: value, text: '', depth }
    }
    depth++
  }

  if (raw) {
    for (const l of raw.buf.replace(/^\n/, '').split('\n')) emit(l.replace(/[ \t]+$/, ''))
  } else if (inline) {
    lines.push(indentAt(inline.depth) + inline.open + inline.text)
  }
  return lines.join('\n')
}

export function prettyMarkupInCodeBlock(editor: Editor, mode: MarkupMode): boolean {
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
  if (!isMarkupText(text, mode)) return false
  const pretty = prettyMarkupText(text, mode)
  const schema = editor.state.schema
  if (!schema.nodes.codeBlock) return false
  const node = schema.nodes.codeBlock.create(
    { ...block.node.attrs, language: mode },
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
