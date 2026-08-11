import { useState } from 'react'
import { USER_MSG_COLLAPSE_LIMIT } from './chatContent'

export function ThinkBox({ content }: { content: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={`think-box ${open ? 'open' : ''}`}>
      <button className="think-header" onClick={() => setOpen(!open)}>
        <span>💭 Thinking</span>
        <span className="think-toggle">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="think-body">{content}</div>}
    </div>
  )
}

export function UserBubble({ content }: { content: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const long = content.length > USER_MSG_COLLAPSE_LIMIT
  const shown = long && !expanded ? content.slice(0, USER_MSG_COLLAPSE_LIMIT) : content
  return (
    <div className="chat-msg-content user-bubble">
      {shown}
      {long && (
        <button className="chat-msg-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : '… Show more'}
        </button>
      )}
    </div>
  )
}
