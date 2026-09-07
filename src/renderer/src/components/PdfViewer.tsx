import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Fullscreen PDF preview using Chromium's built-in PDF viewer (plugins-enabled iframe
 * loaded over ptfile://). Renders nothing when unused — mount it conditionally
 * (`src != null`). Close via the ✕ button or Escape: while the plugin iframe has
 * focus it consumes keyboard input, so Escape is additionally intercepted in the
 * main process (flagged via `pdf.setViewerOpen`) and forwarded as
 * `pdf.onEscape` — the viewer still closes no matter where focus sits.
 */
export function PdfViewer({
  src,
  name,
  onClose
}: {
  src: string
  name: string
  onClose: () => void
}): React.JSX.Element {
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const close = useCallback((): void => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    timerRef.current = setTimeout(() => {
      onClose()
      setClosing(false)
    }, 200)
  }, [onClose])

  // Escape works while the plugin iframe has focus too (main-process interception)
  useEffect(() => {
    window.ptnotes.pdf.setViewerOpen(true)
    return () => window.ptnotes.pdf.setViewerOpen(false)
  }, [])

  useEffect(() => window.ptnotes.pdf.onEscape(close), [close])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div className={`pdf-viewer${closing ? ' closing' : ''}`}>
      <div className="pdf-viewer-header">
        <span className="pdf-viewer-title" title={name}>
          {name}
        </span>
        <button className="pdf-viewer-close" onClick={close} title="Close preview">
          ✕
        </button>
      </div>
      <iframe className="pdf-viewer-frame" src={src} title={name} />
    </div>
  )
}
