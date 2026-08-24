import type { Browser, BrowserContext, Page } from 'playwright-core'
import { chromium } from 'playwright-core'

const BROWSER_CHANNELS = ['chrome', 'msedge'] as const

let _browser: Browser | null = null
let _context: BrowserContext | null = null
let _page: Page | null = null
let _headless = false
let _engineName = ''
let _launching = false
let _launchQueue: Promise<void> | null = null

function isRunning(): boolean {
  return !!_browser?.isConnected()
}

async function launch(headless: boolean): Promise<void> {
  _headless = headless
  let lastError: Error | null = null

  for (const channel of BROWSER_CHANNELS) {
    try {
      _browser = await chromium.launch({ headless, channel })
      _engineName = channel === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'
      _context = await _browser.newContext()
      _page = await _context.newPage()
      _browser.on('disconnected', () => {
        _browser = null
        _context = null
        _page = null
      })
      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  const msg = lastError
    ? `No supported browser found. Install Google Chrome or Microsoft Edge to use the browser toolset. (${lastError.message})`
    : 'No supported browser found. Install Google Chrome or Microsoft Edge to use the browser toolset.'
  throw new Error(msg)
}

async function ensureLaunched(headless: boolean): Promise<Page> {
  if (isRunning()) return _page!

  if (_launching && _launchQueue) {
    await _launchQueue
    if (isRunning()) return _page!
  }

  _launching = true
  _launchQueue = launch(headless).finally(() => {
    _launching = false
    _launchQueue = null
  })
  await _launchQueue
  return _page!
}

export async function getBrowserPage(headless: boolean): Promise<Page> {
  return ensureLaunched(headless)
}

export function headlessMode(): boolean {
  return _headless
}

export function engineName(): string {
  return _engineName
}

export function getDefaultHeadless(): boolean {
  return _headless
}

export function setDefaultHeadless(headless: boolean): void {
  _headless = headless
}

export async function setMode(headless: boolean): Promise<void> {
  if (_headless === headless && isRunning()) return
  await close()
  await ensureLaunched(headless)
}

export async function close(): Promise<void> {
  if (_context) {
    await _context.close().catch(() => {})
    _context = null
  }
  _page = null
  if (_browser) {
    await _browser.close().catch(() => {})
    _browser = null
  }
}
