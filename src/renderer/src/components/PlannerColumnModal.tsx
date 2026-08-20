import { Modal } from './Modal'

interface PlannerColumnModalProps<K extends string> {
  columns: { key: K; label: string }[]
  visible: Set<string>
  disabledKeys?: Set<string>
  onToggle: (key: K) => void
  onClose: () => void
}

export function PlannerColumnModal<K extends string>({
  columns,
  visible,
  disabledKeys,
  onToggle,
  onClose
}: PlannerColumnModalProps<K>): React.JSX.Element {
  return (
    <Modal title="View columns" onClose={onClose}>
      <div className="column-list">
        {columns.map((c) => {
          const isDisabled = disabledKeys?.has(c.key)
          return (
            <label key={c.key} className={`column-toggle ${isDisabled ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={visible.has(c.key)}
                disabled={isDisabled}
                onChange={() => onToggle(c.key)}
              />
              <span>{c.label}</span>
            </label>
          )
        })}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
