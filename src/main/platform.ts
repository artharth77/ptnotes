import { AsyncLocalStorage } from 'node:async_hooks'
import type { OpenDialogOptions, SaveDialogOptions } from 'electron'
import type { UiMode } from '@shared/api'

/**
 * A request the main process wants the *client* to perform, because the file
 * lives on the server: desktop shows it in the OS file manager, web hands the
 * browser a URL (download / new tab).
 */
export interface ClientAction {
  kind: 'download' | 'open'
  url: string
}

const actionSink = new AsyncLocalStorage<(action: ClientAction) => void>()

/** Run `fn` with a sink collecting the client actions it triggers (web transport). */
export function runWithActionSink<T>(sink: (action: ClientAction) => void, fn: () => T): T {
  return actionSink.run(sink, fn)
}

/** Queue a download/open request for the client that triggered the current call (web). */
export function emitClientAction(action: ClientAction): void {
  actionSink.getStore()?.(action)
}

/** Same-origin URL for a file on this machine (web transport). */
export function webFileUrl(absPath: string, download: boolean): string {
  const url = `/api/file?path=${encodeURIComponent(absPath)}`
  return download ? `${url}&download=1` : url
}

/**
 * Desktop-only host operations (dialogs, file manager). Both modes share every
 * handler; only these differ, so a headless run never touches `dialog`/`shell`.
 */
export interface PlatformServices {
  readonly mode: UiMode
  /** Reveal in the OS file manager, or queue a browser download. */
  reveal(absPath: string): void
  /** Open with the OS default app, or in a browser tab. Resolves to an error message (or ''). */
  openPath(absPath: string): Promise<string>
  showOpenDialog(options: OpenDialogOptions): Promise<string[]>
  showSaveDialog(options: SaveDialogOptions): Promise<string | null>
}

/** Web behavior: no dialogs, no file manager — everything arrives as a URL. */
export const webPlatform: PlatformServices = {
  mode: 'web',
  reveal(absPath) {
    emitClientAction({ kind: 'download', url: webFileUrl(absPath, true) })
  },
  async openPath(absPath) {
    emitClientAction({ kind: 'open', url: webFileUrl(absPath, false) })
    return ''
  },
  async showOpenDialog() {
    return []
  },
  async showSaveDialog() {
    return null
  }
}

let current: PlatformServices = webPlatform

/** Set once at startup to the mode's implementation (`initCore`). */
export function setPlatform(platform: PlatformServices): void {
  current = platform
}

export function getPlatform(): PlatformServices {
  return current
}
