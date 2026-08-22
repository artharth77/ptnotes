import { useEffect, useRef, useState } from 'react'
import { USER_MSG_COLLAPSE_LIMIT } from './chatContent'
import { MarkdownContent } from './MarkdownContent'

export function ThinkBox({
  content,
  streaming = false
}: {
  content: string
  streaming?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const effectiveOpen = open || streaming
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (streaming && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [streaming, content, effectiveOpen])
  return (
    <div className={`think-box ${effectiveOpen ? 'open' : ''}${streaming ? ' streaming' : ''}`}>
      <button className="think-header" onClick={() => setOpen(!open)}>
        <span>💭 {streaming ? 'Thinking' : 'Thought'}</span>
        <span className="think-toggle">{effectiveOpen ? '▲' : '▼'}</span>
      </button>
      {effectiveOpen && (
        <div ref={bodyRef} className="think-body">
          {content}
          {streaming && <span className="think-cursor" />}
        </div>
      )}
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

export function AssistantBubble({
  content,
  streaming = false,
  onOpenNote,
  onOpenSkill
}: {
  content: string
  streaming?: boolean
  onOpenNote?: (noteName: string) => void
  onOpenSkill?: (skillName: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const long = content.length > USER_MSG_COLLAPSE_LIMIT
  const shown = long && !expanded ? content.slice(0, USER_MSG_COLLAPSE_LIMIT) : content
  return (
    <div className="chat-msg-content">
      <MarkdownContent content={shown} onOpenNote={onOpenNote} onOpenSkill={onOpenSkill} />
      {long &&
        (streaming ? (
          <button className="chat-msg-more streaming" disabled title="Still receiving response…">
            … more +{content.length - USER_MSG_COLLAPSE_LIMIT} chars
          </button>
        ) : (
          <button className="chat-msg-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : '… Show more'}
          </button>
        ))}
    </div>
  )
}
