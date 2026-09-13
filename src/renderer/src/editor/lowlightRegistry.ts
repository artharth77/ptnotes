import { createLowlight } from 'lowlight'
import { SUPPORTED_LANGUAGES } from './supportedLanguages'

import hl_plaintext from 'highlight.js/lib/languages/plaintext'
import hl_javascript from 'highlight.js/lib/languages/javascript'
import hl_typescript from 'highlight.js/lib/languages/typescript'
import hl_python from 'highlight.js/lib/languages/python'
import hl_bash from 'highlight.js/lib/languages/bash'
import hl_sql from 'highlight.js/lib/languages/sql'
import hl_xml from 'highlight.js/lib/languages/xml'
import hl_css from 'highlight.js/lib/languages/css'
import hl_scss from 'highlight.js/lib/languages/scss'
import hl_less from 'highlight.js/lib/languages/less'
import hl_json from 'highlight.js/lib/languages/json'
import hl_yaml from 'highlight.js/lib/languages/yaml'
import hl_markdown from 'highlight.js/lib/languages/markdown'
import hl_rust from 'highlight.js/lib/languages/rust'
import hl_go from 'highlight.js/lib/languages/go'
import hl_java from 'highlight.js/lib/languages/java'
import hl_c from 'highlight.js/lib/languages/c'
import hl_cpp from 'highlight.js/lib/languages/cpp'
import hl_ruby from 'highlight.js/lib/languages/ruby'
import hl_php from 'highlight.js/lib/languages/php'
import hl_dockerfile from 'highlight.js/lib/languages/dockerfile'
import hl_ini from 'highlight.js/lib/languages/ini'
import hl_diff from 'highlight.js/lib/languages/diff'

const lowlight = createLowlight()

export { lowlight }

/** Minimal no-op grammar so the `mermaid` language tag round-trips (no highlighting). */
function hl_mermaid(): { name: string; contains: never[] } {
  return { name: 'Mermaid', contains: [] }
}
try {
  if (!lowlight.registered('mermaid')) lowlight.register('mermaid', hl_mermaid as never)
} catch {
  // ignore
}

const BASE_ORDER: Array<[string, unknown]> = [
  ['plaintext', hl_plaintext],
  ['javascript', hl_javascript],
  ['typescript', hl_typescript],
  ['css', hl_css],
  ['xml', hl_xml],
  ['yaml', hl_yaml],
  ['markdown', hl_markdown],
  ['python', hl_python],
  ['bash', hl_bash],
  ['sql', hl_sql],
  ['scss', hl_scss],
  ['less', hl_less],
  ['json', hl_json],
  ['rust', hl_rust],
  ['go', hl_go],
  ['java', hl_java],
  ['c', hl_c],
  ['cpp', hl_cpp],
  ['ruby', hl_ruby],
  ['php', hl_php],
  ['dockerfile', hl_dockerfile],
  ['ini', hl_ini],
  ['diff', hl_diff]
]

const aliasKeyTarget = new Map<string, string>()
const aliasTargets = new Set<string>()

function registerAliasSafe(alias: string, target: string): void {
  if (alias === target) return
  try {
    lowlight.registerAlias({ [alias]: target })
    aliasKeyTarget.set(alias, target)
    aliasTargets.add(target)
  } catch {
    // ignore
  }
}

const baseRegistered = new Set<string>()
for (const [name, fn] of BASE_ORDER) {
  if (lowlight.registered(name)) {
    baseRegistered.add(name)
    continue
  }
  try {
    if (typeof fn === 'function') {
      lowlight.register(name, fn as never)
      if (lowlight.registered(name)) baseRegistered.add(name)
    }
  } catch {
    // ignore
  }
}

if (!lowlight.registered('text') && baseRegistered.has('plaintext')) {
  try {
    lowlight.register('text', hl_plaintext as never)
    if (lowlight.registered('text')) baseRegistered.add('text')
  } catch {
    registerAliasSafe('text', 'plaintext')
  }
}

const hlMap: Record<string, string[]> = {
  text: ['plaintext', 'text'],
  plaintext: ['plaintext'],
  javascript: ['javascript'],
  jsx: ['javascript'],
  typescript: ['typescript'],
  tsx: ['typescript'],
  python: ['python'],
  bash: ['bash'],
  sh: ['bash'],
  zsh: ['bash'],
  shell: ['bash'],
  sql: ['sql'],
  html: ['xml'],
  xml: ['xml'],
  css: ['css'],
  scss: ['scss'],
  less: ['less'],
  json: ['json'],
  yaml: ['yaml'],
  yml: ['yaml'],
  markdown: ['markdown'],
  md: ['markdown'],
  rust: ['rust'],
  go: ['go'],
  java: ['java'],
  c: ['c'],
  cpp: ['cpp'],
  ruby: ['ruby'],
  php: ['php'],
  dockerfile: ['dockerfile'],
  toml: ['ini'],
  ini: ['ini'],
  diff: ['diff'],
  mermaid: ['mermaid']
}

function resolveFirstAvailable(preferred: string[]): string | null {
  for (const k of preferred) if (baseRegistered.has(k) || lowlight.registered(k)) return k
  return null
}

for (const lang of SUPPORTED_LANGUAGES) {
  const key = lang.key
  if (lowlight.registered(key)) {
    baseRegistered.add(key)
    continue
  }
  const preferred = hlMap[key] ?? []
  const resolved = resolveFirstAvailable(preferred)
  if (!resolved) continue
  registerAliasSafe(key, resolved)
  if (lowlight.registered(key)) baseRegistered.add(key)
}

const ORIGINAL_LIST_LANGS = lowlight.listLanguages.bind(lowlight) as () => string[]
function patchedListLanguages(): string[] {
  const base = ORIGINAL_LIST_LANGS()
  const seen = new Set(base)
  for (const alias of aliasKeyTarget.keys()) seen.add(alias)
  return [...seen]
}
;(lowlight as unknown as { listLanguages: typeof patchedListLanguages }).listLanguages =
  patchedListLanguages

export const SUPPORTED_LANGUAGE_KEYS = new Set(
  SUPPORTED_LANGUAGES.map((l) => l.key).filter(
    (k) => lowlight.registered(k) || k === 'text' || resolveFirstAvailable(hlMap[k] ?? []) != null
  )
)

const FALLBACK_ALIAS: Record<string, string> = {
  md: 'markdown',
  yml: 'yaml',
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  jsx: 'javascript',
  tsx: 'typescript',
  html: 'xml',
  toml: 'ini'
}

export function safeLanguage(raw: string | null | undefined): string {
  if (!raw) return 'text'
  const norm = raw.toLowerCase().trim()
  if (!norm) return 'text'
  if (lowlight.registered(norm)) return norm
  const fb = FALLBACK_ALIAS[norm]
  if (fb && lowlight.registered(fb)) return fb
  if (lowlight.registered('plaintext')) return 'plaintext'
  return 'text'
}

export function canonicalLanguage(key: string): string {
  const aliased = aliasKeyTarget.get(key)
  if (aliased && lowlight.registered(aliased)) return aliased
  const resolved = resolveFirstAvailable(hlMap[key] ?? [])
  if (resolved && lowlight.registered(resolved)) return resolved
  return key
}

const SUGGESTION_SAMPLE_LIMIT = 5000

function firstMeaningfulChar(line: string): string {
  return line.trim()[0] ?? ''
}

const HTMLISH_TAGS =
  /\b(?:html|head|body|div|span|p|a|img|ul|ol|li|table|tr|td|th|button|input|section|h[1-6]|title|script|style|form|label|nav|header|footer)\b/

function isHtmlLike(sample: string): boolean {
  if (/<!doctype/i.test(sample)) return true
  const tagNames = [...sample.matchAll(/<\/?([a-z][\w-]*)/g)].map((m) => m[1])
  if (tagNames.some((n) => HTMLISH_TAGS.test(` ${n} `))) return true
  return /\b(?:class|href|src|id)\s*=/i.test(sample)
}

const MERMAID_MARKER =
  /^\s*(?:flowchart|graph\s+(?:[TB]D|[RL]B)|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|pie|gantt|mindmap|timeline|quadrantChart|gitGraph)\b/

function markerLanguage(sample: string): string | null {
  const first = firstMeaningfulChar(sample)
  if ((first === '{' || first === '[') && lowlight.registered('json')) {
    try {
      JSON.parse(sample)
      return 'json'
    } catch {
      /* not json */
    }
  }
  if (
    lowlight.registered('xml') &&
    (/<\/?[a-z][\w:-]*[^>]*>/.test(sample) ||
      /xmlns\s*=|<\?xml/i.test(sample) ||
      /<\/?[A-Z][\w]*\s+[^<>]*=/.test(sample))
  ) {
    return isHtmlLike(sample) ? 'html' : 'xml'
  }
  if (
    lowlight.registered('bash') &&
    /(^|\n)\s*#!\s*\/?(?:usr\/bin\/(?:ba|z|)sh|bin\/(?:ba)sh)/.test(sample)
  ) {
    return 'bash'
  }
  if (lowlight.registered('sql')) {
    const cmd =
      /\b(?:select\b[\s\S]{0,80}?\bfrom\b|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(?:table|view|index)|alter\s+table|drop\s+table|concat\(|group\s+by\b)/i
    if (cmd.test(sample)) return 'sql'
  }
  if (lowlight.registered('java')) {
    if (
      /\bSystem\.out\.(?:print|println)\b|\bthrows\s+[A-Z]\w*\b|\bpublic\s+(?:final\s+)?(?:class|interface)\b|^import\s+(?:java\.|javax\.)/m.test(
        sample
      )
    )
      return 'java'
  }
  if (lowlight.registered('python')) {
    if (
      /(^|\n)(?:def\s+\w+|import\s+\w+|from\s+\w+(?:\.\w+)*\s+import\s|class\s+\w+.*:\s*$)/m.test(
        sample
      )
    )
      return 'python'
  }
  if (lowlight.registered('javascript')) {
    if (
      /\b(?:const|let|var)\s+\w+\s*=|\bfunction\s+\w*?\s*\(|=>|console\.log\(|(^|\n)(?:import\s|export\s)/m.test(
        sample
      )
    )
      return 'javascript'
  }
  if (lowlight.registered('mermaid') && MERMAID_MARKER.test(sample)) return 'mermaid'
  return null
}

export function suggestLanguage(text: string | null | undefined): string | null {
  const sample = text?.trim()
  if (!sample) return null
  const subset = [
    ...new Set(
      [...SUPPORTED_LANGUAGE_KEYS]
        .filter((k) => k !== 'text' && k !== 'plaintext' && lowlight.registered(k))
        .map(canonicalLanguage)
    )
  ].filter((k) => k !== 'text' && k !== 'plaintext' && lowlight.registered(k))
  if (subset.length === 0) return null
  try {
    const clip = sample.slice(0, SUGGESTION_SAMPLE_LIMIT)
    const marker = markerLanguage(clip)
    const top = lowlight.highlightAuto(clip, { subset })
    if (!marker && (top.data?.relevance ?? 0) < 3) return null
    const markerCanonical = marker ? canonicalLanguage(marker) : null
    const useMarker =
      marker != null &&
      (subset.includes(marker) || (markerCanonical != null && subset.includes(markerCanonical)))
    const chosen = useMarker && marker ? marker : top.data?.language
    if (!chosen) return null
    const lang = safeLanguage(chosen)
    if (lang === 'text' || lang === 'plaintext') return null
    if (useMarker) return lang
    const rest = subset.filter((k) => k !== lang)
    if (rest.length === 0) return lang
    const second = lowlight.highlightAuto(clip, { subset: rest })
    if ((second.data?.relevance ?? 0) * 1.25 > (top.data?.relevance ?? 0)) return null
    return lang
  } catch {
    return null
  }
}
