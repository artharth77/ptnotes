import assert from 'node:assert/strict'
import { Markdown } from '@tiptap/markdown'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import Typography from '@tiptap/extension-typography'

const md = `# Welcome to PTNotes

This is your first note. Everything you write here is stored as markdown in:

\`notes/welcome.md\`

## Getting started

- Click **+ New** in the **Notes** tab to create a new note.
- Use the **Todo** tab to keep track of your tasks.
- Open the **AI assistant** (💬 chat icon, top-right) to create or update notes and todos, or research the web and save the findings here.`

const manager = new MarkdownManager({
  extensions: [StarterKit, Markdown, Typography, Link, TaskList, TaskItem]
})

const json = manager.parse(md)
const nodeTypes = json.content.map((n: { type: string }) => n.type)
assert.ok(nodeTypes.includes('heading'), `expected heading, got ${nodeTypes.join(',')}`)
assert.equal(json.content[0].type, 'heading')
assert.ok(nodeTypes.includes('bulletList'), `expected bulletList, got ${nodeTypes.join(',')}`)

const serialized = manager.serialize(json)
assert.equal(serialized.replace(/\s+/g, ' '), md.replace(/\s+/g, ' '))
console.log('MARKDOWN PARSE/SERIALIZE OK — headings and lists preserved')
