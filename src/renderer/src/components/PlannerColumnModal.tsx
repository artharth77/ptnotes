import { useState } from 'react'
import { mdiArrowDown, mdiArrowUp } from '@mdi/js'
import { MdiIcon } from './MdiIcon'
import { Modal } from './Modal'

interface PlannerColumnModalProps<K extends string> {
  columns: { key: K; label: string }[]
  visible: Set<string>
  disabledKeys?: Set<string>
  order?: K[]
  fixedKeys?: Set<string>
  onMove?: (key: K, dir: -1 | 1) => void
  onToggle: (key: K) => void
  onReset?: () => void
  onClose: () => void
}

export function PlannerColumnModal<K extends string>({
  columns,
  visible,
  disabledKeys,
  order,
  fixedKeys,
  onMove,
  onToggle,
  onReset,
  onClose
}: PlannerColumnModalProps<K>): React.JSX.Element {
  const byKey = new Map(columns.map((c) => [c.key, c]))
  const ordered = (order ?? columns.map((c) => c.key)).filter((k) => byKey.has(k))
  const [selected, setSelected] = useState<K | null>(null)
  const selIdx = selected ? ordered.indexOf(selected) : -1
  const canUp = selIdx > 0 && !fixedKeys?.has(ordered[selIdx - 1])
  const canDown = selIdx >= 0 && selIdx < ordered.length - 1 && !fixedKeys?.has(ordered[selIdx + 1])
  return (
    <Modal title="View columns" onClose={onClose}>
      <div className="column-list">
        {ordered.map((key) => {
          const c = byKey.get(key)!
          const isDisabled = disabledKeys?.has(key)
          const isFixed = fixedKeys?.has(key)
          return (
            <div
              key={key}
              className={`column-toggle ${isDisabled ? 'disabled' : ''} ${isFixed ? 'fixed' : ''} ${
                selected === key ? 'selected' : ''
              }`}
              onClick={() => {
                if (!isFixed) setSelected(key)
              }}
            >
              <input
                type="checkbox"
                checked={visible.has(key)}
                disabled={isDisabled}
                onChange={() => onToggle(key)}
              />
              <span>{c.label}</span>
            </div>
          )
        })}
      </div>
      <div className="modal-actions">
        {onMove && (
          <span className="column-move">
            <button
              type="button"
              className="icon-btn small"
              title="Move up"
              disabled={!canUp}
              onClick={() => selected && onMove(selected, -1)}
            >
              <MdiIcon path={mdiArrowUp} size={16} />
            </button>
            <button
              type="button"
              className="icon-btn small"
              title="Move down"
              disabled={!canDown}
              onClick={() => selected && onMove(selected, 1)}
            >
              <MdiIcon path={mdiArrowDown} size={16} />
            </button>
          </span>
        )}
        {onReset && (
          <button className="btn" onClick={onReset}>
            Reset
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
