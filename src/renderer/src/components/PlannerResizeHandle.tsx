import { useEffect, useRef } from 'react'

interface PlannerResizeHandleProps {
  /** Current column width in px, or null when using the flexible default. */
  width: number | null
  min: number
  max: number
  /** Live update while dragging. */
  onResize: (width: number) => void
  /** Fired once on pointerup, only if the pointer actually moved. */
  onCommitEnd: (width: number) => void
  /** Double-click reset. */
  onReset: () => void
}

export function PlannerResizeHandle({
  width,
  min,
  max,
  onResize,
  onCommitEnd,
  onReset
}: PlannerResizeHandleProps): React.JSX.Element {
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => cleanup.current?.()
  }, [])

  function start(e: React.PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const cell = (e.currentTarget as HTMLElement).parentElement
    const startWidth = width ?? (cell ? cell.getBoundingClientRect().width : min)
    let last = startWidth
    let moved = false
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: PointerEvent): void => {
      moved = true
      last = Math.min(max, Math.max(min, Math.round(startWidth + ev.clientX - startX)))
      onResize(last)
    }
    const onUp = (): void => {
      cleanup.current = null
      document.body.style.cursor = ''
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      if (moved) onCommitEnd(last)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    cleanup.current = () => {
      document.body.style.cursor = ''
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }

  return (
    <span
      className="planner-col-resize-handle"
      title="Drag to resize — double-click to reset"
      onPointerDown={start}
      onDoubleClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onReset()
      }}
    />
  )
}
