import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  mdiChevronDown,
  mdiChevronRight,
  mdiContentCopy,
  mdiContentCut,
  mdiContentPaste,
  mdiEyeOutline,
  mdiFileCogOutline,
  mdiFolderOpenOutline,
  mdiFolderOutline,
  mdiFolderPlusOutline,
  mdiFolderSearchOutline,
  mdiFolderUploadOutline,
  mdiMerge,
  mdiMenuDown,
  mdiMenuUp,
  mdiOpenInNew,
  mdiPencil,
  mdiTrayArrowDown,
  mdiTrashCanOutline
} from '@mdi/js'
import type {
  ExplorerEntry,
  ExplorerFolderNode,
  ExplorerSort,
  ExplorerSortKey
} from '@shared/types'
import {
  ancestorsOf,
  fileTypeLabel,
  isImageFile,
  isPdfFile,
  isTextFile,
  parentOf,
  visibleExplorerEntries
} from '@shared/filesExplorer'
import { useAppStore } from '../store/useAppStore'
import {
  confirmExplorerDelete,
  copyExplorerPaths,
  cutExplorerPaths,
  openExplorerDelete,
  openExplorerNewFolder,
  openExplorerRename,
  pasteExplorer,
  revealExplorerPath,
  submitExplorerNewFolder,
  submitExplorerRename
} from '../store/explorerOps'
import { friendlyError } from '../errors'
import { ConfirmModal, PromptModal } from './Modal'
import { FileViewer } from './FileViewer'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { PdfPageManager } from './PdfPageManager'
import { PdfMergeDialog } from './PdfMergeDialog'
import { MdiIcon } from './MdiIcon'
import { fileTypeIcon } from './contentIcons'

/** While any of these is on screen, the file list ignores keyboard navigation. */
const FILE_LIST_KEY_GUARD_SELECTOR =
  '.modal-overlay, .command-palette-backdrop, .global-find-overlay, .module-history-backdrop, .menu-overlay, .chat-img-viewer, .file-viewer-backdrop, .pdf-viewer, .pdf-page-manager'

function scrollRowIntoView(path: string): void {
  requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
    const list = document.querySelector<HTMLElement>('.file-explorer-list')
    if (!row || !list) return
    const headerH = list.querySelector<HTMLElement>('.file-explorer-row.header')?.offsetHeight ?? 0
    const listRect = list.getBoundingClientRect()
    const rowTop = row.getBoundingClientRect().top - listRect.top
    const rowBottom = rowTop + row.offsetHeight
    if (rowTop < headerH) {
      list.scrollTop += rowTop - headerH
    } else if (rowBottom > list.clientHeight) {
      list.scrollTop += rowBottom - list.clientHeight
    }
  })
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Clickable column header: cycles ascending → descending → default for its key. */
function SortHeaderButton({
  label,
  sortKey,
  sort,
  onCycle
}: {
  label: string
  sortKey: ExplorerSortKey
  sort: ExplorerSort
  onCycle: (key: ExplorerSortKey) => void
}): React.JSX.Element {
  const active = sort?.key === sortKey
  return (
    <button
      className={`col-sort${active ? ' active' : ''}`}
      title={
        active
          ? sort!.dir === 'asc'
            ? 'Sorted ascending — click for descending'
            : 'Sorted descending — click to reset'
          : `Sort by ${label.toLowerCase()}`
      }
      onClick={(e) => {
        e.stopPropagation()
        onCycle(sortKey)
      }}
    >
      {label}
      {active && (
        <MdiIcon
          path={sort!.dir === 'asc' ? mdiMenuUp : mdiMenuDown}
          size={20}
          className="file-explorer-sort-icon"
        />
      )}
    </button>
  )
}

export function FileTreePanel(): React.JSX.Element {
  const tree = useAppStore((s) => s.explorerTree)
  const cwd = useAppStore((s) => s.explorerCwd)
  const expanded = useAppStore((s) => s.explorerExpanded)
  const collapsed = useAppStore((s) => s.explorerCollapsed)
  const clipboard = useAppStore((s) => s.explorerClipboard)
  const selectFolder = useAppStore((s) => s.selectExplorerFolder)
  const toggleFolder = useAppStore((s) => s.toggleExplorerFolder)

  const effectiveExpanded = useMemo(() => {
    const s = new Set(expanded)
    for (const p of ancestorsOf(cwd)) s.add(p)
    for (const p of collapsed) s.delete(p)
    return s
  }, [expanded, cwd, collapsed])

  /** Right-click target folder ('' = files root). */
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; name: string } | null>(
    null
  )
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function openTreeMenu(e: React.MouseEvent, node: ExplorerFolderNode): void {
    e.preventDefault()
    e.stopPropagation()
    selectFolder(node.path)
    setMenu({ x: e.clientX, y: e.clientY, path: node.path, name: node.name })
    setMenuPos(null)
  }

  function closeMenu(): void {
    setMenu(null)
    setMenuPos(null)
  }

  // Clamp the menu inside the window once its real size is known (before paint).
  useLayoutEffect(() => {
    if (!menu) return
    const el = menuRef.current
    if (!el) return
    setMenuPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - el.offsetWidth - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - el.offsetHeight - 8))
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    function close(): void {
      setMenu(null)
      setMenuPos(null)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const cutPaths = clipboard?.mode === 'cut' ? clipboard.paths : null
  const canPaste = !!clipboard && clipboard.paths.length > 0

  function renderNode(node: ExplorerFolderNode, depth: number): ReactNode {
    const isExpanded = effectiveExpanded.has(node.path)
    const isCwd = cwd === node.path
    const isRoot = node.path === ''
    const isCut = cutPaths?.includes(node.path) ?? false
    return (
      <div key={isRoot ? '__root__' : node.path}>
        <div
          className={`file-explorer-tree-row${isCwd ? ' selected' : ''}${isCut ? ' cut' : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => selectFolder(node.path)}
          onContextMenu={(e) => openTreeMenu(e, node)}
          title={isRoot ? 'files' : node.path}
        >
          <button
            className={`file-explorer-twist${node.children.length ? '' : ' empty'}`}
            onClick={(e) => {
              e.stopPropagation()
              toggleFolder(node.path)
            }}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {node.children.length ? (
              <MdiIcon path={isExpanded ? mdiChevronDown : mdiChevronRight} size={16} />
            ) : null}
          </button>
          <MdiIcon
            path={isCwd ? mdiFolderOpenOutline : mdiFolderOutline}
            size={16}
            className="file-explorer-folder-icon"
          />
          <span className="file-explorer-tree-name">{isRoot ? 'files' : node.name}</span>
        </div>
        {isExpanded && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="file-tree-panel">
      {tree && renderNode(tree, 0)}
      {menu && (
        <>
          <div
            className="menu-overlay"
            onClick={closeMenu}
            onContextMenu={(e) => {
              e.preventDefault()
              closeMenu()
            }}
          />
          <div
            ref={menuRef}
            className="note-menu"
            style={{
              left: menuPos?.x ?? menu.x,
              top: menuPos?.y ?? menu.y,
              visibility: menuPos ? 'visible' : 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="note-menu-item"
              onClick={() => {
                closeMenu()
                openExplorerNewFolder(menu.path)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiFolderPlusOutline} size={16} />
              </span>
              New Folder
            </button>
            <div className="note-menu-sep" />
            <button
              className="note-menu-item"
              disabled={menu.path === ''}
              onClick={() => {
                closeMenu()
                copyExplorerPaths([menu.path])
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiContentCopy} size={16} />
              </span>
              Copy
            </button>
            <button
              className="note-menu-item"
              disabled={menu.path === ''}
              onClick={() => {
                closeMenu()
                cutExplorerPaths([menu.path])
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiContentCut} size={16} />
              </span>
              Cut
            </button>
            <button
              className="note-menu-item"
              disabled={!canPaste}
              onClick={() => {
                closeMenu()
                void pasteExplorer(menu.path)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiContentPaste} size={16} />
              </span>
              Paste
            </button>
            <div className="note-menu-sep" />
            <button
              className="note-menu-item"
              disabled={menu.path === ''}
              onClick={() => {
                closeMenu()
                openExplorerRename(menu.path, menu.name)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiPencil} size={16} />
              </span>
              Rename
            </button>
            <button
              className="note-menu-item"
              disabled={menu.path === ''}
              onClick={() => {
                closeMenu()
                revealExplorerPath(menu.path)
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiFolderSearchOutline} size={16} />
              </span>
              Show in Folder
            </button>
            <div className="note-menu-sep" />
            <button
              className="note-menu-item danger"
              disabled={menu.path === ''}
              onClick={() => {
                closeMenu()
                openExplorerDelete([{ path: menu.path, name: menu.name }])
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiTrashCanOutline} size={16} />
              </span>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Shared new-folder / rename / delete dialogs for the explorer (dialog state lives in the store). */
export function ExplorerOpsDialogs(): React.JSX.Element | null {
  const dialog = useAppStore((s) => s.explorerOpsDialog)
  const [error, setError] = useState<string | null>(null)
  const [lastDialog, setLastDialog] = useState(dialog)
  if (lastDialog !== dialog) {
    setLastDialog(dialog)
    setError(null)
  }
  if (!dialog) return null
  const close = (): void => useAppStore.getState().setExplorerOpsDialog(null)
  if (dialog.kind === 'delete') {
    return (
      <ConfirmModal
        title="Confirm Delete"
        onClose={close}
        onConfirm={() => void confirmExplorerDelete()}
        message={
          <>
            Delete{' '}
            {dialog.items.length === 1
              ? `"${dialog.items[0].name}"`
              : `${dialog.items.length} items`}
            ? This cannot be undone.
          </>
        }
      >
        {dialog.items.length > 1 && (
          <ul className="confirm-list">
            {dialog.items.map((i) => (
              <li key={i.path}>{i.name}</li>
            ))}
          </ul>
        )}
      </ConfirmModal>
    )
  }
  return (
    <PromptModal
      title={dialog.kind === 'newFolder' ? 'New Folder' : 'Rename'}
      placeholder={dialog.kind === 'newFolder' ? 'Folder name' : undefined}
      initialValue={dialog.kind === 'rename' ? dialog.name : ''}
      submitLabel={dialog.kind === 'newFolder' ? 'Create' : 'Rename'}
      error={error}
      onClose={close}
      onSubmit={(value) => {
        void (async () => {
          try {
            if (dialog.kind === 'newFolder') await submitExplorerNewFolder(value)
            else await submitExplorerRename(value)
          } catch (err) {
            setError(friendlyError(err))
          }
        })()
      }}
    />
  )
}

export function FileListPanel(): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const refreshFiles = useAppStore((s) => s.refreshFiles)
  const rawEntries = useAppStore((s) => s.explorerEntries)
  const explorerSort = useAppStore((s) => s.explorerSort)
  const explorerFilter = useAppStore((s) => s.explorerFilter)
  const entries = useMemo(
    () => visibleExplorerEntries(rawEntries, explorerSort, explorerFilter),
    [rawEntries, explorerSort, explorerFilter]
  )
  const cwd = useAppStore((s) => s.explorerCwd)
  const loadExplorer = useAppStore((s) => s.loadExplorer)
  const selected = useAppStore((s) => s.explorerSelected)
  const selectEntry = useAppStore((s) => s.selectExplorerEntry)
  const setSelected = useAppStore((s) => s.setExplorerSelected)
  const uiDensity = useAppStore((s) => s.uiDensity)
  const entryIconSize = uiDensity === 'cozy' ? 24 : 16

  const clipboard = useAppStore((s) => s.explorerClipboard)
  const error = useAppStore((s) => s.explorerOpsError)
  /** Raw right-click point; the menu renders hidden until its real size is measured. */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [menuEntry, setMenuEntry] = useState<ExplorerEntry | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<{ src: string; alt: string } | null>(null)
  const [viewerBulb, setViewerBulb] = useState(false)
  const [fileViewer, setFileViewer] = useState<{ path: string; name: string } | null>(null)
  const [pdfViewer, setPdfViewer] = useState<{ src: string; name: string } | null>(null)
  const [pageManager, setPageManager] = useState<{ path: string; name: string } | null>(null)
  const [mergeDialog, setMergeDialog] = useState<ExplorerEntry[] | null>(null)
  const [dragActive, setDragActive] = useState(false)
  /** Keyboard cursor sits on the virtual `..` row (only reachable via arrow keys).
   *  Stores the cwd it belongs to, so it implicitly resets on any navigation. */
  const [dotDotCwd, setDotDotCwd] = useState<string | null>(null)
  const dotDotSelected = dotDotCwd !== null && dotDotCwd === cwd
  const panelRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const statusbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const panel = panelRef.current
    const tb = toolbarRef.current
    const sb = statusbarRef.current
    if (!panel || !tb || !sb) return
    const apply = (): void => {
      panel.style.setProperty('--explorer-toolbar-h', `${tb.offsetHeight}px`)
      panel.style.setProperty('--explorer-statusbar-h', `${sb.offsetHeight}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(tb)
    ro.observe(sb)
    return () => ro.disconnect()
  }, [])

  const cycleSort = useCallback((key: ExplorerSortKey): void => {
    const cur = useAppStore.getState().explorerSort
    const next: ExplorerSort =
      !cur || cur.key !== key
        ? { key, dir: 'asc' }
        : cur.dir === 'asc'
          ? { key, dir: 'desc' }
          : null
    useAppStore.getState().setExplorerSort(next)
  }, [])

  function onDragOver(e: React.DragEvent): void {
    if (!activeProject) return
    // internal drags (page manager / merge dialog reorders) bubble here too —
    // never show the import overlay while any modal/overlay is on screen
    if (document.querySelector(FILE_LIST_KEY_GUARD_SELECTOR)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }

  function onDragLeave(e: React.DragEvent): void {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragActive(false)
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault()
    setDragActive(false)
    const project = activeProject
    if (!project) return
    if (document.querySelector(FILE_LIST_KEY_GUARD_SELECTOR)) return
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length === 0) return
    void (async () => {
      let imported = 0
      for (const file of dropped) {
        const path = window.ptnotes.files.getPathForFile(file)
        if (!path) continue
        try {
          await window.ptnotes.files.importDropped(project, path, cwd, file.name)
          imported++
        } catch (err) {
          console.error('Failed to import dropped file:', file.name, err)
        }
      }
      if (imported === 0) {
        window.alert('No files could be imported.')
        return
      }
      await loadExplorer()
      void refreshFiles()
    })()
  }

  function closeMenu(): void {
    setMenu(null)
    setMenuPos(null)
    setMenuEntry(null)
  }

  function openMenu(e: React.MouseEvent, entry?: ExplorerEntry): void {
    e.preventDefault()
    e.stopPropagation()
    if (entry && !selected.includes(entry.path)) {
      setDotDotCwd(null)
      selectEntry(entry.path, 'single')
    }
    setMenuEntry(entry ?? null)
    setMenu({ x: e.clientX, y: e.clientY })
    setMenuPos(null)
  }

  // Clamp the menu inside the window once its real size is known (before paint).
  useLayoutEffect(() => {
    if (!menu) return
    const el = menuRef.current
    if (!el) return
    setMenuPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - el.offsetWidth - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - el.offsetHeight - 8))
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    function close(): void {
      setMenu(null)
      setMenuPos(null)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  function onRowClick(e: React.MouseEvent, entry: ExplorerEntry): void {
    e.stopPropagation()
    setDotDotCwd(null)
    const mode = e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single'
    selectEntry(entry.path, mode)
  }

  /** Open a file with the OS default app (Word, Excel, anything not previewable in-app). */
  const openExternalEntry = useCallback((entry: ExplorerEntry): void => {
    const project = useAppStore.getState().activeProject
    if (!project) return
    void window.ptnotes.files.openExternal(project, entry.path).then((err) => {
      if (err) useAppStore.getState().setExplorerOpsError(friendlyError(err))
    })
  }, [])

  /** In-app preview: image viewer, PDF viewer, or text/markdown viewer. */
  const previewEntry = useCallback((entry: ExplorerEntry): void => {
    const openLocalViewer = async (
      entry: ExplorerEntry,
      show: (src: string) => void
    ): Promise<void> => {
      const project = useAppStore.getState().activeProject
      if (!project) return
      const abs = await window.ptnotes.files.absPath(project, entry.path)
      if (!abs) return
      show(/^[a-zA-Z]:/.test(abs) ? `ptfile://local/${abs}` : `ptfile://local${abs}`)
    }
    if (isImageFile(entry.name)) {
      void openLocalViewer(entry, (src) => setViewer({ src, alt: entry.name }))
      return
    }
    if (isPdfFile(entry.name)) {
      void openLocalViewer(entry, (src) => setPdfViewer({ src, name: entry.name }))
      return
    }
    if (isTextFile(entry.name)) setFileViewer({ path: entry.path, name: entry.name })
  }, [])

  /** Double-click / Enter action: preview in-app when possible, else open with the OS default app. */
  const activateEntry = useCallback(
    (entry: ExplorerEntry): void => {
      if (entry.isDir) {
        useAppStore.getState().selectExplorerFolder(entry.path)
        return
      }
      if (isImageFile(entry.name) || isPdfFile(entry.name) || isTextFile(entry.name)) {
        previewEntry(entry)
      } else {
        openExternalEntry(entry)
      }
    },
    [previewEntry, openExternalEntry]
  )

  function onRowDoubleClick(entry: ExplorerEntry): void {
    activateEntry(entry)
  }

  const copySelected = useCallback((): void => {
    copyExplorerPaths(useAppStore.getState().explorerSelected)
  }, [])

  const cutSelected = useCallback((): void => {
    cutExplorerPaths(useAppStore.getState().explorerSelected)
  }, [])

  const paste = useCallback((): void => {
    void pasteExplorer(useAppStore.getState().explorerCwd)
  }, [])

  const openDelete = useCallback((): void => {
    const s = useAppStore.getState()
    if (s.explorerSelected.length === 0) return
    openExplorerDelete(
      s.explorerEntries
        .filter((e) => s.explorerSelected.includes(e.path))
        .map((e) => ({ path: e.path, name: e.name }))
    )
  }, [])

  // Arrow keys move the selection, Space previews and Enter opens (OS default app).
  // Inside a subfolder the virtual `..` row sits above the entries and is selectable.
  useEffect(() => {
    function moveSelection(dir: 1 | -1): void {
      const state = useAppStore.getState()
      const paths = visibleExplorerEntries(
        state.explorerEntries,
        state.explorerSort,
        state.explorerFilter
      ).map((en) => en.path)
      const rows = state.explorerCwd ? ['..', ...paths] : paths
      if (rows.length === 0) return
      const offset = state.explorerCwd ? 1 : 0
      let idx = -1
      if (dotDotSelected) {
        idx = 0
      } else if (state.explorerSelected.length > 0) {
        const anchor =
          state.explorerLastClicked ?? state.explorerSelected[state.explorerSelected.length - 1]
        const cur = paths.findIndex((p) => p === anchor)
        idx = cur === -1 ? -1 : cur + offset
      }
      let next: number
      if (idx === -1) {
        // Nothing selected yet: Down lands on the first real entry, Up on the last row.
        next = dir === 1 ? Math.min(offset, rows.length - 1) : rows.length - 1
      } else {
        next = Math.min(rows.length - 1, Math.max(0, idx + dir))
      }
      if (rows[next] === '..') {
        setDotDotCwd(state.explorerCwd)
        setSelected([])
      } else {
        setDotDotCwd(null)
        state.selectExplorerEntry(rows[next], 'single')
      }
      scrollRowIntoView(rows[next])
    }

    /** Space: preview in-app (directories drill in). Unknown file types do nothing. */
    function previewSelected(): void {
      const entry = singleSelectedEntry()
      if (entry) previewEntry(entry)
      else if (dotDotSelected) drillIntoParent()
    }

    /** Enter: open with the OS default app (directories drill in). */
    function openSelected(): void {
      const entry = singleSelectedEntry()
      if (entry) {
        if (entry.isDir) useAppStore.getState().selectExplorerFolder(entry.path)
        else openExternalEntry(entry)
      } else if (dotDotSelected) {
        drillIntoParent()
      }
    }

    function singleSelectedEntry(): ExplorerEntry | null {
      const state = useAppStore.getState()
      if (state.explorerSelected.length !== 1) return null
      return state.explorerEntries.find((en) => en.path === state.explorerSelected[0]) ?? null
    }

    function drillIntoParent(): void {
      useAppStore.getState().selectExplorerFolder(parentOf(useAppStore.getState().explorerCwd))
    }

    function onKeyDown(e: KeyboardEvent): void {
      const navKey =
        e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' '
      const modKey =
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        ['c', 'x', 'v'].includes(e.key.toLowerCase())
      const delKey = (e.key === 'Delete' || e.key === 'Backspace') && !e.altKey
      if (!navKey && !modKey && !delKey) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (document.querySelector(FILE_LIST_KEY_GUARD_SELECTOR)) return
      if (modKey) {
        const key = e.key.toLowerCase()
        if (key === 'c') copySelected()
        else if (key === 'x') cutSelected()
        else paste()
      } else if (e.key === 'Enter') {
        if (tag === 'BUTTON' || tag === 'A') return
        openSelected()
      } else if (e.key === ' ') {
        previewSelected()
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        moveSelection(e.key === 'ArrowDown' ? 1 : -1)
      } else {
        openDelete()
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    previewEntry,
    openExternalEntry,
    dotDotSelected,
    setSelected,
    copySelected,
    cutSelected,
    paste,
    openDelete
  ])

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.includes(e.path)),
    [entries, selected]
  )
  const selectedPdfEntries = useMemo(
    () => selectedEntries.filter((e) => !e.isDir && isPdfFile(e.name)),
    [selectedEntries]
  )
  const cutPaths = clipboard?.mode === 'cut' ? clipboard.paths : null
  const canPaste = !!clipboard && clipboard.paths.length > 0

  function openPageManager(): void {
    const entry = selectedPdfEntries[0]
    if (!entry || !activeProject) return
    setPageManager({ path: entry.path, name: entry.name })
  }

  function openMergeDialog(): void {
    if (selectedPdfEntries.length < 2 || !activeProject) return
    setMergeDialog(selectedPdfEntries)
  }

  function openNewFolder(): void {
    openExplorerNewFolder(cwd)
  }

  function openRename(): void {
    const entry = selectedEntries[0]
    if (!entry) return
    openExplorerRename(entry.path, entry.name)
  }

  function revealSelected(): void {
    if (selected.length !== 1) return
    revealExplorerPath(selected[0])
  }

  const crumbs = useMemo(() => ancestorsOf(cwd), [cwd])

  return (
    <div
      className="file-list-panel"
      ref={panelRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="file-explorer-toolbar" ref={toolbarRef}>
        <button className="icon-btn" onClick={openNewFolder} title="New folder">
          <MdiIcon path={mdiFolderPlusOutline} size={16} />
          <span>New Folder</span>
        </button>
        <button
          className="icon-btn"
          disabled={selected.length === 0}
          onClick={copySelected}
          title="Copy selected"
        >
          <MdiIcon path={mdiContentCopy} size={16} />
          <span>Copy</span>
        </button>
        <button
          className="icon-btn"
          disabled={selected.length === 0}
          onClick={cutSelected}
          title="Cut selected"
        >
          <MdiIcon path={mdiContentCut} size={16} />
          <span>Cut</span>
        </button>
        <button
          className="icon-btn"
          disabled={!canPaste}
          onClick={paste}
          title={clipboard ? `Paste ${clipboard.paths.length} item(s)` : 'Paste'}
        >
          <MdiIcon path={mdiContentPaste} size={16} />
          <span>Paste</span>
        </button>
        <button
          className="icon-btn"
          disabled={selected.length !== 1}
          onClick={openRename}
          title="Rename selected"
        >
          <MdiIcon path={mdiPencil} size={16} />
          <span>Rename</span>
        </button>
        <button
          className="icon-btn danger"
          disabled={selected.length === 0}
          onClick={openDelete}
          title="Delete selected"
        >
          <MdiIcon path={mdiTrashCanOutline} size={16} />
          <span>Delete</span>
        </button>
        <button
          className="icon-btn"
          disabled={selected.length !== 1}
          onClick={revealSelected}
          title="Show in folder"
        >
          <MdiIcon path={mdiFolderSearchOutline} size={16} />
          <span>Show in Folder</span>
        </button>
        {selectedPdfEntries.length === 1 && (
          <button
            className="icon-btn"
            onClick={openPageManager}
            title="Manage pages of the selected PDF"
          >
            <MdiIcon path={mdiFileCogOutline} size={16} />
            <span>Manage Pages</span>
          </button>
        )}
        {selectedPdfEntries.length >= 2 && (
          <button
            className="icon-btn"
            onClick={openMergeDialog}
            title="Merge the selected PDFs into a new file"
          >
            <MdiIcon path={mdiMerge} size={16} />
            <span>Merge PDFs</span>
          </button>
        )}
        <div className="file-explorer-filter">
          <input
            type="text"
            className="note-filter"
            placeholder="Filter files"
            value={explorerFilter}
            onChange={(e) => useAppStore.getState().setExplorerFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                useAppStore.getState().setExplorerFilter('')
              }
            }}
          />
          {explorerFilter && (
            <button
              className="note-filter-clear"
              title="Clear filter"
              onClick={() => useAppStore.getState().setExplorerFilter('')}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {error && <div className="file-explorer-error">{error}</div>}
      <div
        className="file-explorer-list"
        onClick={() => {
          setSelected([])
          setDotDotCwd(null)
        }}
        onContextMenu={(e) => openMenu(e)}
      >
        <div className="file-explorer-row header">
          <span className="col-name">
            <SortHeaderButton label="Name" sortKey="name" sort={explorerSort} onCycle={cycleSort} />
          </span>
          <span className="col-type">
            <SortHeaderButton label="Type" sortKey="type" sort={explorerSort} onCycle={cycleSort} />
          </span>
          <span className="col-size">
            <SortHeaderButton label="Size" sortKey="size" sort={explorerSort} onCycle={cycleSort} />
          </span>
          <span className="col-modified">
            <SortHeaderButton
              label="Modified"
              sortKey="modified"
              sort={explorerSort}
              onCycle={cycleSort}
            />
          </span>
        </div>
        {cwd !== '' && (
          <div
            className={`file-explorer-row parent-row${dotDotSelected ? ' selected' : ''}`}
            data-path=".."
            title={parentOf(cwd) || 'files'}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={() => useAppStore.getState().selectExplorerFolder(parentOf(cwd))}
            onContextMenu={(e) => openMenu(e)}
          >
            <span className="col-name">
              <MdiIcon
                path={mdiFolderUploadOutline}
                size={entryIconSize}
                className="file-explorer-entry-icon"
              />
              <span className="col-name-text">..</span>
            </span>
            <span className="col-type" />
            <span className="col-size" />
            <span className="col-modified" />
          </div>
        )}
        {entries.map((entry) => {
          const isCut = cutPaths?.includes(entry.path) ?? false
          return (
            <div
              key={entry.path}
              data-path={entry.path}
              className={`file-explorer-row${selected.includes(entry.path) ? ' selected' : ''}${
                isCut ? ' cut' : ''
              }`}
              onClick={(e) => onRowClick(e, entry)}
              onDoubleClick={() => onRowDoubleClick(entry)}
              onContextMenu={(e) => openMenu(e, entry)}
            >
              <span className="col-name" title={entry.path}>
                <MdiIcon
                  path={entry.isDir ? mdiFolderOutline : fileTypeIcon(entry.name)}
                  size={entryIconSize}
                  className="file-explorer-entry-icon"
                />
                <span className="col-name-text">{entry.name}</span>
              </span>
              <span className="col-type">{fileTypeLabel(entry.name, entry.isDir)}</span>
              <span className="col-size">{formatSize(entry.size)}</span>
              <span className="col-modified">{formatDate(entry.mtime)}</span>
            </div>
          )
        })}
        {entries.length === 0 && (
          <div className="file-explorer-empty">
            {explorerFilter ? 'No matches' : 'This folder is empty'}
          </div>
        )}
      </div>
      <div className="file-explorer-statusbar" ref={statusbarRef}>
        <span className="file-explorer-item-count">
          {explorerFilter
            ? `${entries.length} of ${rawEntries.length} items`
            : `${entries.length} item${entries.length === 1 ? '' : 's'}`}
        </span>
        <span className="file-explorer-statusbar-sep" />
        <MdiIcon
          path={mdiFolderOutline}
          size={16}
          className="file-explorer-entry-icon file-explorer-crumb-icon"
        />
        {crumbs.map((path, i) => (
          <span key={path || '__root__'} className="file-explorer-crumb-item">
            {i > 0 && <span className="file-explorer-crumb-sep">/</span>}
            <button
              className={`file-explorer-crumb${path === cwd ? ' active' : ''}`}
              onClick={() => useAppStore.getState().selectExplorerFolder(path)}
            >
              {i === 0 ? 'files' : path.split('/').pop()}
            </button>
          </span>
        ))}
      </div>
      {menu && (
        <>
          <div
            className="menu-overlay"
            onClick={closeMenu}
            onContextMenu={(e) => {
              e.preventDefault()
              closeMenu()
            }}
          />
          <div
            ref={menuRef}
            className="note-menu"
            style={{
              left: menuPos?.x ?? menu.x,
              top: menuPos?.y ?? menu.y,
              visibility: menuPos ? 'visible' : 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {menuEntry && !menuEntry.isDir && (
              <>
                {(isImageFile(menuEntry.name) ||
                  isPdfFile(menuEntry.name) ||
                  isTextFile(menuEntry.name)) && (
                  <button
                    className="note-menu-item"
                    onClick={() => {
                      closeMenu()
                      previewEntry(menuEntry)
                    }}
                  >
                    <span className="note-menu-icon">
                      <MdiIcon path={mdiEyeOutline} size={16} />
                    </span>
                    Preview
                  </button>
                )}
                <button
                  className="note-menu-item"
                  onClick={() => {
                    closeMenu()
                    openExternalEntry(menuEntry)
                  }}
                >
                  <span className="note-menu-icon">
                    <MdiIcon path={mdiOpenInNew} size={16} />
                  </span>
                  Open
                </button>
                <div className="note-menu-sep" />
              </>
            )}
            <button
              className="note-menu-item"
              onClick={() => {
                closeMenu()
                openNewFolder()
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiFolderPlusOutline} size={16} />
              </span>
              New Folder
            </button>
            <div className="note-menu-sep" />
            <button
              className="note-menu-item"
              disabled={selected.length === 0}
              onClick={() => {
                closeMenu()
                copySelected()
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiContentCopy} size={16} />
              </span>
              Copy
            </button>
            <button
              className="note-menu-item"
              disabled={selected.length === 0}
              onClick={() => {
                closeMenu()
                cutSelected()
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiContentCut} size={16} />
              </span>
              Cut
            </button>
            <button
              className="note-menu-item"
              disabled={!canPaste}
              onClick={() => {
                closeMenu()
                paste()
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiContentPaste} size={16} />
              </span>
              Paste
            </button>
            <div className="note-menu-sep" />
            <button
              className="note-menu-item"
              disabled={selected.length !== 1}
              onClick={() => {
                closeMenu()
                openRename()
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiPencil} size={16} />
              </span>
              Rename
            </button>
            <button
              className="note-menu-item"
              disabled={selected.length !== 1}
              onClick={() => {
                closeMenu()
                revealSelected()
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiFolderSearchOutline} size={16} />
              </span>
              Show in Folder
            </button>
            {selectedPdfEntries.length === 1 && (
              <button
                className="note-menu-item"
                onClick={() => {
                  closeMenu()
                  openPageManager()
                }}
              >
                <span className="note-menu-icon">
                  <MdiIcon path={mdiFileCogOutline} size={16} />
                </span>
                Manage Pages
              </button>
            )}
            {selectedPdfEntries.length >= 2 && (
              <button
                className="note-menu-item"
                onClick={() => {
                  closeMenu()
                  openMergeDialog()
                }}
              >
                <span className="note-menu-icon">
                  <MdiIcon path={mdiMerge} size={16} />
                </span>
                Merge PDFs
              </button>
            )}
            <div className="note-menu-sep" />
            <button
              className="note-menu-item danger"
              disabled={selected.length === 0}
              onClick={() => {
                closeMenu()
                openDelete()
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiTrashCanOutline} size={16} />
              </span>
              Delete
            </button>
          </div>
        </>
      )}
      <ExplorerOpsDialogs />
      {viewer && (
        <ImageViewer
          src={viewer.src}
          alt={viewer.alt}
          onClose={() => setViewer(null)}
          bulbLight={viewerBulb}
          onBulbLight={setViewerBulb}
        />
      )}
      {pdfViewer && (
        <PdfViewer src={pdfViewer.src} name={pdfViewer.name} onClose={() => setPdfViewer(null)} />
      )}
      {pageManager && activeProject && (
        <PdfPageManager
          project={activeProject}
          path={pageManager.path}
          name={pageManager.name}
          onClose={() => setPageManager(null)}
          onSaved={(newPath) => {
            setPageManager(null)
            setSelected([newPath])
            void loadExplorer()
            void refreshFiles()
          }}
        />
      )}
      {mergeDialog && activeProject && (
        <PdfMergeDialog
          project={activeProject}
          entries={mergeDialog}
          destSubpath={cwd}
          onClose={() => setMergeDialog(null)}
          onMerged={(newPath) => {
            setMergeDialog(null)
            setSelected([newPath])
            void loadExplorer()
            void refreshFiles()
          }}
        />
      )}
      {fileViewer && (
        <FileViewer
          path={fileViewer.path}
          name={fileViewer.name}
          onClose={() => setFileViewer(null)}
        />
      )}
      {dragActive && (
        <div className="file-drop-overlay">
          <MdiIcon path={mdiTrayArrowDown} size={32} />
          <span>Drop files to import into {cwd ? cwd.split('/').pop() : 'files'}</span>
        </div>
      )}
    </div>
  )
}
