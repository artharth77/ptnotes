import { createApi, type Transport } from '@shared/api'
import { decodeRpc, encodeRpc } from '@shared/rpcCodec'

type Listener = (payload: unknown) => void
type ClientAction = { kind?: string; url?: string }

const listeners = new Map<string, Set<Listener>>()

/** Mirrors the flag the desktop main process keeps for `before-input-event`. */
let plannerEditActive = false

function emit(channel: string, payload: unknown): void {
  const set = listeners.get(channel)
  if (!set) return
  for (const listener of set) listener(payload)
}

function download(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Reveal/open requests become URL fetches the browser can act on. */
function runClientAction(action: ClientAction): void {
  if (!action.url) return
  if (action.kind === 'open') {
    const opened = window.open(action.url, '_blank', 'noopener')
    if (opened) return
  }
  download(action.url)
}

const transport: Transport = {
  mode: 'web',

  async invoke(channel, ...args) {
    const res = await fetch('/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, args: encodeRpc(args) })
    })
    if (res.status === 401) {
      window.location.reload()
      throw new Error('Session expired')
    }
    let body: {
      ok?: boolean
      result?: unknown
      error?: string
      actions?: ClientAction[]
    }
    try {
      body = (await res.json()) as typeof body
    } catch {
      throw new Error(`Request failed (${res.status})`)
    }
    for (const action of body.actions ?? []) runClientAction(action)
    if (!res.ok || !body.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
    return decodeRpc(body.result)
  },

  send(channel, ...args) {
    // Send-only channels have no reply; both drive local state in web mode.
    if (channel === 'planner:set-edit-active') plannerEditActive = !!args[0]
  },

  on(channel, listener) {
    let set = listeners.get(channel)
    if (!set) {
      set = new Set()
      listeners.set(channel, set)
    }
    set.add(listener)
    return () => {
      set?.delete(listener)
    }
  },

  getPathForFile: () => ''
}

/**
 * Replaces the desktop shortcuts the main process would otherwise own:
 * global find, menu "Select All" and the planner's undo/redo interception
 * (which the browser's native undo would otherwise steal from the grid).
 */
function installKeyboardFallbacks(): void {
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()

    if (mod && e.shiftKey && key === 'f' && !e.altKey) {
      emit('global:open-find', undefined)
      return
    }
    if (mod && key === 'a' && !e.altKey) {
      // The browser's native select-all still runs — the app handler refines it.
      emit('global:select-all', undefined)
      return
    }

    if (!plannerEditActive || !mod || e.altKey) return
    const isUndo = !e.shiftKey && key === 'z'
    const isRedo = (e.shiftKey && key === 'z') || (key === 'y' && e.ctrlKey && !e.metaKey)
    if (!isUndo && !isRedo) return
    e.preventDefault()
    emit('planner:undo-redo', { redo: isRedo })
  })
}

/**
 * Electron never pops the browser's own context menu, so the web UI must not
 * either: capture phase (before React handlers, which often stopPropagation)
 * and cancel the default so only the app's own menus can appear.
 */
function suppressContextMenu(): void {
  window.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault()
    },
    true
  )
}

function startEventStream(): void {
  const source = new EventSource('/api/events')
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as { channel?: string; payload?: unknown }
      if (data.channel) emit(data.channel, decodeRpc(data.payload))
    } catch {
      // Ignore frames that are not valid JSON.
    }
  }
}

/** Install `window.ptnotes` over HTTP + SSE (called from `main.tsx` when no preload ran). */
export function installWebBridge(): void {
  startEventStream()
  installKeyboardFallbacks()
  suppressContextMenu()
  Object.defineProperty(window, 'ptnotes', {
    value: createApi(transport),
    writable: false,
    configurable: true
  })
}
