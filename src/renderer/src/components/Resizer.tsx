import { useRef, useState } from 'react'

interface ResizerProps {
  min: number
  max: number
  position?: 'start' | 'end'
  targetRef: React.RefObject<HTMLElement | null>
  onCommit?: (width: number) => void
  onStart?: () => void
  onEnd?: () => void
}

export function Resizer({
  min,
  max,
  position = 'end',
  targetRef,
  onCommit,
  onStart,
  onEnd
}: ResizerProps): React.JSX.Element {
  const startX = useRef(0)
  const startWidth = useRef(0)
  const lastWidth = useRef(0)
  const activeRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const [active, setActive] = useState(false)

  function applyWidth(width: number): void {
    targetRef.current?.style.setProperty('width', `${width}px`)
  }

  function stop(): void {
    activeRef.current = false
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    setActive(false)
    targetRef.current?.classList.remove('resizing')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
    onEnd?.()
    onCommit?.(lastWidth.current)
  }

  function move(e: MouseEvent): void {
    if (!activeRef.current) return
    const delta = position === 'start' ? startX.current - e.clientX : e.clientX - startX.current
    const next = Math.min(max, Math.max(min, startWidth.current + delta))
    lastWidth.current = next
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (activeRef.current) applyWidth(lastWidth.current)
    })
  }

  function up(): void {
    stop()
  }

  function handleMouseDown(e: React.MouseEvent): void {
    e.preventDefault()
    const el = targetRef.current
    if (!el) return
    activeRef.current = true
    startX.current = e.clientX
    startWidth.current = el.getBoundingClientRect().width
    lastWidth.current = startWidth.current
    el.classList.add('resizing')
    setActive(true)
    onStart?.()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  return (
    <div
      className={`resizer ${position}${active ? ' active' : ''}`}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
    />
  )
}
