import { useState, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}

export function Modal({ title, onClose, children, className }: ModalProps): React.JSX.Element {
  return (
    <div className="modal-overlay">
      <div
        className={`modal${className ? ` ${className}` : ''}`}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function TextField({
  value,
  onChange,
  onEnter,
  placeholder,
  autoFocus,
  readOnly,
  type = 'text'
}: {
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
  placeholder?: string
  autoFocus?: boolean
  readOnly?: boolean
  type?: string
}): React.JSX.Element {
  return (
    <input
      className="text-field"
      type={type}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEnter?.()
      }}
    />
  )
}

export function PromptModal({
  title,
  placeholder,
  initialValue = '',
  submitLabel = 'OK',
  onClose,
  onSubmit
}: {
  title: string
  placeholder?: string
  initialValue?: string
  submitLabel?: string
  onClose: () => void
  onSubmit: (value: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const submit = (): void => {
    if (!value.trim()) return
    onSubmit(value.trim())
  }
  return (
    <Modal title={title} onClose={onClose}>
      <TextField
        value={value}
        onChange={setValue}
        onEnter={submit}
        placeholder={placeholder}
        autoFocus
      />
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={!value.trim()}>
          {submitLabel}
        </button>
      </div>
    </Modal>
  )
}
