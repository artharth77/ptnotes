import { BrowserWindow, dialog, shell } from 'electron'
import type { OpenDialogOptions, SaveDialogOptions } from 'electron'
import type { PlatformServices } from './platform'

/** Desktop behavior: native dialogs + the OS file manager. */
export const desktopPlatform: PlatformServices = {
  mode: 'desktop',
  reveal(absPath) {
    shell.showItemInFolder(absPath)
  },
  openPath(absPath) {
    return shell.openPath(absPath)
  },
  async showOpenDialog(options: OpenDialogOptions): Promise<string[]> {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  },
  async showSaveDialog(options: SaveDialogOptions): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
  }
}
