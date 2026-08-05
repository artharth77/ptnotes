import { useRef, useState } from 'react'

interface ResizerProps {
  onResize: (delta: number) => void
  position?: 'start' | 'end'
}

export function Resizer({ onResize, position = 'end' }: ResizerProps): React.JSX.Element {
  const lastX = useRef(0)
  const activeRef = useRef(false)
  const [active, setActive] = useState(false)

  function stop(): void {
    activeRef.current = false
    setActive(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
  }

  function move(e: MouseEvent): void {
    if (!activeRef.current) return
    const delta = e.clientX - lastX.current
    lastX.current = e.clientX
    onResize(position === 'start' ? -delta : delta)
  }

  function up(): void {
    stop()
  }

  function handleMouseDown(e: React.MouseEvent): void {
    e.preventDefault()
    activeRef.current = true
    setActive(true)
    lastX.current = e.clientX
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
