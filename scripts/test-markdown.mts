import assert from 'node:assert/strict'
import { Markdown } from '@tiptap/markdown'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import Typography from '@tiptap/extension-typography'
import { TableKit } from '@tiptap/extension-table'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight } from 'lowlight'

const lowlight = createLowlight()

const md = `# Welcome to PTNotes

This is your first note. Everything you write here is stored as markdown in:

\`notes/welcome.md\`

## Getting started

- Click **+ New** in the **Notes** tab to create a new note.
- Use the **Kanban** tab to keep track of your tasks.
- Open the **AI assistant** (💬 chat icon, top-right) to create or update notes and kanban cards, or research the web and save the findings here.`

const manager = new MarkdownManager({
  extensions: [StarterKit, Markdown, Typography, Link, TaskList, TaskItem, TableKit]
})

const json = manager.parse(md)
const nodeTypes = json.content.map((n: { type: string }) => n.type)
assert.ok(nodeTypes.includes('heading'), `expected heading, got ${nodeTypes.join(',')}`)
assert.equal(json.content[0].type, 'heading')
assert.ok(nodeTypes.includes('bulletList'), `expected bulletList, got ${nodeTypes.join(',')}`)

const serialized = manager.serialize(json)
assert.equal(serialized.replace(/\s+/g, ' '), md.replace(/\s+/g, ' '))
console.log('MARKDOWN PARSE/SERIALIZE OK — headings and lists preserved')

const tableMd = `| Name | Age | City |
|------|-----|------|
| Alice | 30 | Paris |
| Bob | 25 | Bangkok |
`
const tableJson = manager.parse(tableMd)
const tableNode = tableJson.content.find((n: { type: string }) => n.type === 'table')
assert.ok(
  tableNode,
  'expected a table node, got ' + tableJson.content.map((n: { type: string }) => n.type).join(',')
)
const nestedTypes = (tableNode as { content?: { type: string }[] }).content?.map((n) => n.type)
assert.deepEqual(nestedTypes, ['tableRow', 'tableRow', 'tableRow'])
const headerRow = (tableNode as { content: { content: { type: string }[] }[] }).content[0].content
assert.ok(
  headerRow.every((c) => c.type === 'tableHeader'),
  `expected tableHeader row, got ${headerRow.map((c) => c.type).join(',')}`
)
const bodyRow = (tableNode as { content: { content: { type: string }[] }[] }).content[1].content
assert.ok(
  bodyRow.every((c) => c.type === 'tableCell'),
  `expected tableCell row, got ${bodyRow.map((c) => c.type).join(',')}`
)

const tableSerialized = manager.serialize(tableJson)
assert.ok(tableSerialized.includes('| Name'), 'serialized table keeps header cells')
assert.equal(
  manager.serialize(manager.parse(tableSerialized)),
  tableSerialized,
  'table round-trip is idempotent'
)
console.log('MARKDOWN TABLE OK — parsed + round-trips')

const underlineJson = manager.parse('some ++under++ and **bold** text')
const underlineText = underlineJson.content[0].content as {
  text: string
  marks?: { type: string }[]
}[]
assert.ok(
  underlineText[1].marks?.some((m) => m.type === 'underline'),
  'expected an underline mark on the ++..++ segment'
)
assert.equal(
  manager.serialize(underlineJson),
  'some ++under++ and **bold** text',
  'underline round-trips as ++..++'
)
console.log('MARKDOWN UNDERLINE OK — parsed + round-trips as ++..++')

// Code-block notes: must not throw on parse (blank screen regression) and must round-trip
// Uses the same custom CodeBlockLowlight config as MarkdownEditor.tsx (field-style parseMarkdown)
const safeLanguage = (lang: string | null | undefined): string => lang || 'text'
const CodeBlockLowlight2 = CodeBlockLowlight.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      lowlight,
      defaultLanguage: 'text'
    }
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
const codeManager = new MarkdownManager({
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    CodeBlockLowlight2,
    Markdown,
    Typography,
    Link,
    TaskList,
    TaskItem,
    TableKit
  ]
})
const codeMd = 'before\n\n```ts\nconst a = 1\nconsole.log(a)\n```\n\nafter\n'
const codeJson = codeManager.parse(codeMd)
const codeNode = codeJson.content.find((n: { type: string }) => n.type === 'codeBlock') as
  { attrs: { language?: string }; content?: { text?: string }[] } | undefined
assert.ok(
  codeNode,
  'expected a codeBlock node, got ' + codeJson.content.map((n) => n.type).join(',')
)
assert.equal(codeNode!.attrs.language, 'ts', 'fenced code keeps its language')
assert.equal(codeNode!.content?.[0].text, 'const a = 1\nconsole.log(a)')
assert.equal(
  codeManager.serialize(codeJson).replace(/\s+/g, ' ').trim(),
  codeMd.replace(/\s+/g, ' ').trim(),
  'code fence round-trips'
)

const indentedJson = codeManager.parse('para:\n\n    const a = 1\n')
const indentedNode = (indentedJson.content as { type: string }[]).find(
  (n) => n.type === 'codeBlock'
) as { attrs?: { language?: string } } | undefined
assert.ok(indentedNode, 'indented code parses into a codeBlock without throwing')

// Language semantics: '' = unlabeled (auto later), 'text' = explicit Plain Text, others kept
const unlabeledJson = codeManager.parse('before\n\n```\nno lang\n```\n\nafter\n')
const unlabeledNode = (
  unlabeledJson.content as {
    type: string
    attrs?: { language?: string }
  }[]
).find((n) => n.type === 'codeBlock') as { attrs?: { language?: string } } | undefined
assert.ok(unlabeledNode, 'unlabeled fence parses')
assert.equal(
  unlabeledNode!.attrs?.language,
  '',
  'unlabeled fence stores empty language (no text forcing)'
)
const unlabeledSer = codeManager.serialize(unlabeledJson)
assert.ok(
  /```\n(?:no lang\n)?```/.test(unlabeledSer.trim()) && !unlabeledSer.includes('```text'),
  'unlabeled fence serializes without a language label'
)

const explicitTextJson = codeManager.parse('```\ntext\n```\n\nbefore\n\n```text\nfixed\n```\n')
const textNodes = (
  explicitTextJson.content as {
    type: string
    attrs?: { language?: string }
  }[]
).filter((n) => n.type === 'codeBlock')
assert.equal(textNodes[1]?.attrs?.language, 'text', 'explicit ```text fence keeps text attr')
assert.ok(
  codeManager.serialize(explicitTextJson).includes('```text'),
  'explicit text label survives serialization'
)
console.log('MARKDOWN CODE LANGUAGE OK — unlabeled is empty, explicit text preserved')
