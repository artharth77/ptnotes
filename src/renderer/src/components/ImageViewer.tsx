import { useCallback, useEffect, useRef, useState } from 'react'
import { mdiLightbulbOn, mdiLightbulbOutline } from '@mdi/js'
import { MdiIcon } from './MdiIcon'
import { useIsDarkTheme } from '../useIsDarkTheme'

/**
 * Fullscreen lightbox for a single image. Renders nothing when unused — mount it
 * conditionally (`src != null`). Close via the ✕ button, outside click or Escape.
 * `large` upscales the image to fill the viewport (small diagrams still readable).
 * `onBulbLight` (with `bulbLight`) surfaces a floating round light/dark canvas
 * toggle, shown only on dark themes.
 */
export function ImageViewer({
  src,
  alt,
  onClose,
  large,
  bulbLight,
  onBulbLight
}: {
  src: string
  alt: string
  onClose: () => void
  large?: boolean
  bulbLight?: boolean
  onBulbLight?: (light: boolean) => void
}): React.JSX.Element {
  const [closing, setClosing] = useState(false)
  const [fitted, setFitted] = useState<{ width: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dark = useIsDarkTheme()

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

  const fitLarge = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>): void => {
      if (!large) return
      const natW = e.currentTarget.naturalWidth
      const natH = e.currentTarget.naturalHeight
      if (!natW || !natH) return
      const w = Math.round(
        Math.min(window.innerWidth * 0.94, window.innerHeight * 0.9 * (natW / natH))
      )
      setFitted({ width: Math.max(natW, w) })
    },
    [large]
  )

  return (
    <div
      className={`chat-img-viewer${bulbLight ? ' bulb-light' : ''}${closing ? ' closing' : ''}`}
      onClick={close}
    >
      <button className="chat-img-viewer-close" onClick={close}>
        ✕
      </button>
      {dark && onBulbLight && (
        <button
          type="button"
          className="chat-img-viewer-close bulb-toggle"
          title={bulbLight ? 'Theme-colored canvas (dark)' : 'White-mode canvas'}
          onClick={(e) => {
            e.stopPropagation()
            onBulbLight(!bulbLight)
          }}
        >
          <MdiIcon path={bulbLight ? mdiLightbulbOn : mdiLightbulbOutline} size={20} />
        </button>
      )}
      <img
        src={src}
        alt={alt}
        onLoad={fitLarge}
        style={large && fitted ? { width: fitted.width, height: 'auto' } : undefined}
      />
      {alt && <div className="chat-img-viewer-caption">{alt}</div>}
    </div>
  )
}
