import { memo } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

interface MarkdownContentProps {
  content: string
  onOpenNote?: (noteName: string) => void
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  onOpenNote
}: MarkdownContentProps): React.JSX.Element {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={(url) => {
          if (url.startsWith('note:')) return url
          return defaultUrlTransform(url)
        }}
        components={{
          a: ({ node: _node, href, children, ...props }) => {
            if (href?.startsWith('note:')) {
              const noteName = href.slice('note:'.length)
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
                  <span className="chat-note-link-icon">📄</span>
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
        {content}
      </ReactMarkdown>
    </div>
  )
})
