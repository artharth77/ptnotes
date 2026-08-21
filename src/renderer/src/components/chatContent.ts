export interface ContentPart {
  type: 'think' | 'text'
  content: string
}

export function splitContent(content: string): ContentPart[] {
  const parts: ContentPart[] = []
  let index = 0
  while (index < content.length) {
    const open = content.indexOf('<think', index)
    if (open === -1) {
      const rest = content.slice(index)
      if (rest.trim()) parts.push({ type: 'text', content: rest })
      break
    }
    if (open > index) {
      const pre = content.slice(index, open)
      if (pre.trim()) parts.push({ type: 'text', content: pre })
    }
    const close = content.indexOf('</think>', open)
    if (close === -1) {
      const rest = content.slice(open).replace(/^<think\b[^>]*>\s*/, '')
      if (rest.trim()) parts.push({ type: 'think', content: rest.trim() })
      break
    }
    const inner = content.slice(open, close).replace(/^<think\b[^>]*>\s*/, '')
    if (inner.trim()) parts.push({ type: 'think', content: inner.trim() })
    index = close + '</think>'.length
  }
  return parts
}

export function isReasoningOpen(content: string): boolean {
  const open = content.indexOf('<think')
  if (open === -1) return false
  const close = content.indexOf(' response', open)
  return close === -1
}

export const USER_MSG_COLLAPSE_LIMIT = 400
