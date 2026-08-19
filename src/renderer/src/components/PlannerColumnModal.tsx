import { Modal } from './Modal'

interface PlannerColumnModalProps<K extends string> {
  columns: { key: K; label: string }[]
  visible: Set<string>
  onToggle: (key: K) => void
  onClose: () => void
}

export function PlannerColumnModal<K extends string>({
  columns,
  visible,
  onToggle,
  onClose
}: PlannerColumnModalProps<K>): React.JSX.Element {
  return (
    <Modal title="View columns" onClose={onClose}>
      <div className="column-list">
        {columns.map((c) => (
          <label key={c.key} className="column-toggle">
            <input type="checkbox" checked={visible.has(c.key)} onChange={() => onToggle(c.key)} />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
