import { useEffect, useMemo, useRef, useState } from 'react'
import {
  mdiCodeBraces,
  mdiCodeJson,
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
  mdiChevronDown,
  mdiChevronDoubleLeft,
  mdiChevronUp,
  mdiClose,
  mdiFileReplaceOutline,
  mdiFindReplace,
  mdiFormatLetterCase,
  mdiImageOutline,
  mdiLinkVariant,
  mdiMagnify,
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
  mdiUndoVariant,
  mdiXml
} from '@mdi/js'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { PluginKey, TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import Link from '@tiptap/extension-link'
import { mergeAttributes } from '@tiptap/core'
import type { VirtualElement } from '@floating-ui/dom'
import { isImageFile } from '@shared/filesExplorer'

const CustomLink = Link.extend({
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'editor-link' }), 0]
  }
})
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { suggestLanguage } from '../editor/lowlightRegistry'
import { codeBlockSelectAll } from '../editor/mermaidCodeBlock'
import { MermaidCodeBlock } from '../editor/mermaidNodeView'
import { EditorImage } from '../editor/imageNodeView'
import { GalleryModal } from './GalleryModal'
import { toggleCodeBlockMerged } from '../editor/codeBlockToggle'
import { isJsonText, prettyJsonInCodeBlock } from '../editor/jsonFormat'
import { isMarkupText, prettyMarkupInCodeBlock, type MarkupMode } from '../editor/markupFormat'
import { SUPPORTED_LANGUAGES } from '../editor/supportedLanguages'
import { useAppStore } from '../store/useAppStore'
import { slugify } from '@shared/slug'
import { PromptModal } from './Modal'
import { MdiIcon } from './MdiIcon'
import {
  FindReplace,
  clearFind,
  findStep,
  getFindState,
  replaceAll,
  replaceCurrent,
  setFind
} from '../editor/findReplace'

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
const codeBlockLangMenuKey = new PluginKey('codeBlockLangBubble')

function getCodeBlockAtCursor(editor: Editor): {
  pos: number
  text: string
  langRaw: string | undefined
} | null {
  const $from = editor.state.selection.$from
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'codeBlock') {
      return {
        pos: $from.before(d),
        text: node.textContent,
        langRaw: node.attrs.language as string | undefined
      }
    }
  }
  return null
}

function applyCodeBlockLang(editor: Editor, nextLang: string): void {
  const restore = editor.state.selection
  const block = getCodeBlockAtCursor(editor)
  if (!block) return
  editor
    .chain()
    .setNodeSelection(block.pos)
    .updateAttributes('codeBlock', { language: nextLang })
    .setTextSelection(restore.empty ? restore.$from.pos : { from: restore.from, to: restore.to })
    .focus()
    .run()
}

function getLangMenuAnchor(editor: Editor): VirtualElement | null {
  if (!editor.isActive('codeBlock')) return null
  const block = getCodeBlockAtCursor(editor)
  if (!block) return null
  const resolved = editor.view.domAtPos(block.pos + 1)
  const raw = resolved.node
  let el: Element | null = raw instanceof Element ? raw : raw.parentElement
  el = el?.closest('pre.code-block-wrapper') ?? el?.closest('pre') ?? el
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (!rect.width && !rect.height) return null
  const container = el.closest<HTMLElement>('.editor-content')
  const cRect = container?.getBoundingClientRect()
  const top = Math.max(rect.top + 12, cRect ? cRect.top + 18 : rect.top + 12)
  const bottom = cRect ? Math.min(rect.bottom, cRect.bottom) : rect.bottom
  const left = Math.max(rect.left - 14, cRect ? cRect.left : rect.left - 14)
  const right = cRect ? Math.min(rect.right, cRect.right) : rect.right
  const elementRect = new DOMRect(left, top, Math.max(right - left, 1), Math.max(bottom - top, 1))
  return {
    getBoundingClientRect: () => elementRect,
    getClientRects: () => [elementRect]
  }
}

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
  if (href.startsWith('plan:') || href.startsWith('schedule:')) {
    const prefix = href.startsWith('plan:') ? 'plan:' : 'schedule:'
    return `Open plan: ${slugify(internalNameFromHref(href, prefix))}`
  }
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
  } else if (href.startsWith('plan:') || href.startsWith('schedule:')) {
    const prefix = href.startsWith('plan:') ? 'plan:' : 'schedule:'
    const name = slugify(internalNameFromHref(href, prefix))
    const st = useAppStore.getState()
    const plan =
      st.schedules.find((s) => s.id === name) ??
      st.schedules.find((s) => s.name === name) ??
      st.schedules.find((s) => s.name.includes(name))
    if (!plan) return
    void st.selectSchedule(plan.id)
    st.setTab('planner')
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

function altFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function altFromGalleryName(name: string): string {
  return altFromFileName(name.replace(/^[0-9a-f]{16}-/, ''))
}

interface InsertedImage {
  name: string
  alt: string
}

/** Copy image files into the project gallery; returns the stored names. */
async function importImagesToGallery(files: File[]): Promise<InsertedImage[]> {
  const project = useAppStore.getState().activeProject
  if (!project) return []
  const out: InsertedImage[] = []
  for (const file of files) {
    const path = window.ptnotes.files.getPathForFile(file)
    try {
      const name = path
        ? await window.ptnotes.gallery.import(project, path, file.name)
        : await window.ptnotes.gallery.importData(
            project,
            file.name,
            new Uint8Array(await file.arrayBuffer())
          )
      out.push({ name, alt: altFromFileName(file.name) })
    } catch {
      // skip files the gallery rejects
    }
  }
  return out
}

/** Insert image nodes at the current selection (or `coords`) in one transaction. */
function insertImageNodes(
  view: Editor['view'],
  images: InsertedImage[],
  coords?: { left: number; top: number }
): void {
  if (view.isDestroyed) return
  const nodeType = view.state.schema.nodes.image
  if (!nodeType) return
  let tr = view.state.tr
  if (coords) {
    const pos = view.posAtCoords(coords)
    if (pos) tr = tr.setSelection(TextSelection.near(view.state.doc.resolve(pos.pos)))
  }
  for (const img of images) {
    tr = tr.replaceSelectionWith(nodeType.create({ src: `images/${img.name}`, alt: img.alt }))
  }
  view.dispatch(tr.scrollIntoView())
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
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null)
  const appliedContent = useRef(content)
  const onUpdateCount = useRef(0)
  const txCount = useRef(0)
  const formatHelperEnabled = useAppStore((s) => s.formatHelperEnabled)
  const setFormatHelperEnabled = useAppStore((s) => s.setFormatHelperEnabled)

  useEffect(() => {
    onUpdateCount.current = 0
    txCount.current = 0
  }, [noteId])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      MermaidCodeBlock,
      EditorImage,
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
      TableKit,
      FindReplace
    ],
    content,
    contentType: 'markdown',
    editorProps: {
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => isImageFile(f.name))
        if (!files.length) return false
        event.preventDefault()
        const coords = { left: event.clientX, top: event.clientY }
        void importImagesToGallery(files).then((images) => {
          if (images.length) insertImageNodes(view, images, coords)
        })
        return true
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          isImageFile(f.name)
        )
        if (!files.length) return false
        event.preventDefault()
        void importImagesToGallery(files).then((images) => {
          if (images.length) insertImageNodes(view, images)
        })
        return true
      }
    },
    onTransaction() {
      txCount.current += 1
    },
    onUpdate({ editor: e }) {
      onUpdateCount.current += 1
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
    if (!contentEl) return
    const reposition = (): void => {
      editor.view.dispatch(
        editor.state.tr
          .setMeta(codeBlockLangMenuKey, 'updatePosition')
          .setMeta(bubbleMenuKey, 'updatePosition')
      )
    }
    const onScroll = (): void => reposition()
    contentEl.addEventListener('scroll', onScroll, true)
    return () => contentEl.removeEventListener('scroll', onScroll, true)
  }, [contentEl, editor])

  useEffect(() => {
    if (!contentEl) return
    const reposition = (): void => {
      editor.view.dispatch(
        editor.state.tr
          .setMeta(codeBlockLangMenuKey, 'updatePosition')
          .setMeta(bubbleMenuKey, 'updatePosition')
      )
    }
    const observer = new ResizeObserver(reposition)
    observer.observe(contentEl)
    return () => observer.disconnect()
  }, [contentEl, editor])

  useEffect(() => {
    if (!editor) return
    if (content !== appliedContent.current) {
      appliedContent.current = content
      try {
        editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false })
      } catch {
        /* ignore */
      }
    }
  }, [editor, content])

  const state = useEditorState({
    editor,
    selector: (ctx) => {
      const ed = ctx.editor
      const cb = getCodeBlockAtCursor(ed)
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
        codeBlockLang: cb ? (cb.langRaw ?? '') : null,
        codeBlockText: cb ? cb.text : null,
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

  const findState = useEditorState({
    editor,
    selector: (ctx) => {
      const st = getFindState(ctx.editor)
      return { count: st.results.length, index: st.index }
    }
  })

  const cbLang = state?.codeBlockLang
  const cbText = state?.codeBlockText
  const suggestedLang = useMemo(
    () => (cbLang === '' ? suggestLanguage(cbText ?? '') : null),
    [cbLang, cbText]
  )
  const showPrettyJson =
    cbLang === 'json' || (cbLang === '' && suggestedLang === 'json' && isJsonText(cbText ?? ''))
  const markupMode: MarkupMode | null =
    cbLang === 'html'
      ? 'html'
      : cbLang === 'xml'
        ? 'xml'
        : cbLang === '' && (suggestedLang === 'html' || suggestedLang === 'xml')
          ? (suggestedLang as MarkupMode)
          : null
  const showPrettyMarkup = markupMode != null && isMarkupText(cbText ?? '', markupMode)

  const [linkPrompt, setLinkPrompt] = useState(false)
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null)
  const [formatMenu, setFormatMenu] = useState<{ x: number; y: number } | null>(null)
  const [rawMode, setRawMode] = useState(false)
  const [rawText, setRawText] = useState('')
  const [modKeyDown, setModKeyDown] = useState(false)
  const [linkTooltip, setLinkTooltip] = useState<{ label: string; x: number; y: number } | null>(
    null
  )
  const [findOpen, setFindOpen] = useState(false)
  const [findTerm, setFindTerm] = useState('')
  const [replaceTerm, setReplaceTerm] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const findInputRef = useRef<HTMLInputElement | null>(null)

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

  useEffect(() => {
    if (!editor) return
    if (findTerm) {
      setFind(editor, findTerm, matchCase)
    } else {
      clearFind(editor)
    }
  }, [editor, findTerm, matchCase])

  useEffect(() => {
    if (!editor) return
    if (!findOpen) clearFind(editor)
  }, [editor, findOpen])

  // Menu Select All routing: caret inside a code block selects that block only,
  // everything else falls back to the native select-all behavior.
  useEffect(() => {
    if (!editor) return
    const off = window.ptnotes.onSelectAll(() => {
      if (!rawMode && editor.view.hasFocus() && codeBlockSelectAll(editor)) return
      document.execCommand('selectAll')
    })
    return off
  }, [editor, rawMode])

  useEffect(() => {
    if (findOpen && !rawMode) findInputRef.current?.focus()
  }, [findOpen, rawMode])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        if (rawMode) return
        e.preventDefault()
        e.stopPropagation()
        if (findOpen) {
          findInputRef.current?.focus()
          findInputRef.current?.select()
        } else {
          setFindOpen(true)
        }
        return
      }
      if (e.key === 'Escape' && findOpen) {
        setFindOpen(false)
        editor?.commands.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [findOpen, rawMode, editor])

  if (!editor) {
    return <div className="editor empty-state">Loading editor…</div>
  }

  function toggleLink(): void {
    setLinkPrompt(true)
  }

  function insertGalleryNames(names: string[]): void {
    if (!editor || !names.length) return
    editor
      .chain()
      .focus()
      .insertContent(
        names.map((name) => ({
          type: 'image',
          attrs: { src: `images/${name}`, alt: altFromGalleryName(name) }
        }))
      )
      .run()
  }

  function toggleRaw(): void {
    if (rawMode) {
      editor.commands.setContent(rawText, { contentType: 'markdown', emitUpdate: false })
      setRawMode(false)
    } else {
      setRawText(editor.getMarkdown())
      setTableMenu(null)
      setFormatMenu(null)
      setFindOpen(false)
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
    <div
      className="editor-wrap"
      onDragOver={(e) => {
        if (rawMode || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropActive(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDropActive(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDropActive(false)
      }}
    >
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
            onClick={() => {
              editor.commands.focus()
              toggleCodeBlockMerged(editor)
            }}
          />
          <ToolbarBtn icon={mdiLinkVariant} title="Link" onClick={toggleLink} />
          <ToolbarBtn
            icon={mdiImageOutline}
            title="Insert image"
            onClick={() => setGalleryOpen(true)}
          />
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
            icon={mdiMagnify}
            title="Find"
            active={findOpen}
            onClick={() => setFindOpen(!findOpen)}
          />
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
      {!rawMode && findOpen && (
        <div className="find-bar">
          <input
            ref={findInputRef}
            className="find-input"
            value={findTerm}
            placeholder="Find"
            spellCheck={false}
            onChange={(e) => setFindTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                findStep(editor, 1)
              }
            }}
          />
          {findTerm && (
            <span className="find-count">
              {findState.count ? `${findState.index + 1}/${findState.count}` : '0/0'}
            </span>
          )}
          <button
            type="button"
            className="tb-btn"
            title="Previous match"
            disabled={!findState.count}
            onClick={() => findStep(editor, -1)}
          >
            <MdiIcon path={mdiChevronUp} size={16} />
          </button>
          <button
            type="button"
            className="tb-btn"
            title="Next match"
            disabled={!findState.count}
            onClick={() => findStep(editor, 1)}
          >
            <MdiIcon path={mdiChevronDown} size={16} />
          </button>
          <button
            type="button"
            className={`tb-btn ${matchCase ? 'active' : ''}`}
            title="Match case"
            onClick={() => setMatchCase(!matchCase)}
          >
            <MdiIcon path={mdiFormatLetterCase} size={16} />
          </button>
          <span className="tb-sep" />
          <input
            className="find-input find-replace-input"
            value={replaceTerm}
            placeholder="Replace"
            spellCheck={false}
            onChange={(e) => setReplaceTerm(e.target.value)}
          />
          <button
            type="button"
            className="tb-btn"
            title="Replace"
            disabled={!findState.count}
            onClick={() => replaceCurrent(editor, replaceTerm)}
          >
            <MdiIcon path={mdiFileReplaceOutline} size={16} />
          </button>
          <button
            type="button"
            className="tb-btn"
            title="Replace all"
            disabled={!findState.count}
            onClick={() => replaceAll(editor, replaceTerm)}
          >
            <MdiIcon path={mdiFindReplace} size={16} />
          </button>
          <span className="find-spacer" />
          <button
            type="button"
            className="tb-btn"
            title="Close find (Esc)"
            onClick={() => setFindOpen(false)}
          >
            <MdiIcon path={mdiClose} size={16} />
          </button>
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
          ref={setContentEl}
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
            if (editor.isActive('codeBlock')) return false
            if (editor.isActive('image')) return false
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
      {!rawMode && editor && (
        <BubbleMenu
          editor={editor}
          pluginKey={codeBlockLangMenuKey}
          appendTo={() => document.body}
          updateDelay={120}
          options={{ placement: 'top-start', offset: 0 }}
          getReferencedVirtualElement={() => getLangMenuAnchor(editor)}
          shouldShow={({ view }) => {
            if (!view.hasFocus()) return false
            return editor.isActive('codeBlock')
          }}
        >
          <div className="code-block-lang-menu">
            <span className="code-block-lang-label">Language</span>
            <select
              aria-label="Change code block language"
              value={state?.codeBlockLang ? state.codeBlockLang : 'text'}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                applyCodeBlockLang(editor, e.target.value)
              }}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
            {suggestedLang && (
              <button
                type="button"
                className="code-block-lang-suggest"
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => applyCodeBlockLang(editor, suggestedLang)}
              >
                <MdiIcon path={mdiChevronDoubleLeft} size={16} />
                suggest{' '}
                {SUPPORTED_LANGUAGES.find((l) => l.key === suggestedLang)?.label ?? suggestedLang}
              </button>
            )}
            {showPrettyJson && (
              <button
                type="button"
                className="code-block-lang-pretty"
                title="Pretty JSON"
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => prettyJsonInCodeBlock(editor)}
              >
                <MdiIcon path={mdiCodeJson} size={16} />
                Pretty JSON
              </button>
            )}
            {showPrettyMarkup && markupMode && (
              <button
                type="button"
                className="code-block-lang-pretty"
                title={`Pretty ${markupMode === 'html' ? 'HTML' : 'XML'}`}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => prettyMarkupInCodeBlock(editor, markupMode)}
              >
                <MdiIcon path={mdiXml} size={16} />
                Pretty {markupMode === 'html' ? 'HTML' : 'XML'}
              </button>
            )}
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
            <MdiIcon path={mdiFormatText} size={16} />
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
      {galleryOpen && (
        <GalleryModal
          onClose={() => setGalleryOpen(false)}
          onInsert={(names) => {
            setGalleryOpen(false)
            insertGalleryNames(names)
          }}
        />
      )}
      {!rawMode && dropActive && <div className="editor-drop-overlay">Drop images to insert</div>}
      {linkTooltip && (
        <div className="editor-link-tooltip" style={{ left: linkTooltip.x, top: linkTooltip.y }}>
          {linkTooltip.label}
        </div>
      )}
    </div>
  )
}
