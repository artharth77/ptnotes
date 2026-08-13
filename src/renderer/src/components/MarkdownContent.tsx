import { memo } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { slugify } from '@shared/slug'
import { MdiIcon } from './MdiIcon'
import { NOTE_LINK_ICON, SKILL_LINK_ICON } from './contentIcons'

interface MarkdownContentProps {
  content: string
  onOpenNote?: (noteName: string) => void
  onOpenSkill?: (skillName: string) => void
}

function internalNameFromHref(href: string, prefix: string): string {
  const raw = href.slice(prefix.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function normalizeInternalLinks(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\(\s*(note:[^()]*?)\s*\)/g, (_m, text, dest) => `[${text}](<${dest}>)`)
    .replace(/\[([^\]]*)\]\(\s*(skill:[^()]*?)\s*\)/g, (_m, text, dest) => `[${text}](<${dest}>)`)
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  onOpenNote,
  onOpenSkill
}: MarkdownContentProps): React.JSX.Element {
  const safeContent = normalizeInternalLinks(content)
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={(url) => {
          if (url.startsWith('note:') || url.startsWith('skill:')) return url
          return defaultUrlTransform(url)
        }}
        components={{
          a: ({ node: _node, href, children, ...props }) => {
            if (href?.startsWith('note:')) {
              const noteName = slugify(internalNameFromHref(href, 'note:'))
              return (
                <a
                  href="#"
                  className="chat-note-link"
                  title={noteName}
                  onClick={(e) => {
                    e.preventDefault()
                    onOpenNote?.(noteName)
                  }}
                >
                  <span className="chat-note-link-icon">
                    <MdiIcon path={NOTE_LINK_ICON} size={16} />
                  </span>
                  {children}
                </a>
              )
            }
            if (href?.startsWith('skill:')) {
              const skillName = slugify(internalNameFromHref(href, 'skill:'))
              return (
                <a
                  href="#"
                  className="chat-note-link"
                  title={skillName}
                  onClick={(e) => {
                    e.preventDefault()
                    onOpenSkill?.(skillName)
                  }}
                >
                  <span className="chat-note-link-icon">
                    <MdiIcon path={SKILL_LINK_ICON} size={16} />
                  </span>
                  {children}
                </a>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            )
          },
          table: (props) => (
            <div className="md-table-wrap">
              <table {...props} />
            </div>
          )
        }}
      >
        {safeContent}
      </ReactMarkdown>
    </div>
  )
})
