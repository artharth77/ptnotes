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
  mdiFolderOpenOutline,
  mdiFolderOutline,
  mdiFolderPlusOutline,
  mdiFolderSearchOutline,
  mdiFolderUploadOutline,
  mdiMenuDown,
  mdiMenuUp,
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
  visibleExplorerEntries
} from '@shared/filesExplorer'
import { useAppStore } from '../store/useAppStore'
import { friendlyError } from '../errors'
import { Modal, PromptModal } from './Modal'
import { FileViewer } from './FileViewer'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { MdiIcon } from './MdiIcon'
import { fileTypeIcon } from './contentIcons'

type Clipboard = { paths: string[]; mode: 'copy' | 'cut' }
type Dialog =
  { kind: 'newFolder' } | { kind: 'rename'; entry: ExplorerEntry } | { kind: 'delete' } | null

/** While any of these is on screen, the file list ignores keyboard navigation. */
const FILE_LIST_KEY_GUARD_SELECTOR =
  '.modal-overlay, .command-palette-backdrop, .global-find-overlay, .module-history-backdrop, .menu-overlay, .chat-img-viewer, .file-viewer-backdrop, .pdf-viewer'

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

function parentOf(dir: string): string {
  const idx = dir.lastIndexOf('/')
  return idx === -1 ? '' : dir.slice(0, idx)
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
  const selectFolder = useAppStore((s) => s.selectExplorerFolder)
  const toggleFolder = useAppStore((s) => s.toggleExplorerFolder)

  const effectiveExpanded = useMemo(() => {
    const s = new Set(expanded)
    for (const p of ancestorsOf(cwd)) s.add(p)
    for (const p of collapsed) s.delete(p)
    return s
  }, [expanded, cwd, collapsed])

  function renderNode(node: ExplorerFolderNode, depth: number): ReactNode {
    const isExpanded = effectiveExpanded.has(node.path)
    const isCwd = cwd === node.path
    const isRoot = node.path === ''
    return (
      <div key={isRoot ? '__root__' : node.path}>
        <div
          className={`file-explorer-tree-row${isCwd ? ' selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => selectFolder(node.path)}
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
              <MdiIcon path={isExpanded ? mdiChevronDown : mdiChevronRight} size={14} />
            ) : null}
          </button>
          <MdiIcon
            path={isCwd ? mdiFolderOpenOutline : mdiFolderOutline}
            size={15}
            className="file-explorer-folder-icon"
          />
          <span className="file-explorer-tree-name">{isRoot ? 'files' : node.name}</span>
        </div>
        {isExpanded && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return <div className="file-tree-panel">{tree && renderNode(tree, 0)}</div>
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

  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  /** Latest clipboard for the keyboard handler (avoids stale effect closures). */
  const clipboardRef = useRef<Clipboard | null>(null)
  useEffect(() => {
    clipboardRef.current = clipboard
  }, [clipboard])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Raw right-click point; the menu renders hidden until its real size is measured. */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<{ src: string; alt: string } | null>(null)
  const [fileViewer, setFileViewer] = useState<{ path: string; name: string } | null>(null)
  const [pdfViewer, setPdfViewer] = useState<{ src: string; name: string } | null>(null)
  const [dragActive, setDragActive] = useState(false)
  /** Keyboard cursor sits on the virtual `..` row (only reachable via arrow keys).
   *  Stores the cwd it belongs to, so it implicitly resets on any navigation. */
  const [dotDotCwd, setDotDotCwd] = useState<string | null>(null)
  const dotDotSelected = dotDotCwd !== null && dotDotCwd === cwd

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
  }

  function openMenu(e: React.MouseEvent, entry?: ExplorerEntry): void {
    e.preventDefault()
    e.stopPropagation()
    if (entry && !selected.includes(entry.path)) {
      setDotDotCwd(null)
      selectEntry(entry.path, 'single')
    }
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

  /** Double-click / Enter action for an entry (drill in, view image / PDF, preview text). */
  const activateEntry = useCallback((entry: ExplorerEntry): void => {
    if (entry.isDir) {
      useAppStore.getState().selectExplorerFolder(entry.path)
      return
    }
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

  function onRowDoubleClick(entry: ExplorerEntry): void {
    activateEntry(entry)
  }

  const runAction = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      const project = useAppStore.getState().activeProject
      if (!project) return
      setError(null)
      try {
        await fn()
        await loadExplorer()
        void refreshFiles()
      } catch (err) {
        setError(friendlyError(err))
      }
    },
    [loadExplorer, refreshFiles]
  )

  const copySelected = useCallback((): void => {
    const sel = useAppStore.getState().explorerSelected
    if (sel.length === 0) return
    setClipboard({ paths: [...sel], mode: 'copy' })
  }, [setClipboard])

  const cutSelected = useCallback((): void => {
    const sel = useAppStore.getState().explorerSelected
    if (sel.length === 0) return
    setClipboard({ paths: [...sel], mode: 'cut' })
  }, [setClipboard])

  const paste = useCallback((): void => {
    const project = useAppStore.getState().activeProject
    const clip = clipboardRef.current
    if (!project || !clip || clip.paths.length === 0) return
    if (clip.mode === 'cut') setClipboard(null)
    void runAction(() =>
      clip.mode === 'copy'
        ? window.ptnotes.files.explorerCopy(project, clip.paths, useAppStore.getState().explorerCwd)
        : window.ptnotes.files.explorerMove(project, clip.paths, useAppStore.getState().explorerCwd)
    )
  }, [setClipboard, runAction])

  const openDelete = useCallback((): void => {
    if (useAppStore.getState().explorerSelected.length === 0) return
    setDialogError(null)
    setDialog({ kind: 'delete' })
  }, [setDialogError, setDialog])

  // Arrow keys move the selection, Enter activates it (same as double-click).
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

    function activateSelected(): void {
      if (dotDotSelected) {
        useAppStore.getState().selectExplorerFolder(parentOf(useAppStore.getState().explorerCwd))
        return
      }
      const state = useAppStore.getState()
      if (state.explorerSelected.length !== 1) return
      const entry = state.explorerEntries.find((en) => en.path === state.explorerSelected[0])
      if (entry) activateEntry(entry)
    }

    function onKeyDown(e: KeyboardEvent): void {
      const navKey = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter'
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
        activateSelected()
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        moveSelection(e.key === 'ArrowDown' ? 1 : -1)
      } else {
        openDelete()
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activateEntry, dotDotSelected, setSelected, copySelected, cutSelected, paste, openDelete])

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.includes(e.path)),
    [entries, selected]
  )
  const cutPaths = clipboard?.mode === 'cut' ? clipboard.paths : null
  const canPaste = !!clipboard && clipboard.paths.length > 0

  function submitRename(name: string): void {
    if (dialog?.kind !== 'rename' || !activeProject) return
    const entry = dialog.entry
    void (async () => {
      try {
        const newPath = await window.ptnotes.files.explorerRename(activeProject, entry.path, name)
        setDialog(null)
        setDialogError(null)
        setSelected([newPath])
        await loadExplorer()
        void refreshFiles()
      } catch (err) {
        setDialogError(friendlyError(err))
      }
    })()
  }

  function submitNewFolder(name: string): void {
    if (!activeProject) return
    void (async () => {
      try {
        await window.ptnotes.files.explorerCreateFolder(activeProject, cwd, name)
        setDialog(null)
        setDialogError(null)
        useAppStore.setState((s) => ({
          explorerExpanded: [...new Set([...s.explorerExpanded, cwd])]
        }))
        await loadExplorer()
        void refreshFiles()
      } catch (err) {
        setDialogError(friendlyError(err))
      }
    })()
  }

  function submitDelete(): void {
    if (!activeProject) return
    void (async () => {
      try {
        await window.ptnotes.files.explorerDelete(activeProject, selected)
        setDialog(null)
        setSelected([])
        await loadExplorer()
        void refreshFiles()
      } catch (err) {
        setDialog(null)
        setError(friendlyError(err))
      }
    })()
  }

  function openNewFolder(): void {
    setDialogError(null)
    setDialog({ kind: 'newFolder' })
  }

  function openRename(): void {
    const entry = selectedEntries[0]
    if (!entry) return
    setDialogError(null)
    setDialog({ kind: 'rename', entry })
  }

  function revealSelected(): void {
    if (!activeProject || selected.length !== 1) return
    void window.ptnotes.files.revealByName(activeProject, selected[0]).catch(() => {})
  }

  const crumbs = useMemo(() => ancestorsOf(cwd), [cwd])

  return (
    <div
      className="file-list-panel"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="file-explorer-toolbar">
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
      <div className="file-explorer-statusbar">
        <span className="file-explorer-item-count">
          {explorerFilter
            ? `${entries.length} of ${rawEntries.length} items`
            : `${entries.length} item${entries.length === 1 ? '' : 's'}`}
        </span>
        <span className="file-explorer-statusbar-sep" />
        <MdiIcon
          path={mdiFolderOutline}
          size={14}
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
            <button
              className="note-menu-item"
              onClick={() => {
                closeMenu()
                openNewFolder()
              }}
            >
              <span className="note-menu-icon">
                <MdiIcon path={mdiFolderPlusOutline} size={15} />
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
                <MdiIcon path={mdiContentCopy} size={15} />
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
                <MdiIcon path={mdiContentCut} size={15} />
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
                <MdiIcon path={mdiContentPaste} size={15} />
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
                <MdiIcon path={mdiPencil} size={15} />
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
                <MdiIcon path={mdiFolderSearchOutline} size={15} />
              </span>
              Show in Folder
            </button>
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
                <MdiIcon path={mdiTrashCanOutline} size={15} />
              </span>
              Delete
            </button>
          </div>
        </>
      )}
      {dialog?.kind === 'newFolder' && (
        <PromptModal
          title="New Folder"
          placeholder="Folder name"
          submitLabel="Create"
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={submitNewFolder}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptModal
          title="Rename"
          initialValue={dialog.entry.name}
          submitLabel="Rename"
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={submitRename}
        />
      )}
      {dialog?.kind === 'delete' && (
        <Modal title="Confirm Delete" onClose={() => setDialog(null)}>
          <p className="confirm-message">
            Delete{' '}
            {selected.length === 1 ? `"${selectedEntries[0]?.name}"` : `${selected.length} items`}?
            This cannot be undone.
          </p>
          {selected.length > 1 && (
            <ul className="confirm-list">
              {selectedEntries.map((e) => (
                <li key={e.path}>{e.name}</li>
              ))}
            </ul>
          )}
          <div className="modal-actions">
            <button className="btn" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button className="btn danger" onClick={submitDelete}>
              Delete
            </button>
          </div>
        </Modal>
      )}
      {viewer && <ImageViewer src={viewer.src} alt={viewer.alt} onClose={() => setViewer(null)} />}
      {pdfViewer && (
        <PdfViewer src={pdfViewer.src} name={pdfViewer.name} onClose={() => setPdfViewer(null)} />
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
