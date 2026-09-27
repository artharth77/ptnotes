import './assets/main.css'
import { installWebBridge } from './webBridge'

/** The desktop preload exposes `window.electron`; the web UI only needs its platform hint. */
;(function ensureElectronShim(): void {
  if (typeof window === 'undefined' || window.electron) return
  Object.defineProperty(window, 'electron', {
    value: {
      process: {
        platform:
          typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
            ? 'darwin'
            : 'linux'
      }
    },
    writable: false,
    configurable: true
  })
})()

// Desktop: the preload has already defined `window.ptnotes`. Web: build it from
// the HTTP/SSE bridge so both modes run the exact same API factory.
if (!window.ptnotes) installWebBridge()

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
