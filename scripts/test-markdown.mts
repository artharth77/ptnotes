import assert from 'node:assert/strict'
import { Markdown } from '@tiptap/markdown'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import Typography from '@tiptap/extension-typography'
import { TableKit } from '@tiptap/extension-table'

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
