/**
 * References a note makes to files in its own gallery folder
 * (`<project>/notes/images/`), extracted from markdown body text.
 *
 * Only relative `images/...` references are returned; absolute paths, `..`
 * traversal, remote URLs and backslashes are ignored so an export can never
 * pull a file from outside the gallery.
 */

const GALLERY_PREFIX = 'images/'

/** Markdown links and images: `[alt](images/foo.png "title")` / `![alt](<images/a b.png>)`. */
const MD_DEST = /\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)/g
/** Reference-style definitions: `[id]: images/foo.png`. */
const MD_DEF = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/gm
/** HTML images: `<img src="images/foo.png">`. */
const HTML_SRC = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

function normalizeRef(raw: string): string | null {
  let value = raw.trim()
  if (!value) return null
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1).trim()
  const cut = value.search(/[?#]/)
  if (cut !== -1) value = value.slice(0, cut)
  if (!value) return null
  try {
    value = decodeURIComponent(value)
  } catch {
    return null
  }
  value = value.replace(/\\/g, '/')
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return null
  }
  while (value.startsWith('./')) value = value.slice(2)
  if (!value.startsWith(GALLERY_PREFIX)) return null
  const segments = value.slice(GALLERY_PREFIX.length).split('/')
  if (segments.length === 0) return null
  if (segments.some((s) => !s || s === '.' || s === '..')) return null
  return value
}

/** Unique `images/...` references in the order they first appear. */
export function extractNoteImageRefs(markdown: string): string[] {
  const refs: string[] = []
  const seen = new Set<string>()
  const push = (raw: string): void => {
    const ref = normalizeRef(raw)
    if (!ref || seen.has(ref)) return
    seen.add(ref)
    refs.push(ref)
  }
  for (const match of markdown.matchAll(MD_DEST)) push(match[1])
  for (const match of markdown.matchAll(MD_DEF)) push(match[1])
  for (const match of markdown.matchAll(HTML_SRC)) push(match[1] ?? match[2] ?? match[3] ?? '')
  return refs
}
