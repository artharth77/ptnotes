import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as browser from './browser'
import { APP_VERSION } from '../version'

const TRUNCATE_LEN = 24_000

function truncate(text: string): string {
  return text.length > TRUNCATE_LEN ? text.slice(0, TRUNCATE_LEN) + '\n…(truncated)' : text
}

async function extractPageState(page: {
  evaluate: (fn: string) => Promise<string>
}): Promise<string> {
  const result = await page.evaluate(`(() => {
    const title = document.title;
    const text = document.body?.innerText ?? '';
    const els = Array.from(document.querySelectorAll('a, button, input, select, textarea, [role], [tabindex]'));
    const interactive = els.map(el => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') ?? '';
      const name = el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.textContent?.trim().slice(0, 80) ?? '';
      const type = el.getAttribute('type') ?? '';
      const href = el.getAttribute('href') ?? '';
      const value = tag === 'input' ? el.value : '';
      return [tag, role, name, type, value, href].filter(Boolean).join(' | ');
    }).filter(Boolean).join('\\n');
    return 'Title: ' + title + '\\n\\nText:\\n' + text + (interactive ? '\\n\\nInteractive elements:\\n' + interactive : '');
  })()`)
  return result
}

export function createBrowserMcpServer(): McpServer {
  const server = new McpServer({
    name: 'ptnotes-browser',
    version: APP_VERSION
  })

  server.registerTool(
    'browser_navigate',
    {
      description:
        'Navigate the browser to a URL. Returns the page title and a summary of the content.',
      inputSchema: {
        url: z.string().describe('The URL to navigate to')
      }
    },
    async ({ url }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      const state = await extractPageState(page)
      const headlessNote = browser.headlessMode()
        ? '\n⚠️ Running in headless mode — the browser is invisible to the user.'
        : ''
      return {
        content: [{ type: 'text' as const, text: `Navigated to ${url}\n${state}${headlessNote}` }]
      }
    }
  )

  server.registerTool(
    'browser_navigate_back',
    {
      description: 'Navigate the browser back one page in history.'
    },
    async () => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
      const title = await page.title()
      return { content: [{ type: 'text' as const, text: `Navigated back.\nTitle: ${title}` }] }
    }
  )

  server.registerTool(
    'browser_snapshot',
    {
      description:
        'Take a snapshot of the current page — returns the page text and all interactive elements (links, buttons, inputs, selects). Use this to see what is on the page and decide what to click or type.',
      inputSchema: {
        detailed: z
          .boolean()
          .optional()
          .describe('If true, include more detail in the snapshot (default false)')
      }
    },
    async () => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      const state = await extractPageState(page)
      return { content: [{ type: 'text' as const, text: truncate(state) }] }
    }
  )

  server.registerTool(
    'browser_click',
    {
      description:
        'Click an element on the page. Use the text visible on the element (link text, button label, etc).',
      inputSchema: {
        element: z.string().describe('The visible text or label of the element to click')
      }
    },
    async ({ element }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      const target = page.getByText(element, { exact: false }).first()
      const alt = page.getByRole('button', { name: element }).first()
      const count = await target.count().catch(() => 0)
      if (count > 0) {
        await target.click({ timeout: 10_000 })
      } else {
        await alt.click({ timeout: 10_000 })
      }
      return { content: [{ type: 'text' as const, text: `Clicked "${element}".` }] }
    }
  )

  server.registerTool(
    'browser_type',
    {
      description: 'Type text into a form input field.',
      inputSchema: {
        element: z
          .string()
          .describe('The placeholder text, label, or aria-label of the input field'),
        text: z.string().describe('The text to type'),
        pressEnter: z
          .boolean()
          .optional()
          .describe('If true, press Enter after typing (default false)')
      }
    },
    async ({ element, text, pressEnter }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      const filled = await page
        .getByPlaceholder(element)
        .first()
        .fill(text, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
      if (!filled) {
        await page.getByLabel(element).first().fill(text, { timeout: 10_000 })
      }
      if (pressEnter) await page.keyboard.press('Enter')
      return { content: [{ type: 'text' as const, text: `Typed into "${element}".` }] }
    }
  )

  server.registerTool(
    'browser_select_option',
    {
      description: 'Select an option in a <select> dropdown.',
      inputSchema: {
        element: z.string().describe('The accessible name of the select element'),
        value: z.string().describe('The option value to select')
      }
    },
    async ({ element, value }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      await page
        .getByRole('combobox', { name: element })
        .first()
        .selectOption(value, { timeout: 10_000 })
        .catch(async () => {
          await page
            .locator('select')
            .filter({ hasText: element })
            .first()
            .selectOption(value, { timeout: 10_000 })
        })
      return { content: [{ type: 'text' as const, text: `Selected "${value}" in "${element}".` }] }
    }
  )

  server.registerTool(
    'browser_press_key',
    {
      description: 'Press a keyboard key on the page (e.g. "Enter", "Escape", "Tab", "ArrowDown").',
      inputSchema: {
        key: z.string().describe('The key to press (Playwright key identifier)')
      }
    },
    async ({ key }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      await page.keyboard.press(key)
      return { content: [{ type: 'text' as const, text: `Pressed "${key}".` }] }
    }
  )

  server.registerTool(
    'browser_screenshot',
    {
      description: 'Take a screenshot of the current page. Returns the file path of the saved PNG.',
      inputSchema: {
        fullPage: z
          .boolean()
          .optional()
          .describe('If true, capture the full scrollable page (default false)')
      }
    },
    async ({ fullPage }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      const ts = Date.now()
      const path = `browser-${ts}.png`
      await page.screenshot({ path, fullPage: !!fullPage })
      return { content: [{ type: 'text' as const, text: `Screenshot saved: ${path}` }] }
    }
  )

  server.registerTool(
    'browser_evaluate',
    {
      description:
        'Execute JavaScript in the page and return the result. Use this for reading page state, form values, or performing complex checks.',
      inputSchema: {
        expression: z.string().describe('JavaScript expression to evaluate')
      }
    },
    async ({ expression }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      const result = await page.evaluate(expression)
      return { content: [{ type: 'text' as const, text: truncate(String(result ?? '')) }] }
    }
  )

  server.registerTool(
    'browser_wait_for',
    {
      description:
        'Wait for a condition on the page (element visible, text present, or a timeout).',
      inputSchema: {
        selector: z.string().optional().describe('CSS selector to wait for'),
        text: z.string().optional().describe('Text content to wait for'),
        timeout: z.number().optional().describe('Timeout in milliseconds (default 10000)')
      }
    },
    async ({ selector, text, timeout }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      const ms = timeout ?? 10_000
      if (selector) {
        await page.waitForSelector(selector, { timeout: ms })
        return { content: [{ type: 'text' as const, text: `Selector "${selector}" appeared.` }] }
      }
      if (text) {
        await page.waitForFunction((t) => document.body?.innerText.includes(t), text, {
          timeout: ms
        })
        return { content: [{ type: 'text' as const, text: `Text "${text}" appeared.` }] }
      }
      await page.waitForTimeout(ms)
      return { content: [{ type: 'text' as const, text: `Waited ${ms}ms.` }] }
    }
  )

  server.registerTool(
    'browser_set_mode',
    {
      description:
        'Switch between headful and headless mode. The browser relaunches. IMPORTANT: Before calling this with headless=true, you MUST ask the user for confirmation — the browser will be invisible.',
      inputSchema: {
        headless: z.boolean().describe('true for headless (invisible), false for headful (visible)')
      }
    },
    async ({ headless }) => {
      await browser.setMode(headless)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Browser relaunched in ${headless ? 'headless' : 'headful'} mode.`
          }
        ]
      }
    }
  )

  server.registerTool(
    'browser_close',
    {
      description: 'Close the browser and release all resources.'
    },
    async () => {
      await browser.close()
      return { content: [{ type: 'text' as const, text: 'Browser closed.' }] }
    }
  )

  return server
}
