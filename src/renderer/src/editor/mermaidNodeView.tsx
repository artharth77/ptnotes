/* eslint-disable react-refresh/only-export-components -- the file exports one TipTap extension built around its (non-exported) node view component */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  mdiFullscreen,
  mdiLightbulbOn,
  mdiLightbulbOutline,
  mdiMagnifyMinus,
  mdiMagnifyPlus,
  mdiRestore
} from '@mdi/js'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps
} from '@tiptap/react'
import { MdiIcon } from '../components/MdiIcon'
import { ImageViewer } from '../components/ImageViewer'
import { useIsDarkTheme } from '../useIsDarkTheme'
import {
  createMermaidCodeBlock,
  DEFAULT_MERMAID_MODE,
  MERMAID_MODES,
  type MermaidMode
} from './mermaidCodeBlock'

const MERMAID_RENDER_DEBOUNCE_MS = 500
const MERMAID_ZOOM_STEP = 1.25
const MERMAID_ZOOM_MIN = 0.25
const MERMAID_ZOOM_MAX = 4

/**
 * Bake explicit pixel dimensions into the mermaid SVG root so the preview
 * <img> gets an intrinsic size: mermaid emits `width="100%"` plus a
 * `max-width` style with only a viewBox — percentages give an <img> no
 * natural size, which collapses it to nothing.
 */
function svgToDataUri(svg: string, width?: number, height?: number): string {
  let doc = svg
  const rootMatch = svg.match(/<svg[^>]*>/)
  if (rootMatch) {
    const root = rootMatch[0]
    let w = width && width > 0 ? Math.round(width) : undefined
    let h = height && height > 0 ? Math.round(height) : undefined
    if (!w || !h) {
      // viewBox includes mermaid's padding, so its size is the full size.
      const vb = root.match(/viewBox="-?[\d.eE+]+\s+-?[\d.eE+]+\s+([\d.]+)\s+([\d.]+)"/)
      if (vb) {
        if (!w) w = Math.round(parseFloat(vb[1]))
        if (!h) h = Math.round(parseFloat(vb[2]))
      }
    }
    if (w && h) {
      const cleaned = root
        .replace(/\s(width|height|max-width)="[^"]*"/g, '')
        .replace(/\sstyle="[^"]*"/g, '')
      doc = `${cleaned.slice(0, 4)} width="${w}" height="${h}"${cleaned.slice(4)}${svg.slice(root.length)}`
    }
  }
  const bytes = new TextEncoder().encode(doc)
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

interface MermaidViewState {
  scale: number
  x: number
  y: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Offset range that keeps a scaled image inside the viewport on one axis.
 * Wider than the viewport: `[-span, 0]` (left-…right-aligned). Smaller than
 * the viewport: `[0, -span]` (positive both bounds) so the image can slide
 * between its edges without ever being pushed past either side.
 */
function panBounds(viewSize: number, imgSize: number, scale: number): [number, number] {
  const span = imgSize * scale - viewSize
  if (span >= 0) return [-span, 0]
  return [0, -span]
}

/** Fit-to-viewport scale (never upscales) with offsets that center the image. */
function fitView(
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number
): MermaidViewState | null {
  if (!viewW || !viewH || !imgW || !imgH) return null
  const scale = clamp(Math.min(viewW / imgW, viewH / imgH), MERMAID_ZOOM_MIN, 1)
  return { scale, x: (viewW - imgW * scale) / 2, y: (viewH - imgH * scale) / 2 }
}

const VIEWER_ACTIONS: {
  icon: string
  title: string
  run: 'in' | 'out' | 'reset' | 'fullscreen'
}[] = [
  { icon: mdiMagnifyMinus, title: 'Zoom out', run: 'out' },
  { icon: mdiMagnifyPlus, title: 'Zoom in', run: 'in' },
  { icon: mdiRestore, title: 'Reset view', run: 'reset' },
  { icon: mdiFullscreen, title: 'Show enlarged preview (Esc to exit)', run: 'fullscreen' }
]

/** Interactive diagram viewport: drag to pan, floating buttons to zoom/reset.
 *  Initially the diagram fits the pane; zoom is centered on the viewport. */
function MermaidDiagramViewer({
  svg,
  bulbLight,
  onBulbLight
}: {
  svg: string
  bulbLight: boolean
  onBulbLight: (light: boolean) => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{ px: number; py: number; x: number; y: number; scale: number } | null>(
    null
  )
  const [view, setView] = useState<MermaidViewState | null>(null)
  const [lightbox, setLightbox] = useState(false)
  const dark = useIsDarkTheme()

  const imageSize = (): { w: number; h: number } | null => {
    const el = imgRef.current
    if (!el || !el.naturalWidth || !el.naturalHeight) return null
    return { w: el.naturalWidth, h: el.naturalHeight }
  }

  const getFit = useCallback((): MermaidViewState | null => {
    const canvas = canvasRef.current
    const size = imageSize()
    if (!canvas || !size) return null
    return fitView(canvas.clientWidth, canvas.clientHeight, size.w, size.h)
  }, [])

  // Open the shared lightbox (Esc / ✕ / outside click all handled there).
  const toggleFullscreen = useCallback((): void => {
    setLightbox(true)
  }, [])

  /** Zoom around the canvas center, clamping offsets so the image stays reachable. */
  const zoomTo = useCallback(
    (nextScale: number): void => {
      const canvas = canvasRef.current
      const size = imageSize()
      if (!canvas || !size) return
      const scale = clamp(nextScale, MERMAID_ZOOM_MIN, MERMAID_ZOOM_MAX)
      setView((prev) => {
        const current = prev ?? getFit() ?? { scale: 1, x: 0, y: 0 }
        const cx = canvas.clientWidth / 2
        const cy = canvas.clientHeight / 2
        const wx = (cx - current.x) / current.scale
        const wy = (cy - current.y) / current.scale
        const [xLo, xHi] = panBounds(canvas.clientWidth, size.w, scale)
        const [yLo, yHi] = panBounds(canvas.clientHeight, size.h, scale)
        return {
          scale,
          x: clamp(cx - wx * scale, Math.min(xLo, xHi), Math.max(xLo, xHi)),
          y: clamp(cy - wy * scale, Math.min(yLo, yHi), Math.max(yLo, yHi))
        }
      })
    },
    [getFit]
  )

  return (
    <>
      <div
        ref={canvasRef}
        className={`mermaid-viewer${bulbLight ? ' bulb-light' : ''}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const el = canvasRef.current
          if (!el) return
          e.preventDefault()
          e.stopPropagation()
          el.setPointerCapture(e.pointerId)
          el.classList.add('panning')
          // Fall back to the fitted view so a drag before the first zoom/load
          // starts from the rendered position, not raw scale-1 top-left.
          const current = view ?? getFit() ?? { scale: 1, x: 0, y: 0 }
          dragRef.current = {
            px: e.clientX,
            py: e.clientY,
            x: current.x,
            y: current.y,
            scale: current.scale
          }
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current
          const el = canvasRef.current
          const size = imageSize()
          if (!drag || !el || !size) return
          const viewW = el.clientWidth
          const viewH = el.clientHeight
          const scale = view?.scale ?? drag.scale
          const [xLo, xHi] = panBounds(viewW, size.w, scale)
          const [yLo, yHi] = panBounds(viewH, size.h, scale)
          const next = {
            scale,
            x: clamp(drag.x + (e.clientX - drag.px), Math.min(xLo, xHi), Math.max(xLo, xHi)),
            y: clamp(drag.y + (e.clientY - drag.py), Math.min(yLo, yHi), Math.max(yLo, yHi))
          }
          setView({ scale, x: next.x, y: next.y })
        }}
        onPointerUp={() => {
          dragRef.current = null
          canvasRef.current?.classList.remove('panning')
        }}
        onPointerCancel={() => {
          dragRef.current = null
          canvasRef.current?.classList.remove('panning')
        }}
      >
        <div
          className="mermaid-viewer-layer"
          style={{
            transform:
              view != null ? `translate(${view.x}px, ${view.y}px) scale(${view.scale})` : undefined
          }}
        >
          <img
            ref={imgRef}
            className="mermaid-viewer-img"
            src={svg}
            alt="Mermaid diagram"
            draggable={false}
            onLoad={() => setView((prev) => prev ?? getFit())}
          />
        </div>
        <div
          className="mermaid-viewer-actions"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.preventDefault()}
        >
          {dark && (
            <div className="mermaid-viewer-group">
              <button
                type="button"
                className={`mermaid-viewer-btn${!bulbLight ? ' active' : ''}`}
                title="Diagram canvas in theme colors (dark)"
                onClick={() => onBulbLight(false)}
              >
                <MdiIcon path={mdiLightbulbOutline} size={16} />
              </button>
              <button
                type="button"
                className={`mermaid-viewer-btn${bulbLight ? ' active' : ''}`}
                title="Diagram canvas in white-mode colors"
                onClick={() => onBulbLight(true)}
              >
                <MdiIcon path={mdiLightbulbOn} size={16} />
              </button>
            </div>
          )}
          <div className="mermaid-viewer-group">
            {VIEWER_ACTIONS.map((a) => (
              <button
                key={a.run}
                type="button"
                className="mermaid-viewer-btn"
                title={a.title}
                onClick={() => {
                  if (a.run === 'in') {
                    zoomTo((view?.scale ?? 1) * MERMAID_ZOOM_STEP)
                  } else if (a.run === 'out') {
                    zoomTo((view?.scale ?? 1) / MERMAID_ZOOM_STEP)
                  } else if (a.run === 'fullscreen') {
                    toggleFullscreen()
                  } else {
                    setView(getFit())
                  }
                }}
              >
                <MdiIcon path={a.icon} size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>
      {lightbox && (
        <ImageViewer
          src={svg}
          alt="Mermaid diagram"
          onClose={() => setLightbox(false)}
          large
          bulbLight={bulbLight}
          onBulbLight={onBulbLight}
        />
      )}
    </>
  )
}

function MermaidCodeBlockView(props: ReactNodeViewProps): React.JSX.Element {
  const node = props.node
  const language = (node.attrs.language as string) || ''
  const isMermaid = language === 'mermaid'
  const mode: MermaidMode = isMermaid
    ? ((node.attrs.mermaidMode as MermaidMode) ?? DEFAULT_MERMAID_MODE)
    : 'edit'
  const source = node.textContent

  // Canvas color override is per block and survives diagram re-renders.
  const [bulbLight, setBulbLight] = useState(false)

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
    if (!isMermaid || mode === 'edit') {
      // No stale diagram across the code pane: an empty source or a render
      // error leaves the pane without a preview image.
      if (svgRef.current) {
        svgRef.current = null
        setPreview({ src: '', svg: null, error: null, loading: false })
      }
      return
    }
    if (!source.trim()) {
      if (svgRef.current || preview.error || requestedRef.current) {
        svgRef.current = null
        requestedRef.current = ''
        setPreview({ src: '', svg: null, error: null, loading: false })
      }
      return
    }
    if (requestedRef.current === source && (svgRef.current || preview.error)) return
    const sourceText = source
    const seq = ++seqRef.current
    const timer = setTimeout(() => {
      requestedRef.current = sourceText
      // Drop the previous diagram as soon as a new render is requested so no
      // stale image lingers behind the "Rendering…" status or the error.
      if (svgRef.current && requestedRef.current) svgRef.current = null
      setPreview({ src: sourceText, svg: null, error: null, loading: true })
      void window.ptnotes.diagrams.render(sourceText).then((res) => {
        if (seqRef.current !== seq) return
        if (res.ok && res.svg) {
          svgRef.current = svgToDataUri(res.svg, res.width, res.height)
          setPreview({ src: sourceText, svg: svgRef.current, error: null, loading: false })
        } else {
          svgRef.current = null
          setPreview({
            src: sourceText,
            svg: null,
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
            style={{ whiteSpace: 'pre' }}
          />
        </div>
        {isMermaid && mode !== 'edit' && (
          <div className="mermaid-preview-pane" contentEditable={false}>
            {preview.loading && <div className="mermaid-preview-status">Rendering…</div>}
            {!preview.loading && !preview.error && !source.trim() && (
              <div className="mermaid-preview-error">Empty diagram source.</div>
            )}
            {!preview.loading && preview.error && (
              <div className="mermaid-preview-error">{preview.error}</div>
            )}
            {!preview.loading && !preview.error && preview.svg && (
              <MermaidDiagramViewer
                key={preview.svg}
                svg={preview.svg}
                bulbLight={bulbLight}
                onBulbLight={setBulbLight}
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
  ReactNodeViewRenderer(MermaidCodeBlockView)
)
