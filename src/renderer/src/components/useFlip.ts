import { useLayoutEffect, useRef, type RefObject } from 'react'

const DURATION = 200

export function useFlip<T extends HTMLElement>(refs: RefObject<Map<string, T>>): void {
  const rects = useRef<Map<string, DOMRect>>(new Map())
  const animating = useRef<Set<string>>(new Set())
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>()
    refs.current.forEach((el, id) => {
      const resting = rects.current.get(id)
      if (animating.current.has(id) && resting) {
        next.set(id, resting)
        return
      }
      const rect = el.getBoundingClientRect()
      next.set(id, rect)
      const prev = rects.current.get(id)
      if (!prev) return
      const dx = prev.left - rect.left
      const dy = prev.top - rect.top
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        animating.current.add(id)
        const anim = el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: DURATION, easing: 'ease-out' }
        )
        anim.finished
          .then(() => {
            animating.current.delete(id)
            rects.current.set(id, el.getBoundingClientRect())
          })
          .catch(() => {
            animating.current.delete(id)
          })
      }
    })
    rects.current = next
  })
}
