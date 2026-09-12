import { useEffect, useState } from 'react'

/** Effective theme: `dark`, or `system` acquiring via the OS color-scheme. */
export function isDarkTheme(): boolean {
  const t = document.documentElement.getAttribute('data-theme')
  if (t === 'dark') return true
  if (t === 'light') return false
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

/** Tracks theme switches (Settings toggle or OS dark/light flip). */
export function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState<boolean>(isDarkTheme)
  useEffect(() => {
    const sync = (): void => setDark(isDarkTheme())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    mq.addEventListener('change', sync)
    return () => {
      observer.disconnect()
      mq.removeEventListener('change', sync)
    }
  }, [])
  return dark
}
