import { parentOf } from '@shared/filesExplorer'
import { useAppStore } from './useAppStore'
import { friendlyError } from '../errors'

type DeleteItem = { path: string; name: string }

async function refreshExplorer(): Promise<void> {
  await useAppStore.getState().loadExplorer()
  void useAppStore.getState().refreshFiles()
}

/** Copy paths (relative to the files root) into the shared explorer clipboard. */
export function copyExplorerPaths(paths: string[]): void {
  if (paths.length === 0) return
  useAppStore.getState().setExplorerClipboard({ paths: [...paths], mode: 'copy' })
}

/** Cut paths (relative to the files root) into the shared explorer clipboard. */
export function cutExplorerPaths(paths: string[]): void {
  if (paths.length === 0) return
  useAppStore.getState().setExplorerClipboard({ paths: [...paths], mode: 'cut' })
}

/** Paste the clipboard into `destDir` (relative to the files root); cut clears the clipboard. */
export async function pasteExplorer(destDir: string): Promise<void> {
  const s = useAppStore.getState()
  const clip = s.explorerClipboard
  if (!s.activeProject || !clip || clip.paths.length === 0) return
  s.setExplorerOpsError(null)
  if (clip.mode === 'cut') s.setExplorerClipboard(null)
  try {
    if (clip.mode === 'copy') {
      await window.ptnotes.files.explorerCopy(s.activeProject, clip.paths, destDir)
    } else {
      await window.ptnotes.files.explorerMove(s.activeProject, clip.paths, destDir)
    }
    useAppStore.setState((st) => ({
      explorerExpanded: [...new Set([...st.explorerExpanded, destDir])]
    }))
    await refreshExplorer()
  } catch (err) {
    useAppStore.getState().setExplorerOpsError(friendlyError(err))
  }
}

export function openExplorerNewFolder(dir: string): void {
  const s = useAppStore.getState()
  s.setExplorerOpsError(null)
  s.setExplorerOpsDialog({ kind: 'newFolder', dir })
}

export function openExplorerRename(path: string, name: string): void {
  const s = useAppStore.getState()
  s.setExplorerOpsError(null)
  s.setExplorerOpsDialog({ kind: 'rename', path, name })
}

export function openExplorerDelete(items: DeleteItem[]): void {
  if (items.length === 0) return
  const s = useAppStore.getState()
  s.setExplorerOpsError(null)
  s.setExplorerOpsDialog({ kind: 'delete', items })
}

/** Reveal a files-explorer path in the OS file manager. */
export function revealExplorerPath(path: string): void {
  const project = useAppStore.getState().activeProject
  if (!project) return
  void window.ptnotes.files.revealByName(project, path).catch(() => {})
}

/** Create the pending new folder; throws so the dialog can show the error inline. */
export async function submitExplorerNewFolder(name: string): Promise<void> {
  const s = useAppStore.getState()
  const dialog = s.explorerOpsDialog
  if (dialog?.kind !== 'newFolder' || !s.activeProject) return
  await window.ptnotes.files.explorerCreateFolder(s.activeProject, dialog.dir, name)
  s.setExplorerOpsDialog(null)
  useAppStore.setState((st) => ({
    explorerExpanded: [...new Set([...st.explorerExpanded, dialog.dir])]
  }))
  await refreshExplorer()
}

/** Rename the pending entry; throws so the dialog can show the error inline. */
export async function submitExplorerRename(name: string): Promise<void> {
  const s = useAppStore.getState()
  const dialog = s.explorerOpsDialog
  if (dialog?.kind !== 'rename' || !s.activeProject) return
  const newPath = await window.ptnotes.files.explorerRename(s.activeProject, dialog.path, name)
  s.setExplorerOpsDialog(null)
  const remap = (p: string): string =>
    p === dialog.path || p.startsWith(dialog.path + '/') ? newPath + p.slice(dialog.path.length) : p
  useAppStore.setState((st) => ({
    explorerExpanded: st.explorerExpanded.map(remap),
    explorerCollapsed: st.explorerCollapsed.map(remap)
  }))
  const cwd = s.explorerCwd
  if (cwd === dialog.path || cwd.startsWith(dialog.path + '/')) {
    await s.loadExplorer(newPath + cwd.slice(dialog.path.length))
  } else if (parentOf(newPath) === cwd) {
    s.setExplorerSelected([newPath])
    await refreshExplorer()
  } else {
    await refreshExplorer()
  }
}

/** Delete the pending items; errors surface in the file list banner. */
export async function confirmExplorerDelete(): Promise<void> {
  const s = useAppStore.getState()
  const dialog = s.explorerOpsDialog
  if (dialog?.kind !== 'delete' || !s.activeProject) return
  try {
    await window.ptnotes.files.explorerDelete(
      s.activeProject,
      dialog.items.map((i) => i.path)
    )
    s.setExplorerOpsDialog(null)
    s.setExplorerSelected([])
    const cwd = s.explorerCwd
    const hit = dialog.items.find((i) => cwd === i.path || cwd.startsWith(i.path + '/'))
    if (hit) await s.loadExplorer(parentOf(hit.path))
    else await refreshExplorer()
  } catch (err) {
    s.setExplorerOpsDialog(null)
    s.setExplorerOpsError(friendlyError(err))
  }
}
