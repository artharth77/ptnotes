import type { Browser, BrowserContext, Page } from 'playwright-core'
import { chromium } from 'playwright-core'
import { screen } from 'electron'

const BROWSER_CHANNELS = ['chrome', 'msedge'] as const

let _browser: Browser | null = null
let _context: BrowserContext | null = null
let _page: Page | null = null
let _headless = false
let _maximize = false
let _ignoreHttpsErrors = false
let _engineName = ''
let _launching = false
let _launchQueue: Promise<void> | null = null

function isRunning(): boolean {
  return !!_browser?.isConnected()
}

async function launch(
  headless: boolean,
  maximize = false,
  ignoreHttpsErrors = false
): Promise<void> {
  _headless = headless
  _maximize = maximize
  _ignoreHttpsErrors = ignoreHttpsErrors
  let lastError: Error | null = null

  for (const channel of BROWSER_CHANNELS) {
    try {
      const launchOpts: Record<string, unknown> = { headless, channel }
      if (maximize && !headless) {
        if (process.platform === 'darwin') {
          const { width, height } = screen.getPrimaryDisplay().workAreaSize
          launchOpts.args = [`--window-size=${width},${height}`, '--window-position=0,0']
        } else {
          launchOpts.args = ['--start-maximized']
        }
      }
      _browser = await chromium.launch(launchOpts)
      _engineName = channel === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'
      _context = await _browser.newContext({
        ...(maximize && !headless ? { viewport: null } : {}),
        ignoreHTTPSErrors: ignoreHttpsErrors || undefined
      })
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

async function ensureLaunched(
  headless: boolean,
  maximize = false,
  ignoreHttpsErrors = false
): Promise<Page> {
  if (isRunning()) return _page!

  if (_launching && _launchQueue) {
    await _launchQueue
    if (isRunning()) return _page!
  }

  _launching = true
  _launchQueue = launch(headless, maximize, ignoreHttpsErrors).finally(() => {
    _launching = false
    _launchQueue = null
  })
  await _launchQueue
  return _page!
}

export async function getBrowserPage(
  headless: boolean,
  maximize = false,
  ignoreHttpsErrors = false
): Promise<Page> {
  return ensureLaunched(headless, maximize, ignoreHttpsErrors)
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

export function getDefaultMaximize(): boolean {
  return _maximize
}

export function setDefaultMaximize(maximize: boolean): void {
  _maximize = maximize
}

export function getDefaultIgnoreHttpsErrors(): boolean {
  return _ignoreHttpsErrors
}

export function setDefaultIgnoreHttpsErrors(ignoreHttpsErrors: boolean): void {
  _ignoreHttpsErrors = ignoreHttpsErrors
}

export async function setMode(headless: boolean): Promise<void> {
  if (_headless === headless && isRunning()) return
  await close()
  await ensureLaunched(headless, _maximize, _ignoreHttpsErrors)
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
