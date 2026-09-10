import { useEffect, useRef, useState } from 'react'
import { mdiDragVertical } from '@mdi/js'
import type { ExplorerEntry } from '@shared/types'
import { Modal, TextField } from './Modal'
import { MdiIcon } from './MdiIcon'
import { friendlyError } from '../errors'

/** Merge-PDFs dialog: drag to order the selected PDFs, name the output, merge into a NEW file. */
export function PdfMergeDialog({
  project,
  entries,
  destSubpath,
  onClose,
  onMerged
}: {
  project: string
  entries: ExplorerEntry[]
  destSubpath: string
  onClose: () => void
  onMerged: (newPath: string) => void
}): React.JSX.Element {
  const [ordered, setOrdered] = useState<ExplorerEntry[]>(entries)
  const [destName, setDestName] = useState('merged.pdf')
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const dragIndexRef = useRef<number | null>(null)
  useEffect(() => {
    dragIndexRef.current = dragIndex
  }, [dragIndex])

  const reorder = (from: number, to: number): void => {
    if (from === to) return
    setOrdered((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const merge = async (): Promise<void> => {
    if (merging || ordered.length < 2) return
    setMerging(true)
    setError(null)
    try {
      const newPath = await window.ptnotes.pdf.merge(
        project,
        ordered.map((e) => e.path),
        destSubpath,
        destName.trim() || 'merged.pdf'
      )
      onMerged(newPath)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setMerging(false)
    }
  }

  return (
    <Modal title="Merge PDFs" onClose={onClose} className="pdf-merge-modal">
      <p className="pdf-merge-hint">
        Drag to choose the merge order. The originals are not modified.
      </p>
      <ul className="pdf-merge-list">
        {ordered.map((entry, index) => (
          <li
            key={entry.path}
            className={[
              'pdf-merge-row',
              dragIndex === index ? 'dragging' : '',
              overIndex === index && dragIndex !== null && dragIndex !== index ? 'drop-target' : ''
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
              if (dragIndexRef.current === null) return
              e.preventDefault()
              setOverIndex(index)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragIndexRef.current !== null) reorder(dragIndexRef.current, index)
              setDragIndex(null)
              setOverIndex(null)
            }}
            title={entry.path}
          >
            <span className="pdf-merge-order">{index + 1}</span>
            <span className="pdf-merge-grip">
              <MdiIcon path={mdiDragVertical} size={14} />
            </span>
            <span className="pdf-merge-name">{entry.name}</span>
          </li>
        ))}
      </ul>
      <div className="pdf-merge-name-field">
        <label htmlFor="pdf-merge-name">Output file name</label>
        <TextField
          value={destName}
          onChange={setDestName}
          placeholder="merged.pdf"
          onEnter={() => void merge()}
        />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={merging || ordered.length < 2}
          onClick={() => void merge()}
        >
          {merging ? 'Merging…' : `Merge ${ordered.length} PDFs`}
        </button>
      </div>
    </Modal>
  )
}
