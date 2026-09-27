import { mdiDownload } from '@mdi/js'

/** True when the app is served by the headless web UI instead of the Electron preload. */
export function isWebUi(): boolean {
  return typeof window !== 'undefined' && window.ptnotes?.ui?.mode === 'web'
}

/**
 * "Reveal in the file manager" has no browser equivalent — the same action
 * hands the browser a download instead, so the label follows the mode.
 */
export function revealLabel(desktopLabel: string): string {
  return isWebUi() ? 'Download' : desktopLabel
}

export function revealIcon(desktopIcon: string): string {
  return isWebUi() ? mdiDownload : desktopIcon
}
