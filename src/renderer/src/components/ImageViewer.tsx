import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Fullscreen lightbox for a single image. Renders nothing when unused — mount it
 * conditionally (`src != null`). Close via the ✕ button, outside click or Escape.
 */
export function ImageViewer({
  src,
  alt,
  onClose
}: {
  src: string
  alt: string
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
    <div className={`chat-img-viewer${closing ? ' closing' : ''}`} onClick={close}>
      <button className="chat-img-viewer-close" onClick={close}>
        ✕
      </button>
      <img src={src} alt={alt} />
      {alt && <div className="chat-img-viewer-caption">{alt}</div>}
    </div>
  )
}
