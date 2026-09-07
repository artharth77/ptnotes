import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mdiDeleteOutline, mdiFileRotateRight, mdiRestore } from '@mdi/js'
import type { PdfPageThumbnail } from '@shared/types'
import { MdiIcon } from './MdiIcon'
import { friendlyError } from '../errors'

const MAX_CONCURRENT_RENDERS = 4

/**
 * Interactive PDF page manager (fullscreen overlay): lazy page thumbnails with
 * drag reorder, per-page 90° clockwise rotation and delete. Saving always
 * writes a NEW pdf (`name (pages).pdf`) via `pdf.rebuild` — the source file is
 * never modified.
 */
export function PdfPageManager({
  project,
  path,
  name,
  onClose,
  onSaved
}: {
  project: string
  path: string
  name: string
  onClose: () => void
  onSaved: (newPath: string) => void
}): React.JSX.Element {
  const [total, setTotal] = useState<number | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [pages, setPages] = useState<number[]>([])
  const [initialPages, setInitialPages] = useState<number[]>([])
  const [rotations, setRotations] = useState<Map<number, number>>(new Map())
  const [baseRotations, setBaseRotations] = useState<Map<number, number>>(new Map())
  const [removed, setRemoved] = useState<Set<number>>(new Set())
  const [thumbs, setThumbs] = useState<Map<number, PdfPageThumbnail>>(new Map())
  const [loading, setLoading] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<Map<number, string>>(new Map())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Refs mirroring state for the IntersectionObserver callback (avoids stale closures). */
  const thumbsRef = useRef(thumbs)
  const loadingRef = useRef(loading)
  const errorsRef = useRef(errors)
  const rotationsRef = useRef(rotations)
  const baseRotationsRef = useRef(baseRotations)
  const queueRef = useRef<{ page: number; rotation: number }[]>([])
  const activeRef = useRef(0)

  useEffect(() => {
    thumbsRef.current = thumbs
  }, [thumbs])
  useEffect(() => {
    loadingRef.current = loading
  }, [loading])
  useEffect(() => {
    errorsRef.current = errors
  }, [errors])
  useEffect(() => {
    rotationsRef.current = rotations
  }, [rotations])
  useEffect(() => {
    baseRotationsRef.current = baseRotations
  }, [baseRotations])

  useEffect(() => {
    let cancelled = false
    window.ptnotes.pdf
      .info(project, path)
      .then((info) => {
        if (cancelled) return
        const ordered = Array.from({ length: info.pages }, (_, i) => i + 1)
        const base = new Map(info.rotations.map((rot, i) => [i + 1, rot]))
        setTotal(info.pages)
        setPages(ordered)
        setInitialPages(ordered)
        setRotations(new Map(base))
        setBaseRotations(base)
      })
      .catch((err) => {
        if (cancelled) return
        setInfoError(friendlyError(err))
      })
    return () => {
      cancelled = true
    }
  }, [project, path])

  const renderThumb = useCallback(
    async (page: number, rotation: number): Promise<void> => {
      setLoading((prev) => new Set(prev).add(page))
      setErrors((prev) => {
        const next = new Map(prev)
        next.delete(page)
        return next
      })
      try {
        const thumb = await window.ptnotes.pdf.renderPage(project, path, page, rotation)
        setThumbs((prev) => new Map(prev).set(page, thumb))
      } catch (err) {
        setErrors((prev) => new Map(prev).set(page, friendlyError(err)))
      } finally {
        setLoading((prev) => {
          const next = new Set(prev)
          next.delete(page)
          return next
        })
      }
    },
    [project, path]
  )

  const pumpQueue = useCallback((): void => {
    while (activeRef.current < MAX_CONCURRENT_RENDERS && queueRef.current.length > 0) {
      const job = queueRef.current.shift()!
      const wanted =
        rotationsRef.current.get(job.page) ?? baseRotationsRef.current.get(job.page) ?? 0
      if (wanted !== job.rotation || thumbsRef.current.has(job.page)) continue
      activeRef.current++
      void renderThumb(job.page, job.rotation).finally(() => {
        activeRef.current--
        pumpQueue()
      })
    }
  }, [renderThumb])

  /** Lazy-load thumbnails: render a page when its card scrolls into view. */
  const enqueueRender = useCallback(
    (page: number): void => {
      const rotation = rotationsRef.current.get(page) ?? baseRotationsRef.current.get(page) ?? 0
      if (thumbsRef.current.has(page)) return
      if (loadingRef.current.has(page)) return
      if (errorsRef.current.has(page)) return
      if (queueRef.current.some((job) => job.page === page)) return
      queueRef.current.push({ page, rotation })
      pumpQueue()
    },
    [pumpQueue]
  )

  useEffect(() => {
    if (total == null) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const page = Number((entry.target as HTMLElement).dataset.page)
          if (Number.isInteger(page)) enqueueRender(page)
          observer.unobserve(entry.target)
        }
      },
      { root: null, rootMargin: '200px' }
    )
    const cards = document.querySelectorAll<HTMLElement>('.pdf-page-card[data-page]')
    cards.forEach((card) => observer.observe(card))
    return () => observer.disconnect()
  }, [total, enqueueRender, pages])

  const close = useCallback((): void => {
    setClosing(true)
    closeTimerRef.current = setTimeout(() => {
      onClose()
      setClosing(false)
    }, 200)
  }, [onClose])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const rotate = useCallback(
    (page: number): void => {
      const base = baseRotationsRef.current.get(page) ?? 0
      const current = rotationsRef.current.get(page) ?? base
      const next = (current + 90) % 360
      setRotations((prev) => new Map(prev).set(page, next))
      void renderThumb(page, next)
    },
    [renderThumb]
  )

  const toggleRemoved = useCallback((page: number): void => {
    setRemoved((prev) => {
      const next = new Set(prev)
      if (next.has(page)) next.delete(page)
      else next.add(page)
      return next
    })
  }, [])

  const reorder = useCallback((from: number, to: number): void => {
    if (from === to) return
    setPages((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  const dirty = useMemo((): boolean => {
    const kept = pages.filter((p) => !removed.has(p))
    if (kept.length === 0) return false
    const originalKept = initialPages.filter((p) => !removed.has(p))
    const orderChanged =
      kept.length !== originalKept.length || kept.some((p, i) => p !== originalKept[i])
    const rotationChanged = [...rotations.entries()].some(
      ([page, rot]) => rot !== baseRotations.get(page)
    )
    return removed.size > 0 || orderChanged || rotationChanged
  }, [pages, removed, initialPages, rotations, baseRotations])

  const save = useCallback(async (): Promise<void> => {
    if (!dirty || saving) return
    const edits = pages
      .filter((p) => !removed.has(p))
      .map((p) => ({
        page: p,
        rotation: (rotations.get(p) ?? baseRotations.get(p) ?? 0) as 0 | 90 | 180 | 270
      }))
    setSaving(true)
    setSaveError(null)
    try {
      const newPath = await window.ptnotes.pdf.rebuild(project, path, edits)
      onSaved(newPath)
    } catch (err) {
      setSaveError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }, [dirty, saving, pages, removed, rotations, baseRotations, project, path, onSaved])

  const keptCount = pages.filter((p) => !removed.has(p)).length
  const subtitle =
    total == null
      ? 'Loading pages…'
      : `${keptCount} of ${total} pages${removed.size > 0 ? ` · ${removed.size} removed` : ''}${
          dirty ? ' · modified' : ''
        }`

  return (
    <div className={`pdf-page-manager${closing ? ' closing' : ''}`}>
      <div className="pdf-page-manager-header">
        <div className="pdf-page-manager-title">
          <span className="pdf-page-manager-name" title={name}>
            {name}
          </span>
          <span className="pdf-page-manager-subtitle">{subtitle}</span>
        </div>
        <div className="pdf-page-manager-actions">
          <button
            className="btn primary"
            disabled={!dirty || saving || keptCount === 0}
            onClick={() => void save()}
            title="Save the edited pages as a new PDF"
          >
            {saving ? 'Saving…' : 'Save as New'}
          </button>
          <button className="pdf-viewer-close" onClick={close} title="Close page manager">
            ✕
          </button>
        </div>
      </div>
      {infoError && (
        <div className="pdf-page-manager-banner error">
          <span>{infoError}</span>
          <button className="btn" onClick={close}>
            Close
          </button>
        </div>
      )}
      {saveError && <div className="pdf-page-manager-banner error">{saveError}</div>}
      <div className="pdf-page-manager-body">
        {total == null && !infoError && (
          <div className="pdf-page-manager-loading">Loading pages…</div>
        )}
        {total != null && (
          <div className="pdf-page-grid">
            {pages.map((page, index) => {
              const thumb = thumbs.get(page)
              const isLoading = loading.has(page)
              const renderError = errors.get(page)
              const isRemoved = removed.has(page)
              return (
                <div
                  key={page}
                  data-page={page}
                  className={[
                    'pdf-page-card',
                    isRemoved ? 'removed' : '',
                    dragIndex === index ? 'dragging' : '',
                    overIndex === index && dragIndex !== null && dragIndex !== index
                      ? 'drop-target'
                      : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragEnd={() => {
                    setDragIndex(null)
                    setOverIndex(null)
                  }}
                  onDragOver={(e) => {
                    if (dragIndex === null) return
                    e.preventDefault()
                    setOverIndex(index)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragIndex !== null) reorder(dragIndex, index)
                    setDragIndex(null)
                    setOverIndex(null)
                  }}
                >
                  <div
                    className="pdf-page-thumb"
                    style={thumb ? { aspectRatio: `${thumb.width} / ${thumb.height}` } : undefined}
                  >
                    {thumb ? (
                      <img src={thumb.dataUrl} alt={`Page ${page}`} draggable={false} />
                    ) : isLoading ? (
                      <span className="pdf-page-placeholder">Rendering…</span>
                    ) : renderError ? (
                      <button
                        className="pdf-page-retry"
                        title="Retry rendering"
                        onClick={() => {
                          setErrors((prev) => {
                            const next = new Map(prev)
                            next.delete(page)
                            return next
                          })
                          enqueueRender(page)
                        }}
                      >
                        {renderError}
                      </button>
                    ) : (
                      <span className="pdf-page-placeholder">Page {page}</span>
                    )}
                  </div>
                  <div className="pdf-page-card-bar">
                    <span className="pdf-page-number" title={`Source page ${page}`}>
                      {page}
                    </span>
                    <div className="pdf-page-card-actions">
                      <button
                        className="pdf-page-action"
                        title="Rotate 90° clockwise"
                        onClick={() => rotate(page)}
                        disabled={isRemoved}
                      >
                        <MdiIcon path={mdiFileRotateRight} size={16} />
                      </button>
                      <button
                        className={`pdf-page-action${isRemoved ? ' danger' : ''}`}
                        title={isRemoved ? 'Restore page' : 'Remove page'}
                        onClick={() => toggleRemoved(page)}
                      >
                        <MdiIcon path={isRemoved ? mdiRestore : mdiDeleteOutline} size={16} />
                      </button>
                    </div>
                  </div>
                  {isRemoved && <div className="pdf-page-removed-overlay">Removed</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
