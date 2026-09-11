/* eslint-disable react-refresh/only-export-components -- the file exports one TipTap extension built around its (non-exported) node view component */
import { useEffect, useRef, useState } from 'react'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps
} from '@tiptap/react'
import {
  createMermaidCodeBlock,
  DEFAULT_MERMAID_MODE,
  MERMAID_MODES,
  type MermaidMode
} from './mermaidCodeBlock'

const MERMAID_RENDER_DEBOUNCE_MS = 500

function svgToDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

function setMermaidMode(props: ReactNodeViewProps, mode: MermaidMode): void {
  const pos = typeof props.getPos === 'function' ? props.getPos() : props.getPos
  if (typeof pos !== 'number') return
  const attrs: Record<string, unknown> = { ...props.node.attrs, mermaidMode: mode }
  const tr = props.editor.view.state.tr.setNodeMarkup(pos, null, attrs)
  tr.setMeta('addToHistory', false)
  props.editor.view.dispatch(tr)
}

function MermaidCodeBlockView(props: ReactNodeViewProps): React.JSX.Element {
  const node = props.node
  const language = (node.attrs.language as string) || ''
  const isMermaid = language === 'mermaid'
  const mode: MermaidMode = isMermaid
    ? ((node.attrs.mermaidMode as MermaidMode) ?? DEFAULT_MERMAID_MODE)
    : 'edit'
  const source = node.textContent

  const [preview, setPreview] = useState<{
    src: string
    svg: string | null
    error: string | null
    loading: boolean
  }>({ src: '', svg: null, error: null, loading: false })
  const seqRef = useRef(0)
  const svgRef = useRef<string | null>(null)
  const requestedRef = useRef<string>('')

  useEffect(() => {
    if (!isMermaid || mode === 'edit' || !source.trim()) return
    if (requestedRef.current === source && (svgRef.current || preview.error)) return
    const sourceText = source
    const seq = ++seqRef.current
    const timer = setTimeout(() => {
      requestedRef.current = sourceText
      setPreview({ src: sourceText, svg: svgRef.current, error: null, loading: true })
      void window.ptnotes.diagrams.render(sourceText).then((res) => {
        if (seqRef.current !== seq) return
        if (res.ok && res.svg) {
          svgRef.current = svgToDataUri(res.svg)
          setPreview({ src: sourceText, svg: svgRef.current, error: null, loading: false })
        } else {
          setPreview({
            src: sourceText,
            svg: svgRef.current,
            error: res.error ?? 'Diagram render failed.',
            loading: false
          })
        }
      })
    }, MERMAID_RENDER_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMermaid, mode, source])

  const wrapperClass = [
    'code-block-wrapper',
    isMermaid ? 'mermaid-block' : '',
    isMermaid ? `mermaid-mode-${mode}` : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <NodeViewWrapper as="pre" className={wrapperClass}>
      {isMermaid && (
        <div className="mermaid-block-head" contentEditable={false}>
          <span className="mermaid-block-type">Mermaid</span>
          <div className="mermaid-mode-switch">
            {MERMAID_MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={`mermaid-mode-btn${mode === m ? ' active' : ''}`}
                title={
                  m === 'edit'
                    ? 'Edit source only'
                    : m === 'split'
                      ? 'Code + preview'
                      : 'Preview only'
                }
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMermaidMode(props, m)}
              >
                {m === 'edit' ? 'Edit' : m === 'split' ? 'Split' : 'Preview'}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={isMermaid ? 'mermaid-block-body' : 'mermaid-block-body plain'}>
        <div className="mermaid-code-pane">
          <NodeViewContent<'code'>
            as="code"
            className={`hljs${language ? ` language-${language}` : ''}`}
          />
        </div>
        {isMermaid && mode !== 'edit' && (
          <div className="mermaid-preview-pane" contentEditable={false}>
            {preview.loading && <div className="mermaid-preview-status">Rendering…</div>}
            {!preview.loading && !preview.error && !source.trim() && (
              <div className="mermaid-preview-error">Empty diagram source.</div>
            )}
            {!preview.loading && preview.error && (
              <div className="mermaid-preview-error">
                {preview.error}
                {preview.svg && (
                  <div className="mermaid-preview-note">Showing the last successful render.</div>
                )}
              </div>
            )}
            {!preview.loading && preview.svg && (
              <img
                className="mermaid-preview-img"
                src={preview.svg}
                alt="Mermaid diagram preview"
                draggable={false}
              />
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

/** CodeBlockLowlight + the mermaid edit/split/preview node view. Used by the markdown editor. */
export const MermaidCodeBlock = createMermaidCodeBlock(() =>
  ReactNodeViewRenderer(MermaidCodeBlockView, { as: 'pre' })
)
