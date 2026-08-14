import { useEffect, useRef, useState } from 'react'
import {
  mdiCodeBraces,
  mdiCodeTags,
  mdiFormatBold,
  mdiFormatHeader1,
  mdiFormatHeader2,
  mdiFormatHeader3,
  mdiFormatItalic,
  mdiFormatListBulleted,
  mdiFormatListChecks,
  mdiFormatListNumbered,
  mdiFormatQuoteOpen,
  mdiFormatStrikethroughVariant,
  mdiLinkVariant,
  mdiMinus,
  mdiRedoVariant,
  mdiTableColumnPlusAfter,
  mdiTableColumnPlusBefore,
  mdiTableColumnRemove,
  mdiTablePlus,
  mdiTableRemove,
  mdiTableRowPlusAfter,
  mdiTableRowPlusBefore,
  mdiTableRowRemove,
  mdiUndoVariant
} from '@mdi/js'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { useAppStore } from '../store/useAppStore'
import { PromptModal } from './Modal'
import { MdiIcon } from './MdiIcon'

interface MarkdownEditorProps {
  noteId: string
  content: string
}

function ToolbarBtn({
  icon,
  title,
  active,
  onClick,
  disabled
}: {
  icon: string
  title?: string
  active?: boolean
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`tb-btn ${active ? 'active' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <MdiIcon path={icon} size={16} />
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
      TaskItem.configure({ nested: true }),
      TableKit
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
        isTable: ed.isActive('table'),
        canDeleteColumn: ed.can().deleteColumn(),
        canDeleteRow: ed.can().deleteRow(),
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo()
      }
    }
  })

  const [linkPrompt, setLinkPrompt] = useState(false)
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!tableMenu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setTableMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tableMenu])

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
          icon={mdiFormatHeader1}
          title="Heading 1"
          active={state.isH1}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        />
        <ToolbarBtn
          icon={mdiFormatHeader2}
          title="Heading 2"
          active={state.isH2}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarBtn
          icon={mdiFormatHeader3}
          title="Heading 3"
          active={state.isH3}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <span className="tb-sep" />
        <ToolbarBtn
          icon={mdiFormatBold}
          title="Bold"
          active={state.isBold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarBtn
          icon={mdiFormatItalic}
          title="Italic"
          active={state.isItalic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarBtn
          icon={mdiFormatStrikethroughVariant}
          title="Strikethrough"
          active={state.isStrike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolbarBtn
          icon={mdiCodeTags}
          title="Inline code"
          active={state.isCode}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />
        <span className="tb-sep" />
        <ToolbarBtn
          icon={mdiFormatListBulleted}
          title="Bullet list"
          active={state.isBullet}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarBtn
          icon={mdiFormatListNumbered}
          title="Numbered list"
          active={state.isOrdered}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarBtn
          icon={mdiFormatListChecks}
          title="Task list"
          active={state.isTask}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        />
        <span className="tb-sep" />
        <ToolbarBtn
          icon={mdiFormatQuoteOpen}
          title="Blockquote"
          active={state.isQuote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarBtn
          icon={mdiCodeBraces}
          title="Code block"
          active={state.isCodeBlock}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
        <ToolbarBtn icon={mdiLinkVariant} title="Link" onClick={toggleLink} />
        <ToolbarBtn
          icon={mdiTablePlus}
          title="Insert table"
          active={state.isTable}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        />
        {state.isTable && (
          <>
            <span className="tb-sep" />
            <ToolbarBtn
              icon={mdiTableColumnPlusBefore}
              title="Insert column before"
              onClick={() => editor.chain().focus().addColumnBefore().run()}
            />
            <ToolbarBtn
              icon={mdiTableColumnPlusAfter}
              title="Insert column after"
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            />
            <ToolbarBtn
              icon={mdiTableColumnRemove}
              title="Delete column"
              disabled={!state.canDeleteColumn}
              onClick={() => editor.chain().focus().deleteColumn().run()}
            />
            <ToolbarBtn
              icon={mdiTableRowPlusBefore}
              title="Insert row before"
              onClick={() => editor.chain().focus().addRowBefore().run()}
            />
            <ToolbarBtn
              icon={mdiTableRowPlusAfter}
              title="Insert row after"
              onClick={() => editor.chain().focus().addRowAfter().run()}
            />
            <ToolbarBtn
              icon={mdiTableRowRemove}
              title="Delete row"
              disabled={!state.canDeleteRow}
              onClick={() => editor.chain().focus().deleteRow().run()}
            />
            <ToolbarBtn
              icon={mdiTableRemove}
              title="Delete table"
              onClick={() => editor.chain().focus().deleteTable().run()}
            />
          </>
        )}
        <ToolbarBtn
          icon={mdiMinus}
          title="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />
        <span className="tb-sep" />
        <ToolbarBtn
          icon={mdiUndoVariant}
          title="Undo"
          disabled={!state.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarBtn
          icon={mdiRedoVariant}
          title="Redo"
          disabled={!state.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </div>
      <EditorContent
        editor={editor}
        className="editor-content"
        onContextMenu={(e) => {
          const target = e.target instanceof Element ? e.target : null
          if (!target?.closest('table')) {
            setTableMenu(null)
            return
          }
          e.preventDefault()
          const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
          if (coords) editor.commands.setTextSelection(coords.pos)
          setTableMenu({
            x: Math.min(e.clientX, window.innerWidth - 200),
            y: Math.min(e.clientY, window.innerHeight - 280)
          })
        }}
      />
      <div className="editor-meta">
        Saving to <code>notes/{noteId}.md</code> · markdown
      </div>
      {tableMenu && state.isTable && (
        <>
          <div
            className="menu-overlay"
            onClick={() => setTableMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setTableMenu(null)
            }}
          />
          <div
            className="note-menu"
            style={{ left: tableMenu.x, top: tableMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="note-menu-item"
              onClick={() => {
                editor.chain().focus().addColumnBefore().run()
                setTableMenu(null)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiTableColumnPlusBefore} size={16} />
              </span>
              Insert column before
            </button>
            <button
              className="note-menu-item"
              onClick={() => {
                editor.chain().focus().addColumnAfter().run()
                setTableMenu(null)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiTableColumnPlusAfter} size={16} />
              </span>
              Insert column after
            </button>
            <button
              className="note-menu-item"
              disabled={!state.canDeleteColumn}
              onClick={() => {
                editor.chain().focus().deleteColumn().run()
                setTableMenu(null)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiTableColumnRemove} size={16} />
              </span>
              Delete column
            </button>
            <div className="note-menu-sep" />
            <button
              className="note-menu-item"
              onClick={() => {
                editor.chain().focus().addRowBefore().run()
                setTableMenu(null)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiTableRowPlusBefore} size={16} />
              </span>
              Insert row before
            </button>
            <button
              className="note-menu-item"
              onClick={() => {
                editor.chain().focus().addRowAfter().run()
                setTableMenu(null)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiTableRowPlusAfter} size={16} />
              </span>
              Insert row after
            </button>
            <button
              className="note-menu-item"
              disabled={!state.canDeleteRow}
              onClick={() => {
                editor.chain().focus().deleteRow().run()
                setTableMenu(null)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiTableRowRemove} size={16} />
              </span>
              Delete row
            </button>
            <div className="note-menu-sep" />
            <button
              className="note-menu-item danger"
              onClick={() => {
                editor.chain().focus().deleteTable().run()
                setTableMenu(null)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiTableRemove} size={16} />
              </span>
              Delete table
            </button>
          </div>
        </>
      )}
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
