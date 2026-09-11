/**
 * Headless TipTap editor tests (jsdom) that cannot run via MarkdownManager alone.
 * Run: tsx --tsconfig tsconfig.node.json scripts/test-editor.mts
 */
import { JSDOM } from 'jsdom'
import assert from 'node:assert/strict'
import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import { createLowlight } from 'lowlight'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import StarterKit from '@tiptap/starter-kit'
import Typography from '@tiptap/extension-typography'
import { suggestLanguage } from '../src/renderer/src/editor/lowlightRegistry'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'

const lowlight = createLowlight()
const safeLanguageMermaid = (lang: string | null | undefined): string => lang || 'text'
const safeLanguageMermaidLowlight = createLowlight()

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
  'DOMParser',
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

// language suggestion helper: confident code suggests, prose/plain text stays null
{
  const jsCode = 'const a = 1\nfunction foo() { return a }\nconst b = a * 2\nconsole.log(b)\n'
  const longJs = jsCode.repeat(3)
  assert.equal(suggestLanguage(''), null, 'empty text suggests nothing')
  assert.equal(suggestLanguage(null), null, 'null text suggests nothing')
  assert.equal(suggestLanguage('   \n\n'), null, 'whitespace-only suggests nothing')
  assert.match(
    String(suggestLanguage(longJs)),
    /^javascript|typescript$/,
    'JS suggests a JS-family language'
  )
  assert.equal(
    suggestLanguage('<div id="x">hi</div>\n<p>w</p>'),
    'html',
    'HTML markup suggests html'
  )
  assert.equal(suggestLanguage('<a href="x">go</a>'), 'html', 'html with attribute suggests html')
  assert.equal(suggestLanguage('<A HREF="#">link</A>'), 'html', 'uppercase-tag html suggests html')
  assert.equal(suggestLanguage('<!DOCTYPE html>\n<html>\n</html>'), 'html', 'doctype suggests html')
  assert.equal(
    suggestLanguage('<config><item>1</item></config>'),
    'xml',
    'generic XML without HTML signals stays xml'
  )
  assert.equal(
    suggestLanguage('<Config xmlns="t">\n  <Item>1</Item>\n</Config>'),
    'xml',
    'namespaced PascalCase XML stays xml'
  )
  assert.equal(
    suggestLanguage('We should compare the value a with key b.\n'),
    null,
    'prose containing standalone a/p does not become xml'
  )
  assert.equal(
    suggestLanguage('import os\ndef main():\n    pass\n'),
    'python',
    'python suggests python'
  )
  let found = false
  for (const text of [
    'SELECT id, name FROM users WHERE id = 1;\n',
    'insert into t (a) values (1);'
  ]) {
    if (suggestLanguage(text) === 'sql') found = true
  }
  assert.ok(found, 'SQL suggests sql')
  assert.equal(
    suggestLanguage('name: build\nsteps:\n  - run: npm ci\n'),
    'yaml',
    'yaml suggests yaml'
  )
  assert.equal(suggestLanguage('{\n "name": "x",\n "n": 1\n}\n'), 'json', 'json suggests json')
  assert.equal(suggestLanguage('#!/bin/bash\necho hi\ncd /tmp\n'), 'bash', 'shebang suggests bash')
  assert.equal(
    suggestLanguage('boolean test() throws Exception {\n  int a = 5;\n  return false;\n}'),
    'java',
    'throws suggests java'
  )
  assert.equal(
    suggestLanguage('public class Hello {\n  public static void main(String[] args) {}\n}'),
    'java',
    'public class suggests java'
  )
  assert.equal(
    suggestLanguage('import java.util.List;\nList<String> xs = List.of("a");\n'),
    'java',
    'java import+generics suggests java'
  )
  assert.equal(
    suggestLanguage('The quick brown fox jumps over the lazy dog and some more text follows here.'),
    null,
    'prose suggests nothing'
  )
  assert.equal(
    suggestLanguage(
      'This is a plain English sentence about the deployment plan for next quarter and what we should do.'
    ),
    null,
    'plain prose suggests nothing'
  )
  console.log('LANGUAGE SUGGESTION TESTS PASSED — code languages detected, prose rejected')
}
{
  const { toggleCodeBlockMerged } = await import('../src/renderer/src/editor/codeBlockToggle')
  const ed = makeEditor('Aaa\n\nBbb\n\nCcc\n')
  const end = ed.state.doc.content.size - 1
  ed.commands.setTextSelection({ from: 1, to: end })
  toggleCodeBlockMerged(ed)
  const content = ed.getJSON().content ?? []
  const codeBlocks = content.filter((n) => n.type === 'codeBlock')
  const nonCode = content.filter(
    (n) => n.type !== 'codeBlock' && n.type !== 'paragraph' && (n.content?.length ?? 0) > 0
  )
  assert.equal(codeBlocks.length, 1, 'selection merges into a single codeBlock')
  assert.deepEqual(nonCode.length, 0, 'no leftover non-empty non-code blocks')
  assert.equal(
    codeBlocks[0].content?.[0]?.text,
    'Aaa\nBbb\nCcc',
    'code block keeps the three lines newline-joined'
  )
  assert.ok(ed.getMarkdown().includes('```'), 'merged block serializes as a fence')
  assert.ok(!ed.getMarkdown().includes('```\n\n```'), 'no triple-fence artifact')
  ed.destroy()
}

// toggling OFF a selected codeBlock restores paragraphs (one per line)
{
  const { toggleCodeBlockMerged } = await import('../src/renderer/src/editor/codeBlockToggle')
  const ed = makeEditor('```js\nlet a = 1\nlet b = 2\n```\n')
  const end = ed.state.doc.content.size - 1
  ed.commands.setTextSelection({ from: 1, to: end })
  toggleCodeBlockMerged(ed)
  const content = ed.getJSON().content ?? []
  const remain = content.filter(
    (n) => n.type !== 'paragraph' || ((n.content?.length ?? 0) > 0 && n.content?.[0]?.text)
  )
  assert.ok(remain.length > 0, 'code block splits into paragraphs')
  assert.ok(
    content.filter((n) => n.type === 'codeBlock').length === 0,
    'no codeBlock remains after off-toggle'
  )
  assert.deepEqual(
    content.filter((n) => n.content?.[0]?.text).map((n) => n.content?.[0]?.text),
    ['let a = 1', 'let b = 2'],
    'paragraphs carry each code line'
  )
  ed.destroy()
}

// single-block selection keeps the upstream toggle (code → paragraph, paragraph → code)
{
  const { toggleCodeBlockMerged } = await import('../src/renderer/src/editor/codeBlockToggle')
  const ed = makeEditor('```js\nlet a = 1\n```\n')
  ed.commands.setTextSelection(4)
  toggleCodeBlockMerged(ed)
  assert.ok(
    (ed.getJSON().content ?? []).every((n) => n.type === 'paragraph'),
    'empty selection toggles single code block off'
  )
  ed.destroy()
}

console.log(
  'CODE-BLOCK MERGE/OFF TESTS PASSED — range selection merges one block, off splits lines'
)

// pretty-JSON action: prettyfies valid JSON, tags language as json; invalid JSON is a no-op
{
  const { prettyJsonInCodeBlock } = await import('../src/renderer/src/editor/jsonFormat')

  // unlabeled block (suggested-json path): pretty output + language set to json
  {
    const ed = makeEditor('```\n{"b":2,"a":[1,2]}\n```\n')
    ed.commands.setTextSelection(3)
    assert.equal(prettyJsonInCodeBlock(ed), true, 'minified JSON block is prettyfied')
    const first = ed.getJSON().content?.[0]
    assert.equal(first?.type, 'codeBlock', 'block stays a codeBlock')
    assert.equal(first?.attrs.language, 'json', 'unlabeled block gets tagged json')
    assert.equal(
      first?.content?.[0]?.text,
      '{\n  "b": 2,\n  "a": [\n    1,\n    2\n  ]\n}',
      'content is pretty-printed with 2-space indent'
    )
    assert.ok(ed.getMarkdown().startsWith('```json'), 'fence serializes as ```json')
    ed.destroy()
  }

  // explicitly json block: language preserved
  {
    const ed = makeEditor('```json\n{"x":1,"y":{"z":true}}\n```\n')
    ed.commands.setTextSelection(4)
    assert.equal(prettyJsonInCodeBlock(ed), true, 'explicit json block is prettyfied')
    const first = ed.getJSON().content?.[0]
    assert.equal(first?.attrs.language, 'json', 'language attr preserved')
    assert.equal(
      first?.content?.[0]?.text,
      '{\n  "x": 1,\n  "y": {\n    "z": true\n  }\n}',
      'nested object pretty-printed'
    )
    ed.destroy()
  }

  // invalid JSON: no-op, content and language untouched
  {
    const ed = makeEditor('```js\nlet a = 1\n```\n')
    ed.commands.setTextSelection(4)
    assert.equal(prettyJsonInCodeBlock(ed), false, 'invalid JSON returns false')
    const first = ed.getJSON().content?.[0]
    assert.equal(first?.attrs.language, 'js', 'language unchanged')
    assert.equal(first?.content?.[0]?.text, 'let a = 1', 'text unchanged')
    ed.destroy()
  }

  // non-json language, even when attractive prose/json-ish text: untouched
  {
    const ed = makeEditor('```text\nnot json at all\n```\n')
    ed.commands.setTextSelection(4)
    assert.equal(prettyJsonInCodeBlock(ed), false, 'non-JSON text untouched')
    const first = ed.getJSON().content?.[0]
    assert.equal(first?.attrs.language, 'text', 'language unchanged')
    assert.equal(first?.content?.[0]?.text, 'not json at all', 'text unchanged')
    ed.destroy()
  }

  console.log('PRETTY-JSON ACTION TESTS PASSED — pretty output, json tag, invalid no-op')
}

// pretty HTML/XML action: indents markup, tags block html/xml; non-markup is a no-op
{
  const { prettyMarkupInCodeBlock, isMarkupText } =
    await import('../src/renderer/src/editor/markupFormat')

  // suggested markup detection mirrors the overlay's showPrettyMarkup gate
  assert.equal(isMarkupText('plain prose\n', 'html'), false, 'prose is not markup')
  assert.equal(
    isMarkupText('broken < xml', 'xml'),
    false,
    'malformed xml fails xml-mode validation'
  )
  assert.ok(isMarkupText('<a><b/></a>', 'xml'), 'valid xml passes validation')

  // unlabeled html block: pretty output + language tagged html
  {
    const ed = makeEditor('```\n<div><p>a</p><b>x</b><br>{"keep":1}</div>\n```\n')
    ed.commands.setTextSelection(3)
    assert.equal(prettyMarkupInCodeBlock(ed, 'html'), true, 'html block is prettyfied')
    const first = ed.getJSON().content?.[0]
    assert.equal(first?.attrs.language, 'html', 'unlabeled block gets tagged html')
    assert.equal(
      first?.content?.[0]?.text,
      ['<div>', '  <p>a</p>', '  <b>x</b>', '  <br>', '  {"keep":1}', '</div>'].join('\n'),
      'content indented with void element + text node on own lines'
    )
    assert.ok(ed.getMarkdown().startsWith('```html'), 'fence serializes as ```html')
    ed.destroy()
  }

  // explicitly xml block: language preserved, declaration + self-closing stay neutral
  {
    const ed = makeEditor(
      '```xml\n<?xml version="1.0"?><config><item id="1"/><item id="2"/></config>\n```\n'
    )
    ed.commands.setTextSelection(10)
    assert.equal(prettyMarkupInCodeBlock(ed, 'xml'), true, 'xml block is prettyfied')
    const first = ed.getJSON().content?.[0]
    assert.equal(first?.attrs.language, 'xml', 'language attr preserved')
    assert.equal(
      first?.content?.[0]?.text,
      [
        '<?xml version="1.0"?>',
        '<config>',
        '  <item id="1"/>',
        '  <item id="2"/>',
        '</config>'
      ].join('\n'),
      'declaration on own line, self-closing tags indented'
    )
    assert.ok(ed.getMarkdown().startsWith('```xml'), 'fence serializes as ```xml')
    ed.destroy()
  }

  // attributes preserved through reflow
  {
    const ed = makeEditor('```html\n<div class="a" ><span data-x="1">hi</span></div>\n```\n')
    ed.commands.setTextSelection(10)
    assert.equal(prettyMarkupInCodeBlock(ed, 'html'), true, 'html with attributes reformats')
    const text = ed.getJSON().content?.[0]?.content?.[0]?.text ?? ''
    assert.equal(
      text,
      ['<div class="a" >', '  <span data-x="1">hi</span>', '</div>'].join('\n'),
      'attribute values kept verbatim'
    )
    ed.destroy()
  }

  // html-lang block with NO markup at all: returns false untouched
  {
    const ed1 = makeEditor('```html\njust some text, no tags here\n```\n')
    ed1.commands.setTextSelection(11)
    assert.equal(prettyMarkupInCodeBlock(ed1, 'html'), false, 'prose block untouched')
    const first = ed1.getJSON().content?.[0]
    assert.equal(first?.attrs.language, 'html', 'language unchanged')
    assert.equal(first?.content?.[0]?.text, 'just some text, no tags here', 'text unchanged')
    ed1.destroy()
  }

  // <pre> interior survives unreflowed
  {
    const ed = makeEditor('```\n<div><pre>  keep\n  raw</pre></div>\n```\n')
    ed.commands.setTextSelection(3)
    assert.equal(prettyMarkupInCodeBlock(ed, 'html'), true, 'pre block prettyfied')
    const text = ed.getJSON().content?.[0]?.content?.[0]?.text ?? ''
    assert.ok(text.includes('  keep'), 'pre interior whitespace preserved')
    const lines = text.split('\n')
    assert.equal(lines[0], '<div>', 'pre open indented from parent')
    assert.equal(lines[lines.length - 1], '</div>', 'outer close emitted last')
    ed.destroy()
  }

  console.log('PRETTY-MARKUP ACTION TESTS PASSED — html/xml pretty, prose no-op, pre raw preserve')
}

// mermaid: language registry, fence round-trip, transient preview-mode attr
{
  const { safeLanguage, SUPPORTED_LANGUAGE_KEYS } =
    await import('../src/renderer/src/editor/lowlightRegistry')
  assert.equal(safeLanguage('mermaid'), 'mermaid', 'mermaid language registered in lowlight')
  assert.ok(SUPPORTED_LANGUAGE_KEYS.has('mermaid'), 'mermaid in supported keys')

  const ed = makeEditor('before\n\n```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n\nafter\n')
  const first = ed.getJSON().content!.find((n) => n.type === 'codeBlock') as {
    attrs: { language?: string }
  }
  assert.ok(first, 'mermaid fence parses into codeBlock')
  assert.equal(first.attrs.language, 'mermaid', 'mermaid language attr kept')
  assert.ok(ed.getMarkdown().includes('```mermaid'), 'mermaid fence serializes back with its label')

  // explicit mermaid label survives a Plain-Text→Mermaid re-label cycle (as the dropdown does)
  let end = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      end = pos + node.nodeSize - 1
      return false
    }
    return true
  })
  ed.commands.setTextSelection(end)
  assert.ok(changeLang(ed, 'mermaid'), 'lang dropdown can (re)apply mermaid')
  assert.ok(changeLang(ed, 'text') && changeLang(ed, 'mermaid'), 'away and back relabels')
  assert.equal(
    ed.getJSON().content!.find((n) => n.type === 'codeBlock')!.attrs.language,
    'mermaid',
    'language attr is mermaid after relabeling'
  )
  ed.destroy()
}
{
  // Mirrored from src/renderer/src/editor/mermaidCodeBlock.ts — the React node
  // view cannot run headless, so the schema/markdown contract is tested on the
  // same attrs/parseMarkdown config (module constants checked below).
  const MermaidCodeBlock = CodeBlockLowlight.extend({
    addOptions() {
      return { ...this.parent?.(), lowlight: safeLanguageMermaidLowlight, defaultLanguage: 'text' }
    },
    addAttributes() {
      const parentAttrs = (this.parent?.() ?? {}) as Record<
        string,
        { rendered?: boolean; default?: unknown }
      >
      const base = parentAttrs.language ?? {}
      return {
        ...parentAttrs,
        language: { ...base, rendered: false, default: '' },
        mermaidMode: {
          default: 'edit',
          rendered: false,
          parseHTML: (element: Element): string | undefined =>
            element.getAttribute('data-mermaid-mode') ?? undefined,
          renderHTML: () => ({})
        }
      }
    },
    parseMarkdown: (token, helpers) => {
      const isFenced =
        typeof token.raw === 'string' &&
        (token.raw.startsWith('```') || token.raw.startsWith('~~~'))
      if (!isFenced && token.codeBlockStyle !== 'indented') return []
      return helpers.createNode(
        'codeBlock',
        { language: token.lang ? safeLanguageMermaid(token.lang) : '', mermaidMode: 'edit' },
        token.text ? [helpers.createTextNode(token.text)] : []
      )
    }
  })
  const makeMermaidEditor = (content: string): Editor =>
    new Editor({
      element: dom.window.document.createElement('div') as unknown as HTMLElement,
      extensions: [
        StarterKit.configure({ codeBlock: false, history: false }),
        MermaidCodeBlock,
        Markdown,
        Typography,
        TaskList,
        TaskItem.configure({ nested: true })
      ],
      content,
      contentType: 'markdown'
    })

  // the module's pure constants agree with the mirrored schema
  {
    const mod = await import('../src/renderer/src/editor/mermaidCodeBlock')
    assert.equal(mod.DEFAULT_MERMAID_MODE, 'edit', 'module default mode is edit')
    assert.deepEqual(
      (mod.MERMAID_MODES as string[]).slice(),
      ['edit', 'split', 'preview'],
      'module modes list'
    )
    const ext = mod.createMermaidCodeBlock()
    assert.equal((ext as { name?: string }).name, 'codeBlock', 'extension name is codeBlock')
  }

  // preview mode attr: settable, session-only, reset to edit on re-parse
  const ed = makeMermaidEditor('```mermaid\nflowchart TD\n  A --> B\n```\n')
  let cbPos = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      cbPos = pos
      return false
    }
    return true
  })
  ed.commands.setTextSelection(cbPos + 1)
  ed.commands.updateAttributes('codeBlock', { mermaidMode: 'preview' })
  const node = ed.state.doc.nodeAt(cbPos)!
  assert.equal(node.attrs.mermaidMode, 'preview', 'preview mode attr applied')
  assert.equal(node.attrs.language, 'mermaid', 'language preserved with mode')
  assert.ok(!ed.getMarkdown().includes('mermaidMode'), 'preview mode never leaks into markdown')
  ed.commands.setContent('other', { contentType: 'markdown', emitUpdate: false })
  ed.commands.setContent('```mermaid\nflowchart TD\n  A --> B\n```\n', {
    contentType: 'markdown',
    emitUpdate: false
  })
  let cb2Pos = -1
  ed.state.doc.descendants((node2, pos) => {
    if (node2.type.name === 'codeBlock') {
      cb2Pos = pos
      return false
    }
    return true
  })
  assert.equal(
    ed.state.doc.nodeAt(cb2Pos)!.attrs.mermaidMode,
    'edit',
    're-parsed block starts in edit mode'
  )
  ed.destroy()
}

// Mod/Cmd+A scoping: caret inside a code block selects only that block's text
{
  const { codeBlockSelectAll } = await import('../src/renderer/src/editor/mermaidCodeBlock')
  const ed = makeEditor('before\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nafter\n')
  let start = -1
  let end = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      start = pos + 1
      end = pos + node.nodeSize - 1
      return false
    }
    return true
  })
  // collapsed cursor mid-text
  ed.commands.setTextSelection(start + 8)
  assert.equal(codeBlockSelectAll(ed), true, 'caret in block runs the block select-all')
  assert.deepEqual(
    [ed.state.selection.from, ed.state.selection.to],
    [start, end],
    'block text selected exactly'
  )
  assert.equal(
    ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to, '\n'),
    'flowchart TD\n  A --> B',
    'selection covers only the block content'
  )
  // range fully inside the block expands to the block
  ed.commands.setTextSelection({ from: start, to: start + 5 })
  assert.equal(codeBlockSelectAll(ed), true, 'partial in-block selection expands')
  assert.deepEqual([ed.state.selection.from, ed.state.selection.to], [start, end])
  // selection crossing the block boundary falls through (default select-all)
  ed.commands.setTextSelection({ from: 1, to: start + 3 })
  assert.equal(codeBlockSelectAll(ed), false, 'crossing selection falls back')
  // caret outside any code block falls through
  ed.commands.setTextSelection(1)
  assert.equal(codeBlockSelectAll(ed), false, 'caret in paragraph falls through')
  // empty block: nothing to select, falls through
  {
    const edEmpty = makeEditor('before\n\n```\n\n```\n\nafter\n')
    let emptyStart = -1
    let emptyEnd = -1
    edEmpty.state.doc.descendants((n, pos) => {
      if (n.type.name === 'codeBlock') {
        emptyStart = pos + 1
        emptyEnd = pos + n.nodeSize - 1
        return false
      }
      return true
    })
    edEmpty.commands.setTextSelection(emptyStart)
    assert.equal(
      codeBlockSelectAll(edEmpty),
      false,
      'empty block has no text to select, falls through'
    )
    edEmpty.destroy()
  }
  ed.destroy()
}

// mermaid suggestion markers
{
  assert.equal(
    suggestLanguage('flowchart TD\n  A[Start] --> B[End]\n'),
    'mermaid',
    'flowchart suggests mermaid'
  )
  assert.equal(
    suggestLanguage('sequenceDiagram\n  Alice->>Bob: Hi\n'),
    'mermaid',
    'sequenceDiagram suggests mermaid'
  )
  assert.equal(
    suggestLanguage('  gantt\n  title Plan\n  section S\n'),
    'mermaid',
    'indented gantt suggests mermaid'
  )
  assert.equal(
    suggestLanguage('graph TD; A-->B;'),
    'mermaid',
    'legacy graph syntax suggests mermaid'
  )
}

console.log('MERMAID TESTS PASSED — language round-trip, transient mode attr, suggestions')
