import { useEffect, useState } from 'react'
import { mdiClose, mdiFileDocumentOutline } from '@mdi/js'
import { isMarkdownFile } from '@shared/filesExplorer'
import { useAppStore } from '../store/useAppStore'
import { friendlyError } from '../errors'
import { MdiIcon } from './MdiIcon'
import { MarkdownContent } from './MarkdownContent'
import { fileTypeIcon } from './contentIcons'

/**
 * Read-only preview for a text file in the project files folder: markdown files
 * render rich via MarkdownContent, everything else as a scrollable plain-text block.
 */
export function FileViewer({
  path,
  name,
  onClose
}: {
  path: string
  name: string
  onClose: () => void
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const project = useAppStore.getState().activeProject
      if (!project) return
      try {
        const content = await window.ptnotes.files.readText(project, path)
        if (!cancelled) setText(content)
      } catch (err) {
        if (!cancelled) setError(friendlyError(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="file-viewer-backdrop" onClick={onClose}>
      <div className="file-viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="file-viewer-header">
          <MdiIcon
            path={isMarkdownFile(name) ? mdiFileDocumentOutline : fileTypeIcon(name)}
            size={16}
          />
          <span className="file-viewer-name" title={path}>
            {name}
          </span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <MdiIcon path={mdiClose} size={16} />
          </button>
        </div>
        <div className="file-viewer-body">
          {error && <div className="file-viewer-error">{error}</div>}
          {!error && text == null && <div className="file-viewer-loading">Loading…</div>}
          {text != null &&
            (isMarkdownFile(name) ? (
              <MarkdownContent content={text} />
            ) : (
              <pre className="file-viewer-pre">{text}</pre>
            ))}
        </div>
      </div>
    </div>
  )
}
