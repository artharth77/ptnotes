import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Fullscreen PDF preview using Chromium's built-in PDF viewer (plugins-enabled iframe
 * loaded over ptfile://). Renders nothing when unused — mount it conditionally
 * (`src != null`). Close via the ✕ button or Escape (Escape needs focus outside the
 * iframe — the plugin consumes keyboard input while focused).
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const close = useCallback((): void => {
    setClosing(true)
    timerRef.current = setTimeout(() => {
      onClose()
      setClosing(false)
    }, 200)
  }, [onClose])

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
