import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { promises as fs } from 'fs'
import { join } from 'path'
import * as browser from './browser'
import { APP_VERSION } from '../version'
import type { SettingsStore } from '../settings'
import type { PTNotesService } from '../service/PTNotesService'

const TRUNCATE_LEN = 300_000

function truncate(text: string): string {
  return text.length > TRUNCATE_LEN ? text.slice(0, TRUNCATE_LEN) + '\n…(truncated)' : text
}

interface SnapshotOptions {
  depth?: number
  boxes?: boolean
}

interface SnapshotNode {
  role: string
  name: string
  ref?: string
  children?: (SnapshotNode | string)[]
  text?: string
  level?: number
  url?: string
  placeholder?: string
  checked?: boolean
  disabled?: boolean
  expanded?: boolean
  selected?: boolean
  box?: { x: number; y: number; w: number; h: number }
}

interface PageSnapshot {
  title: string
  url: string
  nodes: SnapshotNode[]
}

async function extractPageSnapshot(
  page: {
    evaluate: (fn: string) => Promise<PageSnapshot>
  },
  options?: SnapshotOptions
): Promise<PageSnapshot> {
  const result = await page.evaluate(
    `(() => {
      const opts = ${JSON.stringify({ depth: options?.depth ?? null, boxes: options?.boxes ?? false })};
      // Clear previous refs
      document.querySelectorAll('[data-ref]').forEach(el => el.removeAttribute('data-ref'));

      let refCounter = 0;

      function isHidden(el) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none') return true;
        if (style.visibility === 'hidden') return true;
        if (el.getAttribute('aria-hidden') === 'true') return true;
        if (el.offsetWidth === 0 && el.offsetHeight === 0 && style.position !== 'fixed') return true;
        return false;
      }

      function getExplicitRole(el) {
        const r = el.getAttribute('role');
        return r || null;
      }

      function inferRole(el) {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        switch (tag) {
          case 'a': return el.hasAttribute('href') ? 'link' : 'generic';
          case 'button': return 'button';
          case 'input':
            if (['text','','search','email','password','tel','url'].includes(type)) return 'textbox';
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            if (type === 'range') return 'slider';
            if (type === 'number') return 'spinbutton';
            if (type === 'file') return 'button';
            if (type === 'submit' || type === 'reset' || type === 'button') return 'button';
            return 'textbox';
          case 'select': return 'combobox';
          case 'textarea': return 'textbox';
          case 'h1': return 'heading';
          case 'h2': return 'heading';
          case 'h3': return 'heading';
          case 'h4': return 'heading';
          case 'h5': return 'heading';
          case 'h6': return 'heading';
          case 'ul': case 'ol': return 'list';
          case 'li': return 'listitem';
          case 'table': return 'table';
          case 'thead': case 'tbody': case 'tfoot': return 'rowgroup';
          case 'tr': return 'row';
          case 'td': case 'th': return 'cell';
          case 'nav': return 'navigation';
          case 'main': return 'main';
          case 'header': return 'banner';
          case 'footer': return 'contentinfo';
          case 'form': return 'form';
          case 'img': return 'img';
          case 'section': return 'region';
          case 'article': return 'article';
          case 'aside': return 'complementary';
          case 'details': return 'group';
          case 'dialog': return 'dialog';
          case 'fieldset': return 'group';
          case 'figure': return 'figure';
          case 'figcaption': return 'caption';
          case 'label': return 'generic';
          case 'summary': return 'button';
          case 'option': return 'option';
          case 'optgroup': return 'group';
          case 'video': case 'audio': return 'generic';
          default: return 'generic';
        }
      }

      function getRole(el) {
        return getExplicitRole(el) || inferRole(el);
      }

      function getName(el) {
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel.trim().slice(0, 200);

        const tag = el.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
          const ph = el.getAttribute('placeholder');
          if (ph) return ph.trim().slice(0, 200);
        }

        const title = el.getAttribute('title');
        if (title) return title.trim().slice(0, 200);

        if (tag === 'img') {
          const alt = el.getAttribute('alt');
          if (alt) return alt.trim().slice(0, 200);
        }

        // For buttons / links / headings / summary — use text content
        const role = getRole(el);
        if (['button', 'link', 'heading', 'tab', 'menuitem', 'option', 'cell', 'columnheader', 'rowheader'].includes(role)) {
          const text = el.textContent?.trim().slice(0, 200);
          if (text) return text;
        }

        // Fallback: short text content
        const text = el.textContent?.trim().slice(0, 100);
        return text || '';
      }

      function isInteractive(el) {
        const role = getRole(el);
        if (['button','link','textbox','combobox','checkbox','radio','slider','spinbutton','tab','menuitem','option','searchbox'].includes(role)) return true;
        if (el.hasAttribute('onclick')) return true;
        if (el.getAttribute('tabindex') !== null && el.getAttribute('tabindex') !== '-1') return true;
        if (el.tagName.toLowerCase() === 'a' && el.hasAttribute('href')) return true;
        return false;
      }

      function buildNode(el, depth, maxDepth, includeBoxes) {
        if (isHidden(el)) return null;

        const role = getRole(el);
        const name = getName(el);
        const node = { role, name };

        // Assign ref to interactive elements
        if (isInteractive(el)) {
          const ref = 'e' + refCounter++;
          node.ref = ref;
          el.setAttribute('data-ref', ref);
        }

        // Heading level
        if (role === 'heading') {
          const tag = el.tagName.toLowerCase();
          const level = parseInt(tag.charAt(1));
          if (!isNaN(level)) node.level = level;
        }

        // Link URL
        if (role === 'link') {
          const href = el.getAttribute('href');
          if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
            node.url = href;
          }
        }

        // Input placeholder
        if (role === 'textbox' || role === 'searchbox') {
          const ph = el.getAttribute('placeholder');
          if (ph) node.placeholder = ph;
        }

        // Checkbox / radio state
        if (role === 'checkbox' || role === 'radio') {
          node.checked = el.checked || false;
        }

        // Disabled
        if (el.disabled) node.disabled = true;

        // Expanded
        const expanded = el.getAttribute('aria-expanded');
        if (expanded !== null) node.expanded = expanded === 'true';

        // Selected
        const selected = el.getAttribute('aria-selected');
        if (selected !== null) node.selected = selected === 'true';

        // Bounding box
        if (includeBoxes) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0) {
            node.box = {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              w: Math.round(rect.width),
              h: Math.round(rect.height)
            };
          }
        }

        // Children (if depth allows)
        if (maxDepth === null || maxDepth === undefined || depth < maxDepth) {
          const children = [];
          for (const child of el.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE) {
              const childNode = buildNode(child, depth + 1, maxDepth, includeBoxes);
              if (childNode) children.push(childNode);
            } else if (child.nodeType === Node.TEXT_NODE) {
              const text = child.textContent?.trim();
              if (text) children.push(text);
            }
          }
          if (children.length === 1 && typeof children[0] === 'string') {
            node.text = children[0];
          } else if (children.length > 0) {
            node.children = children;
          }
        }

        return node;
      }

      // Build tree from body
      const body = document.body;
      if (!body) return { title: document.title, url: location.href, nodes: [] };

      const nodes = [];
      for (const child of body.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const node = buildNode(child, 0, opts.depth, opts.boxes);
          if (node) nodes.push(node);
        } else if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent?.trim();
          if (text) nodes.push(text);
        }
      }

      return { title: document.title, url: location.href, nodes };
    })()`
  )
  return result
}

export function createBrowserMcpServer(
  service?: PTNotesService,
  settingsStore?: SettingsStore
): McpServer {
  const server = new McpServer({
    name: 'ptnotes-browser',
    version: APP_VERSION
  })

  server.registerTool(
    'browser_navigate',
    {
      description:
        'Navigate the browser to a URL. Returns the page title and a structured snapshot of the content.',
      inputSchema: {
        url: z.string().describe('The URL to navigate to')
      }
    },
    async ({ url }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      const snapshot = await extractPageSnapshot(page)
      const headlessNote = browser.headlessMode()
        ? '\n⚠️ Running in headless mode — the browser is invisible to the user.'
        : ''
      return {
        content: [
          {
            type: 'text' as const,
            text: truncate(JSON.stringify(snapshot, null, 2) + headlessNote)
          }
        ]
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
      const snapshot = await extractPageSnapshot(page)
      return {
        content: [{ type: 'text' as const, text: truncate(JSON.stringify(snapshot, null, 2)) }]
      }
    }
  )

  server.registerTool(
    'browser_snapshot',
    {
      description:
        'Capture a structured accessibility snapshot of the current page. Returns a JSON tree with role, name, and ref for each visible element. Use refs to target elements in browser_click, browser_type, etc.',
      inputSchema: {
        depth: z.number().optional().describe('Limit the depth of the snapshot tree'),
        boxes: z
          .boolean()
          .optional()
          .describe("Include each element's bounding box as {x,y,w,h} in CSS pixels")
      }
    },
    async ({ depth, boxes }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      const snapshot = await extractPageSnapshot(page, { depth, boxes })
      return {
        content: [{ type: 'text' as const, text: truncate(JSON.stringify(snapshot, null, 2)) }]
      }
    }
  )

  server.registerTool(
    'browser_click',
    {
      description:
        'Click an element on the page. Use ref from browser_snapshot for precise targeting, or element text as fallback.',
      inputSchema: {
        ref: z
          .string()
          .optional()
          .describe('The ref of the element to click (from browser_snapshot)'),
        element: z
          .string()
          .optional()
          .describe('The visible text or label of the element to click (fallback if no ref)')
      }
    },
    async ({ ref, element }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      if (ref) {
        const locator = page.locator(`[data-ref="${ref}"]`)
        await locator.click({ timeout: 10_000 })
        return { content: [{ type: 'text' as const, text: `Clicked ref "${ref}".` }] }
      }
      if (element) {
        // Try visible elements first
        const candidates = page.getByText(element, { exact: false })
        const count = await candidates.count().catch(() => 0)
        for (let i = 0; i < count; i++) {
          const el = candidates.nth(i)
          if (await el.isVisible().catch(() => false)) {
            await el.click({ timeout: 10_000 })
            return { content: [{ type: 'text' as const, text: `Clicked "${element}".` }] }
          }
        }
        // Fallback: try button role
        await page.getByRole('button', { name: element }).first().click({ timeout: 10_000 })
        return { content: [{ type: 'text' as const, text: `Clicked "${element}".` }] }
      }
      return {
        content: [{ type: 'text' as const, text: 'Error: provide ref or element parameter.' }],
        isError: true
      }
    }
  )

  server.registerTool(
    'browser_type',
    {
      description: 'Type text into a form input field.',
      inputSchema: {
        ref: z.string().optional().describe('The ref of the input element (from browser_snapshot)'),
        element: z
          .string()
          .optional()
          .describe('The placeholder text, label, or aria-label of the input field (fallback)'),
        text: z.string().describe('The text to type'),
        pressEnter: z
          .boolean()
          .optional()
          .describe('If true, press Enter after typing (default false)')
      }
    },
    async ({ ref, element, text, pressEnter }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      if (ref) {
        const locator = page.locator(`[data-ref="${ref}"]`)
        await locator.fill(text, { timeout: 10_000 })
        if (pressEnter) await page.keyboard.press('Enter')
        return { content: [{ type: 'text' as const, text: `Typed into ref "${ref}".` }] }
      }
      if (element) {
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
      return {
        content: [{ type: 'text' as const, text: 'Error: provide ref or element parameter.' }],
        isError: true
      }
    }
  )

  server.registerTool(
    'browser_select_option',
    {
      description: 'Select an option in a <select> dropdown.',
      inputSchema: {
        ref: z
          .string()
          .optional()
          .describe('The ref of the select element (from browser_snapshot)'),
        element: z
          .string()
          .optional()
          .describe('The accessible name of the select element (fallback)'),
        value: z.string().describe('The option value to select')
      }
    },
    async ({ ref, element, value }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      if (ref) {
        const locator = page.locator(`[data-ref="${ref}"]`)
        await locator.selectOption(value, { timeout: 10_000 })
        return {
          content: [{ type: 'text' as const, text: `Selected "${value}" in ref "${ref}".` }]
        }
      }
      if (element) {
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
        return {
          content: [{ type: 'text' as const, text: `Selected "${value}" in "${element}".` }]
        }
      }
      return {
        content: [{ type: 'text' as const, text: 'Error: provide ref or element parameter.' }],
        isError: true
      }
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
        project: z.string().optional().describe('Project name. Defaults to the current project.'),
        fullPage: z
          .boolean()
          .optional()
          .describe('If true, capture the full scrollable page (default false)')
      }
    },
    async ({ project, fullPage }) => {
      const page = await browser.getBrowserPage(browser.headlessMode())
      const ts = Date.now()
      let dir: string
      if (service && project) {
        dir = service.screenshotsDir(project)
      } else if (settingsStore) {
        dir = join((await settingsStore.load()).rootDir, 'screenshots')
      } else {
        dir = join(process.cwd(), 'screenshots')
      }
      await fs.mkdir(dir, { recursive: true })
      const filePath = join(dir, `browser-${ts}.png`)
      await page.screenshot({ path: filePath, fullPage: !!fullPage })
      return { content: [{ type: 'text' as const, text: `Screenshot saved: ${filePath}` }] }
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
      if (settingsStore) {
        const settings = await settingsStore.load()
        await settingsStore.save({ ...settings, browserHeadless: headless })
      }
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
