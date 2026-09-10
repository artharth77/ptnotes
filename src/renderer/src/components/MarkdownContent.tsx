import { memo, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { slugify } from '@shared/slug'
import { MdiIcon } from './MdiIcon'
import { ImageViewer } from './ImageViewer'
import {
  fileTypeIcon,
  KANBAN_LINK_ICON,
  NOTE_LINK_ICON,
  PLAN_LINK_ICON,
  SKILL_LINK_ICON
} from './contentIcons'

interface MarkdownContentProps {
  content: string
  enableImageZoom?: boolean
  onOpenNote?: (noteName: string) => void
  onOpenSkill?: (skillName: string) => void
  onOpenPlan?: (planName: string) => void
  onOpenKanban?: (cardTitle: string) => void
  /** Open a project file referenced by a `file:` link (e.g. reveal it in the OS file manager). */
  onOpenFile?: (fileName: string) => void
  /** Optional per-bot color for `mention:` links (bots group chat). */
  mentionColor?: (botId: string) => string
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
    .replace(
      /\[([^\]]*)\]\(\s*([^()]*?)\s*\)/g,
      (_m, text, dest) => `[${text}](<${dest.replace(/ /g, '%20')}>)`
    )
    .replace(/\[([^\]]*)\]\(\s*(note:[^()]*?)\s*\)/g, (_m, text, dest) => `[${text}](<${dest}>)`)
    .replace(/\[([^\]]*)\]\(\s*(skill:[^()]*?)\s*\)/g, (_m, text, dest) => `[${text}](<${dest}>)`)
    .replace(/\[([^\]]*)\]\(\s*(kanban:[^()]*?)\s*\)/g, (_m, text, dest) => `[${text}](<${dest}>)`)
    .replace(/\[([^\]]*)\]\(\s*(file:[^()]*?)\s*\)/g, (_m, text, dest) => `[${text}](<${dest}>)`)
    .replace(/\[([^\]]*)\]\(\s*(plan:[^()]*?)\s*\)/g, (_m, text, dest) => `[${text}](<${dest}>)`)
    .replace(
      /\[([^\]]*)\]\(\s*(schedule:[^()]*?)\s*\)/g,
      (_m, text, dest) => `[${text}](<${dest}>)`
    )
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  enableImageZoom = false,
  onOpenNote,
  onOpenSkill,
  onOpenPlan,
  onOpenKanban,
  onOpenFile,
  mentionColor
}: MarkdownContentProps): React.JSX.Element {
  const [viewer, setViewer] = useState<{ src: string; alt: string } | null>(null)

  const safeContent = normalizeInternalLinks(content)
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={(url) => {
          if (
            url.startsWith('note:') ||
            url.startsWith('skill:') ||
            url.startsWith('plan:') ||
            url.startsWith('schedule:') ||
            url.startsWith('kanban:') ||
            url.startsWith('mention:') ||
            url.startsWith('ptfile:') ||
            url.startsWith('file:')
          )
            return url
          // Handle Windows paths like C:\path\to\file and convert to C:/path/to/file
          if (/^[a-zA-Z]:%5C/.test(url)) return url.replace(/%5C/g, '/')
          return defaultUrlTransform(url)
        }}
        components={{
          img: ({ src, alt, ...props }) => {
            let resolvedSrc = src
            if (src) {
              if (/^[a-zA-Z]:/.test(src)) {
                // Handle Windows paths like C:/path/to/file
                resolvedSrc = `ptfile://local/${src}`
              } else {
                // Handle macOS/Linux paths like /path/to/file
                resolvedSrc = `ptfile://local${src}`
              }
            }
            if (enableImageZoom) {
              return (
                <span
                  className="chat-img-clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => setViewer({ src: resolvedSrc ?? '', alt: alt ?? '' })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setViewer({ src: resolvedSrc ?? '', alt: alt ?? '' })
                    }
                  }}
                >
                  <img src={resolvedSrc} alt={alt ?? ''} {...props} />
                </span>
              )
            }
            return <img src={resolvedSrc} alt={alt ?? ''} {...props} />
          },
          a: ({ node: _node, href, children, ...props }) => {
            if (href?.startsWith('mention:')) {
              const botId = internalNameFromHref(href, 'mention:')
              const color = mentionColor?.(botId)
              return (
                <span
                  className="chat-mention"
                  style={
                    color
                      ? {
                          background: `color-mix(in srgb, ${color} 16%, transparent)`,
                          color
                        }
                      : undefined
                  }
                  title={botId}
                >
                  {children}
                </span>
              )
            }
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
            if (href?.startsWith('plan:') || href?.startsWith('schedule:')) {
              const prefix = href.startsWith('plan:') ? 'plan:' : 'schedule:'
              const planName = slugify(internalNameFromHref(href, prefix))
              return (
                <a
                  href="#"
                  className="chat-note-link"
                  title={planName}
                  onClick={(e) => {
                    e.preventDefault()
                    onOpenPlan?.(planName)
                  }}
                >
                  <span className="chat-note-link-icon">
                    <MdiIcon path={PLAN_LINK_ICON} size={16} />
                  </span>
                  {children}
                </a>
              )
            }
            if (href?.startsWith('kanban:')) {
              const cardTitle = internalNameFromHref(href, 'kanban:')
              return (
                <a
                  href="#"
                  className="chat-note-link"
                  title={cardTitle}
                  onClick={(e) => {
                    e.preventDefault()
                    onOpenKanban?.(cardTitle)
                  }}
                >
                  <span className="chat-note-link-icon">
                    <MdiIcon path={KANBAN_LINK_ICON} size={16} />
                  </span>
                  {children}
                </a>
              )
            }
            if (href?.startsWith('file:')) {
              const fileName = internalNameFromHref(href, 'file:')
              return (
                <a
                  href="#"
                  className="chat-note-link"
                  title={fileName}
                  onClick={(e) => {
                    e.preventDefault()
                    onOpenFile?.(fileName)
                  }}
                >
                  <span className="chat-note-link-icon">
                    <MdiIcon path={fileTypeIcon(fileName)} size={16} />
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
      {viewer && <ImageViewer src={viewer.src} alt={viewer.alt} onClose={() => setViewer(null)} />}
    </div>
  )
})
