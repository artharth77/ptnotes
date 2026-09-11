import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import type { Editor } from '@tiptap/core'
import { lowlight, safeLanguage } from './lowlightRegistry'

export type MermaidMode = 'edit' | 'split' | 'preview'

export const DEFAULT_MERMAID_MODE: MermaidMode = 'edit'
export const MERMAID_MODES: MermaidMode[] = ['edit', 'split', 'preview']

/**
 * Pure (React-free) mermaid code block extension. `nodeView` supplies the
 * editor-side rendering (via ReactNodeViewRenderer); when omitted the blocks
 * render with ProseMirror's default code block view (headless tests).
 */
interface ExtensionThis {
  name?: string
  parent?: () => Record<string, unknown>
}

type ExtensionField = (this: ExtensionThis, ...args: never[]) => unknown

export function createMermaidCodeBlock(nodeView?: unknown): typeof CodeBlockLowlight {
  const config: Record<string, ExtensionField> = {
    addOptions(this: ExtensionThis) {
      return {
        ...(this.parent?.() ?? {}),
        lowlight,
        defaultLanguage: 'text',
        HTMLAttributes: { class: 'code-block-wrapper' }
      }
    },
    addAttributes(this: ExtensionThis) {
      const parentAttrs = (this.parent?.() ?? {}) as Record<
        string,
        {
          rendered?: boolean
          default?: unknown
          parseHTML?: (e: Element) => unknown
          renderHTML?: (a: never) => unknown
        }
      >
      const base = parentAttrs.language ?? {}
      return {
        ...parentAttrs,
        language: {
          ...base,
          rendered: false,
          default: '',
          parseHTML: (element): string => {
            const c = element.querySelector('code')
            const lang =
              element.getAttribute('data-language') ||
              c?.className.match(/language-([\w-]+)/)?.[1] ||
              ''
            if (!lang) return ''
            return safeLanguage(lang)
          },
          renderHTML: (attrs) => {
            const raw = (attrs as { language?: string }).language
            if (!raw) return {}
            return { 'data-language': safeLanguage(raw) }
          }
        },
        mermaidMode: {
          default: DEFAULT_MERMAID_MODE,
          rendered: false,
          parseHTML: (element) => element.getAttribute('data-mermaid-mode') ?? undefined,
          renderHTML: () => ({})
        }
      }
    },
    parseMarkdown(this: ExtensionThis, token: never, helpers: never) {
      const t = token as { raw?: string; lang?: string; text?: string; codeBlockStyle?: string }
      const h = helpers as unknown as {
        createNode: (type: string, attrs: Record<string, unknown>, content: unknown[]) => unknown
        createTextNode: (text: string) => unknown
      }
      const isFenced =
        typeof t.raw === 'string' && (t.raw.startsWith('```') || t.raw.startsWith('~~~'))
      if (!isFenced && t.codeBlockStyle !== 'indented') {
        return []
      }
      return h.createNode(
        'codeBlock',
        { language: t.lang ? safeLanguage(t.lang) : '', mermaidMode: DEFAULT_MERMAID_MODE },
        t.text ? [h.createTextNode(t.text)] : []
      )
    }
  }
  if (nodeView) config.addNodeView = nodeView as ExtensionField
  config.addKeyboardShortcuts = function (this: ExtensionThis) {
    return {
      ...this.parent?.(),
      'Mod-a': ({ editor }: { editor: Editor }): boolean => codeBlockSelectAll(editor)
    }
  } as unknown as ExtensionField
  return CodeBlockLowlight.extend(config as never)
}

/**
 * Mod/Cmd+A semantics for the note editor: with the caret inside a code block
 * (and the selection not crossing its boundary) select only that block's text;
 * otherwise fall through (returns false) so the default select-all applies.
 */
export function codeBlockSelectAll(editor: Editor): boolean {
  const { selection } = editor.state
  const $from = selection.$from
  let depth = -1
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === 'codeBlock') {
      depth = d
      break
    }
  }
  if (depth < 0) return false
  const start = $from.before(depth) + 1
  const end = $from.after(depth) - 1
  if (selection.from < start || selection.to > end) return false
  if (start >= end) return false
  editor.commands.setTextSelection({ from: start, to: end })
  return true
}
