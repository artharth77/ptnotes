/**
 * Headless TipTap editor tests (jsdom) that cannot run via MarkdownManager alone.
 * Run: tsx --tsconfig tsconfig.node.json scripts/test-editor.mts
 */
import { JSDOM } from 'jsdom'
import assert from 'node:assert/strict'
import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import { lowlight } from 'lowlight'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import StarterKit from '@tiptap/starter-kit'
import Typography from '@tiptap/extension-typography'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'

// ---- jsdom globals (mirrors MarkdownEditor's browser deps) ----
const dom = new JSDOM('<!doctype html><body></body>')
const g = dom.window as unknown as Record<string, unknown>
for (const k of [
  'window',
  'document',
  'DocumentFragment',
  'MutationObserver',
  'Element',
  'Node',
  'HTMLElement',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame'
]) {
  globalThis[k] = g[k] as unknown
}
Object.defineProperty(globalThis, 'navigator', { value: g.navigator, configurable: true })
;(globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s }
globalThis.requestAnimationFrame = ((cb: (t: number) => void) =>
  setTimeout(() => cb(0), 0)) as unknown as typeof globalThis.requestAnimationFrame
globalThis.cancelAnimationFrame = ((id: number) =>
  clearTimeout(id)) as unknown as typeof globalThis.cancelAnimationFrame

// ---- same CodeBlockLowlight config as MarkdownEditor.tsx ----
const safeLanguage = (lang: string | null | undefined): string => lang || 'text'

const CodeBlock = CodeBlockLowlight.extend({
  addOptions() {
    return { ...this.parent?.(), lowlight, defaultLanguage: 'text' }
  },
  addAttributes() {
    // mirrors MarkdownEditor.tsx: node attribute default is '' (unlabeled),
    // while options.defaultLanguage stays 'text' for the lowlight plugin fallback
    const parentAttrs = (this.parent?.() ?? {}) as Record<string, { default?: unknown }>
    const base = parentAttrs.language ?? {}
    return { ...parentAttrs, language: { ...base, default: '' } }
  },
  parseMarkdown: (token, helpers) => {
    const isFenced =
      typeof token.raw === 'string' && (token.raw.startsWith('```') || token.raw.startsWith('~~~'))
    if (!isFenced && token.codeBlockStyle !== 'indented') {
      return []
    }
    return helpers.createNode(
      'codeBlock',
      { language: token.lang ? safeLanguage(token.lang) : '' },
      token.text ? [helpers.createTextNode(token.text)] : []
    )
  }
})

function makeEditor(content: string): Editor {
  return new Editor({
    element: dom.window.document.createElement('div') as unknown as HTMLElement,
    extensions: [
      StarterKit.configure({ codeBlock: false, history: false }),
      CodeBlock,
      Markdown,
      Typography,
      TaskList,
      TaskItem.configure({ nested: true })
    ],
    content,
    contentType: 'markdown'
  })
}

/**
 * Mirrors the language <select> onChange handler in MarkdownEditor.tsx.
 * IMPORTANT: keep in sync with the component. Resolves the enclosing
 * codeBlock position from the resolved cursor so it works at every
 * cursor position (mid-text, end of block text, empty block).
 */
function changeLang(editor: Editor, nextLang: string): boolean {
  const restore = editor.state.selection
  const $from = restore.$from
  let cbPos: number | null = null
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === 'codeBlock') {
      cbPos = $from.before(d)
      break
    }
  }
  if (cbPos === null) return false
  return editor
    .chain()
    .setNodeSelection(cbPos)
    .updateAttributes('codeBlock', { language: nextLang })
    .setTextSelection(restore.empty ? restore.$from.pos : { from: restore.from, to: restore.to })
    .focus()
    .run()
}

const MD = 'before\n\n```js\nlet x = 1\n```\n\nafter\n'

function cursorAtBlockEnd(ed: Editor): void {
  let cbEnd = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      cbEnd = pos + node.nodeSize - 1
      return false
    }
    return true
  })
  assert.ok(cbEnd > 0, 'found codeBlock')
  ed.commands.setTextSelection(cbEnd)
}

// cursor mid-text
{
  const ed = makeEditor(MD)
  // cursor at offset 2 inside the code text (code content starts at doc pos 10)
  ed.commands.setTextSelection(10 + 2)
  assert.ok(ed.isActive('codeBlock'), 'mid-text cursor is inside codeBlock')
  assert.ok(changeLang(ed, 'html'), 'mid-text update succeeds')
  assert.equal(ed.getJSON().content![1].attrs.language, 'html', 'mid-text language applied')
  ed.destroy()
}

// cursor at END of the code block text (the regression: failed before)
{
  const ed = makeEditor(MD)
  cursorAtBlockEnd(ed)
  assert.ok(ed.isActive('codeBlock'), 'cursor at block end is inside codeBlock')
  assert.ok(changeLang(ed, 'html'), 'end-of-text update succeeds')
  assert.equal(ed.getJSON().content![1].attrs.language, 'html', 'end-of-text language applied')
  ed.destroy()
}

// empty codeBlock
{
  const ed = makeEditor('before\n\n```js\n\n```\n\nafter\n')
  let cbPos = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      cbPos = pos
      return false
    }
    return true
  })
  assert.ok(cbPos > 0, 'found empty codeBlock')
  ed.commands.setTextSelection(cbPos + 1)
  assert.ok(ed.isActive('codeBlock'), 'cursor in empty codeBlock')
  assert.ok(changeLang(ed, 'yaml'), 'empty-block update succeeds')
  const cb = ed.getJSON().content!.find((n) => n.type === 'codeBlock') as {
    attrs: { language?: string }
  }
  assert.equal(cb.attrs.language, 'yaml', 'empty-block language applied')
  ed.destroy()
}

// codeBlock inside a task list (nested structure)
{
  const ed = makeEditor('- [ ] item\n\n  ```js\nlet t = 1\n```\n')
  let cbPos = -1
  ed.state.doc.descendants((node, pos, parent) => {
    if (node.type.name === 'codeBlock') {
      if (parent?.type.name === 'taskItem') cbPos = pos
      return parent?.type.name !== 'taskItem'
    }
    return true
  })
  assert.ok(cbPos > 0, 'found nested codeBlock')
  ed.commands.setTextSelection(cbPos + 1)
  assert.ok(ed.isActive('codeBlock'), 'cursor inside nested codeBlock')
  assert.ok(changeLang(ed, 'python'), 'nested update succeeds')
  let found: string | undefined
  ed.state.doc.descendants((node) => {
    if (node.type.name === 'codeBlock' && !found) found = node.attrs.language as string
    return true
  })
  assert.equal(found, 'python', 'nested language applied')
  ed.destroy()
}

// serialized markdown reflects the change
{
  const ed = makeEditor(MD)
  let end = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      end = pos + node.nodeSize - 1
      return false
    }
    return true
  })
  ed.commands.setTextSelection(end)
  changeLang(ed, 'html')
  assert.ok(ed.getMarkdown().includes('```html'), 'markdown serialization shows the new language')
  ed.destroy()
}

// cursor/selection restoration: collapse keeps the exact cursor, range keeps from..to
{
  const ed = makeEditor(MD)
  let end = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      end = pos + node.nodeSize - 1
      return false
    }
    return true
  })
  ed.commands.setTextSelection(end - 3)
  changeLang(ed, 'html')
  assert.equal(ed.state.selection.from, end - 3, 'collapsed cursor restored to same position')
  assert.equal(ed.state.selection.to, end - 3, 'collapsed cursor stays a cursor')
  ed.destroy()
}
{
  const ed = makeEditor(MD)
  let end = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      end = pos + node.nodeSize - 1
      return false
    }
    return true
  })
  ed.commands.setTextSelection({ from: end - 4, to: end - 2 })
  changeLang(ed, 'yaml')
  assert.equal(ed.state.selection.from, end - 4, 'range selection start restored')
  assert.equal(ed.state.selection.to, end - 2, 'range selection end restored')
  ed.destroy()
}

// unlabeled (auto) language semantics: '' attr, plain fence round-trip, no language-* class
{
  const ed = makeEditor('before\n\n```\nno lang\n```\n\nafter\n')
  const cb = ed.getJSON().content!.find((n) => n.type === 'codeBlock') as {
    attrs: { language?: string }
    content?: { text?: string }[]
  }
  assert.ok(cb, 'unlabeled fence parses into codeBlock')
  assert.equal(cb.attrs.language, '', 'unlabeled fence attr is empty string')
  const html = ed.getHTML().match(/<pre[^>]*>/)?.[0] ?? ''
  assert.ok(!html.includes('language-'), 'empty language renders no language class')
  assert.equal(
    ed.getMarkdown().trim(),
    'before\n\n```\nno lang\n```\n\nafter',
    'unlabeled fence round-trips without label'
  )
  ed.destroy()
}

// explicit text label preserved
{
  const ed = makeEditor('```text\nfixed\n```\n')
  ed.commands.setTextSelection(4)
  assert.ok(ed.isActive('codeBlock'))
  changeLang(ed, 'text')
  assert.equal(ed.getJSON().content![0].attrs.language, 'text', 'explicit text attr stays')
  assert.ok(ed.getMarkdown().includes('```text'), 'explicit text label serializes')
  ed.destroy()
}

// inserted fence without attrs uses the empty-language default
{
  const ed = makeEditor('para')
  const text = ed.state.schema.text('x')
  const cbNode = ed.state.schema.nodes.codeBlock.create(null, text)
  ed.view.dispatch(ed.state.tr.replaceWith(0, ed.state.doc.content.size, cbNode))
  const cb = ed.getJSON().content!.find((n) => n.type === 'codeBlock') as {
    attrs: { language?: string }
  }
  assert.ok(cb, 'inserted codeBlock exists')
  assert.equal(cb.attrs.language, '', 'node created with null attrs gets the empty default')
  // selecting a language then Plain Text re-labels explicitly
  let end = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      end = pos + node.nodeSize - 1
      return false
    }
    return true
  })
  ed.commands.setTextSelection(end)
  assert.ok(changeLang(ed, 'python') && changeLang(ed, 'text'), 'two selections apply')
  assert.equal(ed.getJSON().content!.find((n) => n.type === 'codeBlock')!.attrs.language, 'text')
  ed.destroy()
}

console.log('EDITOR CODE-BLOCK LANGUAGE TESTS PASSED — mid-text, end-of-text, empty, nested')
