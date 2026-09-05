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
