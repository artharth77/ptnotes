import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright-core'
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
let _ensureQueue: Promise<Page> | null = null

function isRunning(): boolean {
  return !!_browser?.isConnected()
}

function pageUsable(): boolean {
  return isRunning() && !!_page && !_page.isClosed()
}

function isClosedError(err: unknown): boolean {
  return err instanceof Error && /closed|crashed|disconnected/i.test(err.message)
}

function contextOptions(
  maximize: boolean,
  headless: boolean,
  ignoreHttpsErrors: boolean
): BrowserContextOptions {
  return {
    ...(maximize && !headless ? { viewport: null } : {}),
    ignoreHTTPSErrors: ignoreHttpsErrors || undefined
  }
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
      _context = await _browser.newContext(contextOptions(maximize, headless, ignoreHttpsErrors))
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
  if (pageUsable()) return _page!
  if (_ensureQueue) return _ensureQueue

  const task = (async (): Promise<Page> => {
    if (pageUsable()) return _page!

    if (isRunning() && _browser) {
      const browser = _browser
      const context =
        _context && !_context.isClosed()
          ? _context
          : await browser.newContext(contextOptions(maximize, headless, ignoreHttpsErrors))
      _context = context
      _page = await context.newPage()
      return _page
    }

    await launch(headless, maximize, ignoreHttpsErrors)
    if (!pageUsable()) throw new Error('Browser closed during launch.')
    return _page!
  })()

  _ensureQueue = task
  void task
    .catch(() => {})
    .then(() => {
      if (_ensureQueue === task) _ensureQueue = null
    })
  return task
}

export async function getBrowserPage(
  headless: boolean,
  maximize = false,
  ignoreHttpsErrors = false
): Promise<Page> {
  try {
    return await ensureLaunched(headless, maximize, ignoreHttpsErrors)
  } catch (err) {
    if (!isClosedError(err)) throw err
    await close()
    return ensureLaunched(headless, maximize, ignoreHttpsErrors)
  }
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
  if (_headless === headless && pageUsable()) return
  await close()
  await getBrowserPage(headless, _maximize, _ignoreHttpsErrors)
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
