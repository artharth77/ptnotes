import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
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
  return CodeBlockLowlight.extend(config as never)
}
