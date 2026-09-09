import type { ExplorerEntry, ExplorerSort } from './types'

/** Ancestor paths of a files-explorer dir, root ('') first, the dir itself last. */
export function ancestorsOf(dir: string): string[] {
  const out = ['']
  let cur = ''
  for (const seg of dir.split('/').filter(Boolean)) {
    cur = cur ? `${cur}/${seg}` : seg
    out.push(cur)
  }
  return out
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])

/** Whether a file name looks like a viewable image (matches the ptfile:// protocol's MIME list). */
export function isImageFile(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return IMAGE_EXTS.has(ext)
}

const MARKDOWN_EXTS = new Set(['md', 'markdown'])

/** Whether a file name is markdown (rendered with the markdown viewer). */
export function isMarkdownFile(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return MARKDOWN_EXTS.has(ext)
}

const PDF_EXTS = new Set(['pdf'])

/** Whether a file name is a PDF (previewed with Chromium's built-in PDF viewer). */
export function isPdfFile(name: string): boolean {
  return PDF_EXTS.has(name.toLowerCase().split('.').pop() ?? '')
}

const TEXT_EXTS = new Set([
  'txt',
  'json',
  'yml',
  'yaml',
  'log',
  'csv',
  'tsv',
  'xml',
  'html',
  'htm',
  'ini',
  'cfg',
  'conf',
  'toml',
  'sh',
  'bat',
  'ps1',
  'py',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'css',
  'scss',
  'sql'
])

/** Whether a file name can be previewed as text (markdown renders rich, the rest plain). */
export function isTextFile(name: string): boolean {
  return isMarkdownFile(name) || TEXT_EXTS.has(name.toLowerCase().split('.').pop() ?? '')
}

const WORD_EXTS = new Set(['docx'])
const EXCEL_EXTS = new Set(['xlsx', 'xlsm'])
const POWERPOINT_EXTS = new Set(['pptx'])

/** Human-readable type category of an explorer entry (matches the per-type row icons). */
export function fileTypeLabel(name: string, isDir: boolean): string {
  if (isDir) return 'Folder'
  const ext = name.includes('.') ? (name.toLowerCase().split('.').pop() ?? '') : ''
  if (isMarkdownFile(name)) return 'Markdown'
  if (ext === 'pdf') return 'PDF'
  if (IMAGE_EXTS.has(ext)) return 'Image'
  if (WORD_EXTS.has(ext)) return 'Word'
  if (EXCEL_EXTS.has(ext)) return 'Excel'
  if (POWERPOINT_EXTS.has(ext)) return 'Powerpoint'
  if (TEXT_EXTS.has(ext)) return 'Text'
  return ext ? ext.toUpperCase() : 'File'
}

/** Sorted copy of the listing (null sort = service order); folders stay grouped first
 *  and the key is compared within folders and within files separately. Ties keep the
 *  incoming (name-sorted) order via the stable Array.sort. */
export function sortExplorerEntries(entries: ExplorerEntry[], sort: ExplorerSort): ExplorerEntry[] {
  if (!sort) return entries
  const cmp = (a: ExplorerEntry, b: ExplorerEntry): number => {
    let r: number
    if (sort.key === 'name') r = a.name.localeCompare(b.name)
    else if (sort.key === 'type')
      r = fileTypeLabel(a.name, a.isDir).localeCompare(fileTypeLabel(b.name, b.isDir))
    else if (sort.key === 'size') r = (a.size ?? 0) - (b.size ?? 0)
    else r = a.mtime - b.mtime
    return sort.dir === 'asc' ? r : -r
  }
  return [...entries.filter((e) => e.isDir).sort(cmp), ...entries.filter((e) => !e.isDir).sort(cmp)]
}

/** Copy of the listing keeping only entries whose name contains the query
 *  (case-insensitive substring); an empty query returns the input unchanged. */
export function filterExplorerEntries(entries: ExplorerEntry[], query: string): ExplorerEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter((e) => e.name.toLowerCase().includes(q))
}

/** The visible explorer listing: name filter applied first, then the column sort. */
export function visibleExplorerEntries(
  entries: ExplorerEntry[],
  sort: ExplorerSort,
  filter: string
): ExplorerEntry[] {
  return sortExplorerEntries(filterExplorerEntries(entries, filter), sort)
}
