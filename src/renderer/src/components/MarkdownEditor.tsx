import { useEffect, useRef, useState } from 'react'
import {
  mdiCodeBraces,
  mdiCodeTags,
  mdiCloseCircle,
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
  mdiFormatText,
  mdiFormatUnderline,
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
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { PluginKey } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import Link from '@tiptap/extension-link'
import { mergeAttributes } from '@tiptap/core'

const CustomLink = Link.extend({
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'editor-link' }), 0]
  }
})
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { useAppStore } from '../store/useAppStore'
import { slugify } from '@shared/slug'
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

const bubbleMenuKey = new PluginKey('formatHelperBubble')

function internalNameFromHref(href: string, prefix: string): string {
  const raw = href.slice(prefix.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function linkTooltipLabel(href: string): string {
  if (href.startsWith('note:')) return `Open note: ${slugify(internalNameFromHref(href, 'note:'))}`
  if (href.startsWith('skill:'))
    return `Open skill: ${slugify(internalNameFromHref(href, 'skill:'))}`
  if (href.startsWith('file:')) return `Open file location: ${internalNameFromHref(href, 'file:')}`
  return `Open link: ${href}`
}

function handleEditorLink(href: string): void {
  if (href.startsWith('note:')) {
    const name = slugify(internalNameFromHref(href, 'note:'))
    const st = useAppStore.getState()
    const note =
      st.notes.find((n) => n.id === name) ??
      st.notes.find((n) => n.name === name) ??
      st.notes.find((n) => n.name.includes(name))
    if (!note) return
    void st.selectNote(note.id)
    st.setTab('notes')
  } else if (href.startsWith('skill:')) {
    const name = slugify(internalNameFromHref(href, 'skill:'))
    useAppStore.getState().openSkillEditor(name)
  } else if (href.startsWith('file:')) {
    const name = internalNameFromHref(href, 'file:')
    const project = useAppStore.getState().activeProject
    if (project) void window.ptnotes.files.revealByName(project, name)
  } else {
    try {
      const parsed = new URL(href)
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        window.open(href, '_blank')
      }
    } catch {
      // Invalid URL, ignore
    }
  }
}

function FormatButtons({
  editor,
  state,
  withLabels,
  onRun
}: {
  editor: Editor
  state: {
    isBold: boolean
    isItalic: boolean
    isUnderline: boolean
    isStrike: boolean
    isCode: boolean
  }
  withLabels?: boolean
  onRun?: () => void
}): React.JSX.Element {
  const items = [
    {
      icon: mdiFormatBold,
      label: 'Bold',
      active: state.isBold,
      run: () => editor.chain().focus().toggleBold().run()
    },
    {
      icon: mdiFormatItalic,
      label: 'Italic',
      active: state.isItalic,
      run: () => editor.chain().focus().toggleItalic().run()
    },
    {
      icon: mdiFormatUnderline,
      label: 'Underline',
      active: state.isUnderline,
      run: () => editor.chain().focus().toggleUnderline().run()
    },
    {
      icon: mdiFormatStrikethroughVariant,
      label: 'Strikethrough',
      active: state.isStrike,
      run: () => editor.chain().focus().toggleStrike().run()
    },
    {
      icon: mdiCodeTags,
      label: 'Inline code',
      active: state.isCode,
      run: () => editor.chain().focus().toggleCode().run()
    }
  ]
  if (withLabels) {
    return (
      <>
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            className={`note-menu-item ${it.active ? 'active' : ''}`}
            onClick={() => {
              it.run()
              onRun?.()
            }}
          >
            <span className="note-menu-icon">
              <MdiIcon path={it.icon} size={16} />
            </span>
            {it.label}
          </button>
        ))}
      </>
    )
  }
  return (
    <>
      {items.map((it) => (
        <ToolbarBtn
          key={it.label}
          icon={it.icon}
          title={it.label}
          active={it.active}
          onClick={() => {
            it.run()
            onRun?.()
          }}
        />
      ))}
    </>
  )
}

export function MarkdownEditor({ noteId, content }: MarkdownEditorProps): React.JSX.Element {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appliedContent = useRef(content)
  const formatHelperEnabled = useAppStore((s) => s.formatHelperEnabled)
  const setFormatHelperEnabled = useAppStore((s) => s.setFormatHelperEnabled)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        indentation: { style: 'space', size: 2 }
      }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Typography,
      CustomLink.configure({
        openOnClick: false,
        autolink: true,
        protocols: ['note', 'skill', 'file']
      }),
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
        isUnderline: ed.isActive('underline'),
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
  const [formatMenu, setFormatMenu] = useState<{ x: number; y: number } | null>(null)
  const [rawMode, setRawMode] = useState(false)
  const [rawText, setRawText] = useState('')
  const [modKeyDown, setModKeyDown] = useState(false)
  const [linkTooltip, setLinkTooltip] = useState<{ label: string; x: number; y: number } | null>(
    null
  )

  useEffect(() => {
    if (!tableMenu && !formatMenu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setTableMenu(null)
        setFormatMenu(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tableMenu, formatMenu])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Meta' || e.key === 'Control') setModKeyDown(true)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Meta' || e.key === 'Control') setModKeyDown(false)
    }
    const onBlur = (): void => setModKeyDown(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onMove = (e: MouseEvent): void => {
      if (!e.metaKey && !e.ctrlKey) {
        setLinkTooltip(null)
        return
      }
      const target = e.target instanceof Element ? e.target : null
      const link = target?.closest('.editor-link')
      if (!link) {
        setLinkTooltip(null)
        return
      }
      const href = link.getAttribute('href') ?? ''
      setLinkTooltip({ label: linkTooltipLabel(href), x: e.clientX, y: e.clientY })
    }
    const onLeave = (): void => setLinkTooltip(null)
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Meta' || e.key === 'Control') setLinkTooltip(null)
    }
    dom.addEventListener('mousemove', onMove)
    dom.addEventListener('mouseleave', onLeave)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      dom.removeEventListener('mousemove', onMove)
      dom.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [editor])
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onClick = (e: MouseEvent): void => {
      const target = e.target instanceof Element ? e.target : null
      const link = target?.closest('.editor-link')
      if (!link) return

      const href = link.getAttribute('href') ?? ''
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        handleEditorLink(href)
      } else {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    dom.addEventListener('click', onClick, true)
    return () => dom.removeEventListener('click', onClick, true)
  }, [editor])

  if (!editor) {
    return <div className="editor empty-state">Loading editor…</div>
  }

  function toggleLink(): void {
    setLinkPrompt(true)
  }

  function toggleRaw(): void {
    if (rawMode) {
      editor.commands.setContent(rawText, { contentType: 'markdown', emitUpdate: false })
      setRawMode(false)
    } else {
      setRawText(editor.getMarkdown())
      setTableMenu(null)
      setFormatMenu(null)
      setRawMode(true)
    }
  }

  function handleRawChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const text = e.target.value
    setRawText(text)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void useAppStore.getState().saveNote(text)
    }, 800)
  }

  return (
    <div className="editor-wrap">
      {!rawMode && (
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
            icon={mdiFormatUnderline}
            title="Underline"
            active={state.isUnderline}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
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
      )}
      {rawMode ? (
        <textarea
          className="editor-raw"
          value={rawText}
          onChange={handleRawChange}
          spellCheck={false}
          autoFocus
        />
      ) : (
        <EditorContent
          editor={editor}
          className={`editor-content${modKeyDown ? ' mod-key-down' : ''}`}
          onContextMenu={(e) => {
            const target = e.target instanceof Element ? e.target : null
            if (target?.closest('table')) {
              setFormatMenu(null)
              e.preventDefault()
              const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
              if (coords) editor.commands.setTextSelection(coords.pos)
              setTableMenu({
                x: Math.min(e.clientX, window.innerWidth - 200),
                y: Math.min(e.clientY, window.innerHeight - 280)
              })
              return
            }
            e.preventDefault()
            const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
            if (coords) {
              const sel = editor.state.selection
              const insideSelection = !sel.empty && sel.from <= coords.pos && coords.pos <= sel.to
              if (!insideSelection) editor.commands.setTextSelection(coords.pos)
            }
            setTableMenu(null)
            setFormatMenu({
              x: Math.min(e.clientX, window.innerWidth - 220),
              y: Math.min(e.clientY, window.innerHeight - 280)
            })
            editor.view.dispatch(editor.state.tr.setMeta(bubbleMenuKey, 'hide'))
          }}
        />
      )}
      {!rawMode && formatHelperEnabled && (
        <BubbleMenu
          editor={editor}
          pluginKey={bubbleMenuKey}
          appendTo={() => document.body}
          shouldShow={({ view, state }) => {
            if (state.selection.empty) return false
            if (!view.hasFocus()) return false
            if (editor.isActive('table')) return false
            return true
          }}
        >
          <div className="bubble-menu">
            <FormatButtons editor={editor} state={state} />
            <button
              type="button"
              className="bubble-close"
              title="Turn off format helper"
              onClick={() => setFormatHelperEnabled(false)}
            >
              <MdiIcon path={mdiCloseCircle} size={16} />
            </button>
          </div>
        </BubbleMenu>
      )}
      <div className="editor-meta">
        <span>
          Saving to <code>notes/{noteId}.md</code> · markdown
        </span>
        <div className="editor-meta-actions">
          <button
            type="button"
            className={`format-helper-toggle ${rawMode ? 'active' : ''}`}
            title="Show raw markdown"
            onClick={toggleRaw}
          >
            RAW
          </button>
          <button
            type="button"
            className={`format-helper-toggle ${formatHelperEnabled ? 'active' : ''}`}
            title="Format helper"
            onClick={() => setFormatHelperEnabled(!formatHelperEnabled)}
          >
            <MdiIcon path={mdiFormatText} size={14} />
            Format helper
          </button>
        </div>
      </div>
      {!rawMode && tableMenu && state.isTable && (
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
      {!rawMode && formatMenu && (
        <>
          <div
            className="menu-overlay"
            onClick={() => setFormatMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setFormatMenu(null)
            }}
          />
          <div
            className="note-menu"
            style={{ left: formatMenu.x, top: formatMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <FormatButtons
              editor={editor}
              state={state}
              withLabels
              onRun={() => setFormatMenu(null)}
            />
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
      {linkTooltip && (
        <div className="editor-link-tooltip" style={{ left: linkTooltip.x, top: linkTooltip.y }}>
          {linkTooltip.label}
        </div>
      )}
    </div>
  )
}
