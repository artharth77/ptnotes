import * as cheerio from 'cheerio'

export interface WebPageContent {
  url: string
  title: string
  text: string
  excerpt: string
}

const MAX_BYTES = 1_500_000
const MAX_TEXT_CHARS = 20_000

/**
 * Fetch a URL and extract readable text locally (no third-party service).
 */
export async function fetchWebPage(url: string): Promise<WebPageContent> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PTNotes/0.1; +research)' },
    redirect: 'follow'
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch page: HTTP ${res.status}`)
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('html')) {
    throw new Error(`Unsupported content type: ${contentType}`)
  }
  const html = (await res.text()).slice(0, MAX_BYTES)
  return extractFromHtml(html, url)
}

export function extractFromHtml(html: string, url: string): WebPageContent {
  const $ = cheerio.load(html)
  $(
    'script, style, noscript, svg, canvas, iframe, nav, footer, header, aside, form, button'
  ).remove()
  const title = $('title').first().text().trim() || url
  const body = $('body')
  body.find('p, h1, h2, h3, h4, li, pre, blockquote, td, th, dt, dd').append('\n')
  const text = body
    .text()
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  return {
    url,
    title,
    text: text.slice(0, MAX_TEXT_CHARS),
    excerpt: text.slice(0, 600)
  }
}
