import { useEffect, useRef, useState, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}

export function Modal({ title, onClose, children, className }: ModalProps): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      const el = overlayRef.current
      if (!el) return
      const overlays = document.querySelectorAll<HTMLElement>('.modal-overlay')
      if (overlays[overlays.length - 1] === el) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-overlay" ref={overlayRef}>
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

interface ConfirmModalProps {
  title: string
  message: ReactNode
  confirmLabel?: string
  disabled?: boolean
  onClose: () => void
  onConfirm: () => void
  onSpace?: () => void
  checkbox?: {
    checked: boolean
    label: string
    onToggle: (checked: boolean) => void
  }
  children?: ReactNode
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Delete',
  disabled = false,
  onClose,
  onConfirm,
  onSpace,
  checkbox,
  children
}: ConfirmModalProps): React.JSX.Element {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'Enter') {
        if (disabled) return
        e.preventDefault()
        onConfirm()
      } else if (e.key === ' ' && checkbox) {
        if (target.tagName !== 'BUTTON') return
        e.preventDefault()
        checkbox.onToggle(!checkbox.checked)
      } else if (e.key === ' ' && onSpace) {
        onSpace()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [checkbox, disabled, onConfirm, onSpace])

  return (
    <Modal title={title} onClose={onClose}>
      <p className="confirm-message">{message}</p>
      {checkbox && (
        <label className="confirm-checkbox">
          <input
            type="checkbox"
            checked={checkbox.checked}
            onChange={(e) => checkbox.onToggle(e.target.checked)}
          />
          {checkbox.label}
        </label>
      )}
      {children}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn danger" onClick={onConfirm} disabled={disabled} autoFocus>
          {confirmLabel}
        </button>
      </div>
    </Modal>
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
  error,
  onClose,
  onSubmit
}: {
  title: string
  placeholder?: string
  initialValue?: string
  submitLabel?: string
  error?: string | null
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
      {error && <p className="form-error">{error}</p>}
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
