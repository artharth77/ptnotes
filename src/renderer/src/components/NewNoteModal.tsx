import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Modal, TextField } from './Modal'
import { NOTE_TEMPLATES, getNoteTemplate } from '../noteTemplates'

export function NewNoteModal(): React.JSX.Element | null {
  const creating = useAppStore((s) => s.noteCreating)
  const closeNoteCreate = useAppStore((s) => s.closeNoteCreate)
  const createNote = useAppStore((s) => s.createNote)
  const [title, setTitle] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('blank')

  if (!creating) return null

  const close = (): void => {
    setTitle('')
    setSelectedTemplate('blank')
    closeNoteCreate()
  }

  const handleCreate = async (): Promise<void> => {
    const trimmed = title.trim()
    if (!trimmed) return
    const template = getNoteTemplate(selectedTemplate)
    const content =
      template && template.id !== 'blank' ? template.content(trimmed, new Date()) : undefined
    await createNote(trimmed, content)
    close()
  }

  return (
    <Modal title="New Note" onClose={close}>
      <TextField
        value={title}
        onChange={setTitle}
        onEnter={() => void handleCreate()}
        placeholder="Note title"
        autoFocus
      />
      <div className="form-label" style={{ marginTop: 12, marginBottom: 6 }}>
        Template
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 8,
          maxHeight: 260,
          overflowY: 'auto',
          padding: 4
        }}
      >
        {NOTE_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSelectedTemplate(t.id)}
            className={`note-template-card${selectedTemplate === t.id ? ' active' : ''}`}
            style={{
              textAlign: 'left',
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 10,
              background: selectedTemplate === t.id ? 'var(--accent-soft)' : 'var(--bg)',
              cursor: 'pointer',
              color: 'var(--text)'
            }}
          >
            <div style={{ fontSize: 16, marginBottom: 2 }}>
              <span style={{ marginRight: 6 }}>{t.icon}</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-dim)',
                lineHeight: 1.4
              }}
            >
              {t.description}
            </div>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={close}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={() => void handleCreate()}
          disabled={!title.trim()}
        >
          Create
        </button>
      </div>
    </Modal>
  )
}
