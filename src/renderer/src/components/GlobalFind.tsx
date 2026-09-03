import { useEffect, useMemo, useRef } from 'react'
import { mdiFileDocumentOutline, mdiMagnify } from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { MdiIcon } from './MdiIcon'

function SnippetWithHighlight({
  snippet,
  start,
  end
}: {
  snippet: string
  start: number
  end: number
}): React.JSX.Element {
  const safeStart = Math.max(0, Math.min(start, snippet.length))
  const safeEnd = Math.max(safeStart, Math.min(end, snippet.length))
  const before = snippet.slice(0, safeStart)
  const match = snippet.slice(safeStart, safeEnd)
  const after = snippet.slice(safeEnd)
  return (
    <>
      <span>{before}</span>
      <mark className="search-match">{match}</mark>
      <span>{after}</span>
    </>
  )
}

export function GlobalFind(): React.JSX.Element | null {
  const open = useAppStore((s) => s.globalFindOpen)
  const query = useAppStore((s) => s.globalFindQuery)
  const matches = useAppStore((s) => s.globalFindMatches)
  const loading = useAppStore((s) => s.globalFindLoading)
  const setOpen = useAppStore((s) => s.setGlobalFindOpen)
  const setQuery = useAppStore((s) => s.setGlobalFindQuery)
  const runFind = useAppStore((s) => s.runGlobalFind)
  const clearFind = useAppStore((s) => s.clearGlobalFind)
  const selectNote = useAppStore((s) => s.selectNote)
  const setTab = useAppStore((s) => s.setTab)
  const inputRef = useRef<HTMLInputElement>(null)

  const grouped = useMemo(() => {
    const byNote = new Map<string, typeof matches>()
    for (const m of matches) {
      const arr = byNote.get(m.noteId) ?? []
      arr.push(m)
      byNote.set(m.noteId, arr)
    }
    return Array.from(byNote.entries())
  }, [matches])

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 10)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [open])

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (query.length >= 2) void runFind(query)
      else if (query.length === 0) setQuery('')
    }, 180)
    return () => window.clearTimeout(id)
  }, [query, runFind, setQuery])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        clearFind()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, clearFind])

  if (!open) return null

  return (
    <div className="global-find-overlay" onClick={() => clearFind()}>
      <div className="global-find-panel" onClick={(e) => e.stopPropagation()}>
        <div className="global-find-header">
          <MdiIcon path={mdiMagnify} size={18} style={{ color: 'var(--text-dim)' }} />
          <input
            ref={inputRef}
            className="global-find-input"
            placeholder="Search in all notes (Ctrl/Cmd+Shift+F)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {loading && <span className="search-loading">…</span>}
          <button
            className="icon-btn small"
            title="Close (Esc)"
            onClick={() => clearFind()}
            style={{ marginLeft: 4 }}
          >
            ✕
          </button>
        </div>
        <div className="global-find-results">
          {query.length < 2 && !matches.length && (
            <div className="list-empty">Type at least 2 characters to search across notes.</div>
          )}
          {query.length >= 2 && !loading && matches.length === 0 && (
            <div className="list-empty">No matches for &quot;{query}&quot;</div>
          )}
          {grouped.map(([noteId, list]) => (
            <div key={noteId} className="search-note-group">
              <button
                type="button"
                className="search-note-title"
                onClick={() => {
                  setTab('notes')
                  void selectNote(noteId)
                  setOpen(false)
                }}
              >
                <MdiIcon path={mdiFileDocumentOutline} size={14} />
                <span>{list[0].name}</span>
                <span className="search-match-count">{list.length}</span>
              </button>
              <div className="search-match-list">
                {list.map((m, i) => (
                  <button
                    key={`${noteId}-${i}`}
                    type="button"
                    className="search-match-item"
                    onClick={() => {
                      setTab('notes')
                      void selectNote(noteId)
                      setOpen(false)
                    }}
                    title={m.name}
                  >
                    <span className="search-line-num">L{m.line}</span>
                    <span className="search-snippet">
                      <SnippetWithHighlight
                        snippet={m.snippet}
                        start={m.matchStart}
                        end={m.matchEnd}
                      />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="global-find-footer">
          <span className="find-hint">
            <kbd>Esc</kbd> close · click to open note
          </span>
          {matches.length > 0 && (
            <span className="find-meta">
              {matches.length} match{matches.length === 1 ? '' : 'es'} · {grouped.length} note
              {grouped.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
