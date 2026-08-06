import { useState } from 'react'
import { Modal, TextField } from './Modal'
import type { ChatAttachment } from '@shared/types'

const DEFAULT_PROMPT = 'Summarize this PDF, then create a note with the summary and key points.'

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export interface PdfConfirmOptions {
  content: string
  attachment: ChatAttachment
}

export function PdfDropModal({
  project,
  fileName,
  path,
  onClose,
  onConfirm
}: {
  project: string
  fileName: string
  path: string
  onClose: () => void
  onConfirm: (opts: PdfConfirmOptions) => void
}): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const savedPath = await window.ptnotes.pdf.copyToProject(project, path, fileName)
      const res = await window.ptnotes.pdf.extract(savedPath)
      const attachment: ChatAttachment = {
        id: uid(),
        kind: 'pdf',
        name: fileName,
        savedPath,
        mode: 'extract',
        pageCount: res.pageCount,
        charCount: res.charCount,
        truncated: res.truncated
      }
      if (!res.text.trim()) {
        throw new Error('No text found in this PDF — it looks like a scanned or image-only PDF.')
      }
      const trunc = res.truncated ? '\n\n[Note: this PDF was truncated; the tail was cut off.]' : ''
      const pages = `${res.pageCount} page${res.pageCount === 1 ? '' : 's'}`
      const instruction = prompt.trim() || DEFAULT_PROMPT
      const content = `[Attached PDF: ${fileName}, ${pages}]${trunc}\n\n${res.text}\n\n---\n${instruction}`
      onConfirm({ content, attachment })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Attach PDF" onClose={onClose}>
      <p className="hint">
        <strong>{fileName}</strong> will be copied to the project&apos;s <code>files/</code> folder,
        parsed locally, and its text sent to the AI assistant.
      </p>
      <label className="form-label">
        Prompt (optional)
        <TextField
          value={prompt}
          onChange={setPrompt}
          onEnter={() => void submit()}
          placeholder={DEFAULT_PROMPT}
        />
      </label>
      <p className="hint">Leave blank to use: “{DEFAULT_PROMPT}”</p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </Modal>
  )
}
