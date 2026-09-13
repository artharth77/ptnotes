/* eslint-disable react-refresh/only-export-components -- the file pairs a tiny overlay component with its state-builder helper */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export interface NameTipState {
  name: string
  left: number
  top: number
  className: string
}

/**
 * Measure a hovered text element and return overlay state when it clips
 * (scrollWidth > clientWidth). Positioned at the element's text origin,
 * so the overlay can mask the truncated text underneath.
 */
export function nameTipFrom(
  e: React.MouseEvent<HTMLElement>,
  name: string,
  className: string,
  leftInset = 0,
  topInset = 0
): NameTipState | null {
  const el = e.currentTarget
  if (el.scrollWidth <= el.clientWidth) return null
  const rect = el.getBoundingClientRect()
  return { name, left: rect.left + leftInset, top: rect.top + topInset, className }
}

/** Fixed-position full-text overlay portaled to body; hides on scroll or blur-out. */
export function NameTip({
  tip,
  onDismiss
}: {
  tip: NameTipState | null
  onDismiss: () => void
}): React.JSX.Element | null {
  useEffect(() => {
    if (!tip) return
    const hide = (): void => onDismiss()
    window.addEventListener('scroll', hide, true)
    return () => window.removeEventListener('scroll', hide, true)
  }, [tip, onDismiss])
  if (!tip) return null
  return createPortal(
    <div className={tip.className} style={{ left: tip.left, top: tip.top }}>
      {tip.name}
    </div>,
    document.body
  )
}
