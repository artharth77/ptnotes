import { useEffect, useRef, useState } from 'react'
import { mdiImageOutline, mdiPlus, mdiTrashCanOutline } from '@mdi/js'
import { isImageFile } from '@shared/filesExplorer'
import type { GalleryImage } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { ptFileUrl } from '../editor/imageNodeView'
import { isWebUi } from '../uiMode'
import { Modal, ConfirmModal } from './Modal'
import { MdiIcon } from './MdiIcon'

interface GalleryModalProps {
  onClose: () => void
  onInsert: (names: string[]) => void
}

export function GalleryModal({ onClose, onInsert }: GalleryModalProps): React.JSX.Element {
  const project = useAppStore((s) => s.activeProject)
  const [images, setImages] = useState<GalleryImage[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dragActive, setDragActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!project) return
    void window.ptnotes.gallery.list(project).then(setImages)
  }, [project])

  const importFiles = async (files: File[]): Promise<void> => {
    if (!project || !files.length) return
    setBusy(true)
    try {
      for (const file of files) {
        try {
          const path = window.ptnotes.files.getPathForFile(file)
          if (path) {
            await window.ptnotes.gallery.import(project, path, file.name)
          } else {
            // Web UI: no dropped-file paths — send the bytes instead.
            const data = new Uint8Array(await file.arrayBuffer())
            await window.ptnotes.gallery.importData(project, file.name, data)
          }
        } catch {
          // skip files the gallery rejects
        }
      }
      setImages(await window.ptnotes.gallery.list(project))
    } finally {
      setBusy(false)
    }
  }

  const choose = async (): Promise<void> => {
    if (!project) return
    if (isWebUi()) {
      fileInputRef.current?.click()
      return
    }
    setBusy(true)
    try {
      await window.ptnotes.gallery.choose(project)
      setImages(await window.ptnotes.gallery.list(project))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const insert = (): void => {
    const names = images.filter((i) => selected.has(i.name)).map((i) => i.name)
    if (!names.length) return
    onInsert(names)
  }

  const remove = async (name: string): Promise<void> => {
    if (!project) return
    setConfirmDelete(null)
    await window.ptnotes.gallery.delete(project, name)
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(name)
      return next
    })
    setImages(await window.ptnotes.gallery.list(project))
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragActive(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => isImageFile(f.name))
    void importFiles(files)
  }

  const selectedNames = images.filter((i) => selected.has(i.name)).length

  return (
    <Modal title="Image gallery" onClose={onClose} className="gallery-modal">
      <div
        className="gallery-body"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDragActive(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDragActive(false)
        }}
        onDrop={onDrop}
      >
        {images.length === 0 ? (
          <div className="gallery-empty">
            <MdiIcon path={mdiImageOutline} size={32} />
            <p>No images yet.</p>
            <p className="gallery-empty-hint">
              Use “Add images” or drop files here — they are stored in <code>notes/images/</code>.
            </p>
          </div>
        ) : (
          <div className="gallery-grid">
            {images.map((img) => (
              <div
                key={img.name}
                className={`gallery-thumb${selected.has(img.name) ? ' selected' : ''}`}
                onClick={() => toggle(img.name)}
                title={img.name}
              >
                <img src={ptFileUrl(img.absPath)} alt={img.name} draggable={false} />
                <span className="gallery-thumb-name">{img.name}</span>
                <button
                  type="button"
                  className="gallery-thumb-delete"
                  title="Delete image"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmDelete(img.name)
                  }}
                >
                  <MdiIcon path={mdiTrashCanOutline} size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {dragActive && <div className="gallery-drop-overlay">Drop images to add</div>}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          void importFiles(files)
        }}
      />
      <div className="modal-actions">
        <button className="btn" onClick={() => void choose()} disabled={busy || !project}>
          <MdiIcon path={mdiPlus} size={16} />
          Add images
        </button>
        <span className="gallery-count">{selectedNames ? `${selectedNames} selected` : ''}</span>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={insert} disabled={!selectedNames}>
          Insert
        </button>
      </div>
      {confirmDelete && (
        <ConfirmModal
          title="Delete image"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => void remove(confirmDelete)}
          message={<>Delete “{confirmDelete}” from the gallery? This cannot be undone.</>}
        />
      )}
    </Modal>
  )
}
