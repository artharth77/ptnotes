import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { useAppStore } from '../store/useAppStore'
import { PromptModal } from './Modal'

interface MarkdownEditorProps {
  noteId: string
  content: string
}

function ToolbarBtn({
  label,
  title,
  active,
  onClick,
  disabled
}: {
  label: string
  title?: string
  active?: boolean
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`tb-btn ${active ? 'active' : ''}`}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function MarkdownEditor({ noteId, content }: MarkdownEditorProps): React.JSX.Element {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appliedContent = useRef(content)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        indentation: { style: 'space', size: 2 }
      }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Typography,
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true })
    ],
    content,
    contentType: 'markdown',
    onUpdate({ editor: e }) {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void useAppStore.getState().saveNote(e.getMarkdown())
      }, 800)
    }
  })

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!editor) return
    if (content !== appliedContent.current) {
      appliedContent.current = content
      editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false })
    }
  }, [editor, content])

  const state = useEditorState({
    editor,
    selector: (ctx) => {
      const ed = ctx.editor
      return {
        isBold: ed.isActive('bold'),
        isItalic: ed.isActive('italic'),
        isStrike: ed.isActive('strike'),
        isCode: ed.isActive('code'),
        isBullet: ed.isActive('bulletList'),
        isOrdered: ed.isActive('orderedList'),
        isTask: ed.isActive('taskList'),
        isQuote: ed.isActive('blockquote'),
        isCodeBlock: ed.isActive('codeBlock'),
        isH1: ed.isActive('heading', { level: 1 }),
        isH2: ed.isActive('heading', { level: 2 }),
        isH3: ed.isActive('heading', { level: 3 }),
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo()
      }
    }
  })

  const [linkPrompt, setLinkPrompt] = useState(false)

  if (!editor) {
    return <div className="editor empty-state">Loading editor…</div>
  }

  function toggleLink(): void {
    setLinkPrompt(true)
  }

  return (
    <div className="editor-wrap">
      <div className="editor-toolbar">
        <ToolbarBtn
          label="H1"
          active={state.isH1}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        />
        <ToolbarBtn
          label="H2"
          active={state.isH2}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarBtn
          label="H3"
          active={state.isH3}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <span className="tb-sep" />
        <ToolbarBtn
          label="B"
          title="Bold"
          active={state.isBold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarBtn
          label="I"
          title="Italic"
          active={state.isItalic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarBtn
          label="S"
          title="Strikethrough"
          active={state.isStrike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolbarBtn
          label="<>"
          title="Inline code"
          active={state.isCode}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />
        <span className="tb-sep" />
        <ToolbarBtn
          label="• List"
          active={state.isBullet}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarBtn
          label="1. List"
          active={state.isOrdered}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarBtn
          label="☑"
          title="Task list"
          active={state.isTask}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        />
        <span className="tb-sep" />
        <ToolbarBtn
          label="❝"
          title="Blockquote"
          active={state.isQuote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarBtn
          label="{ }"
          title="Code block"
          active={state.isCodeBlock}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
        <ToolbarBtn label="🔗" title="Link" onClick={toggleLink} />
        <ToolbarBtn
          label="―"
          title="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />
        <span className="tb-sep" />
        <ToolbarBtn
          label="↶"
          title="Undo"
          disabled={!state.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarBtn
          label="↷"
          title="Redo"
          disabled={!state.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </div>
      <EditorContent editor={editor} className="editor-content" />
      <div className="editor-meta">
        Saving to <code>notes/{noteId}.md</code> · markdown
      </div>
      {linkPrompt && (
        <PromptModal
          title="Link URL"
          placeholder="https://…"
          initialValue={String(editor.getAttributes('link').href ?? '')}
          submitLabel="Insert"
          onClose={() => setLinkPrompt(false)}
          onSubmit={(url) => {
            setLinkPrompt(false)
            editor.chain().focus().setLink({ href: url }).run()
          }}
        />
      )}
    </div>
  )
}
