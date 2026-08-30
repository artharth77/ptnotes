import { useLayoutEffect, useRef, type RefObject } from 'react'

const DURATION = 200

type Pos = { left: number; top: number }

function measure(el: HTMLElement, root: HTMLElement | null): Pos {
  const rect = el.getBoundingClientRect()
  let left = rect.left
  let top = rect.top
  if (root) {
    const rootRect = root.getBoundingClientRect()
    left -= rootRect.left
    top -= rootRect.top
  }
  for (let node: HTMLElement | null = el.parentElement; node; node = node.parentElement) {
    left += node.scrollLeft
    top += node.scrollTop
    if (node === root) break
  }
  return { left, top }
}

export function useFlip<T extends HTMLElement>(
  refs: RefObject<Map<string, T>>,
  rootRef: RefObject<HTMLElement | null>
): void {
  const rects = useRef<Map<string, Pos>>(new Map())
  const animating = useRef<Set<string>>(new Set())
  useLayoutEffect(() => {
    const root = rootRef.current
    const next = new Map<string, Pos>()
    refs.current.forEach((el, id) => {
      const resting = rects.current.get(id)
      if (animating.current.has(id) && resting) {
        next.set(id, resting)
        return
      }
      const pos = measure(el, root)
      next.set(id, pos)
      const prev = rects.current.get(id)
      if (!prev) return
      const dx = prev.left - pos.left
      const dy = prev.top - pos.top
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        animating.current.add(id)
        const anim = el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: DURATION, easing: 'ease-out' }
        )
        anim.finished
          .then(() => {
            animating.current.delete(id)
            if (refs.current.get(id) === el) rects.current.set(id, measure(el, rootRef.current))
          })
          .catch(() => {
            animating.current.delete(id)
          })
      }
    })
    rects.current = next
  })
}
