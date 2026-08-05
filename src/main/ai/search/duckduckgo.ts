export interface SearchResult {
  title: string
  url: string
  snippet: string
}

const DDG_HOME = 'https://duckduckgo.com/'
const DDG_HTML = 'https://html.duckduckgo.com/html/'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/**
 * DuckDuckGo search. No API key required. DuckDuckGo requires a `vqd` token,
 * fetched from the homepage before querying the HTML endpoint. Free tier can be
 * rate-limited; callers should surface failures to the model so it can adapt.
 */
export async function duckDuckGoSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const vqd = await fetchVqd(query)
  const body = new URLSearchParams({ q: query, vqd })
  const res = await fetch(DDG_HTML, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html'
    },
    body
  })
  if (!res.ok) {
    throw new Error(`Search request failed with status ${res.status}`)
  }
  const html = await res.text()
  if (html.length < 1000) {
    throw new Error('Search was rate-limited or blocked. Try again shortly.')
  }
  const results = parseResults(html)
  if (results.length === 0) {
    throw new Error('Search returned no results. Try a different query.')
  }
  return results.slice(0, maxResults)
}

async function fetchVqd(query: string): Promise<string> {
  const res = await fetch(`${DDG_HOME}?q=${encodeURIComponent(query)}&ia=web`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' }
  })
  if (!res.ok) throw new Error(`DuckDuckGo unreachable (status ${res.status})`)
  const html = await res.text()
  const match =
    html.match(/vqd="([^"]+)"/) ?? html.match(/vqd='([^']+)'/) ?? html.match(/"vqd":\s*"([^"]+)"/)
  if (!match?.[1]) throw new Error('DuckDuckGo did not return a search token. Try again.')
  return match[1]
}

function parseResults(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const titleRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const chunks: { title: string; url: string; from: number }[] = []
  let m: RegExpExecArray | null
  while ((m = titleRegex.exec(html)) !== null) {
    chunks.push({ title: stripTags(m[2]), url: m[1], from: m.index })
  }
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const end = chunks[i + 1] ? chunks[i + 1].from : html.length
    const window = html.slice(c.from, end)
    const snippetMatch =
      window.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/) ??
      window.match(/<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/)
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : ''
    const url = normalizeUrl(c.url)
    if (url) results.push({ title: c.title, url, snippet })
  }
  return results
}

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.hostname === 'duckduckgo.com' && url.pathname.startsWith('/l/')) {
      const redirect = url.searchParams.get('uddg')
      if (redirect) return decodeURIComponent(redirect)
    }
    return url.href
  } catch {
    return null
  }
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
}
