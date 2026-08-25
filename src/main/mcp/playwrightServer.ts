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
  maxNodes?: number
}

interface SnapshotNode {
  role: string
  name?: string
  tag?: string
  ref?: string
  children?: (SnapshotNode | string)[]
  text?: string
  level?: number
  url?: string
  placeholder?: string
  value?: string
  description?: string
  checked?: boolean
  indeterminate?: boolean
  disabled?: boolean
  expanded?: boolean
  selected?: boolean
  pressed?: boolean
  valuenow?: number | string
  truncated?: boolean
  box?: { x: number; y: number; w: number; h: number }
}

interface PageSnapshot {
  title: string
  url: string
  nodesTruncated?: boolean
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
      const opts = ${JSON.stringify({
        depth: options?.depth ?? null,
        boxes: options?.boxes ?? false,
        maxNodes: options?.maxNodes ?? null
      })};
      const MAX_NODES = opts.maxNodes || 1500;
      const MAX_VALUE_LEN = 500;
      const MAX_NAME_LEN = 200;
      const REF_ATTR = 'data-ptnotes-ref';

      // Clear previous refs
      document.querySelectorAll('[' + REF_ATTR + ']').forEach(el => el.removeAttribute(REF_ATTR));

      let refCounter = 0;
      let nodeCount = 0;
      let nodesTruncated = false;

      function isHidden(el) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none') return true;
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
        if (style.opacity === '0') return true;
        if (el.getAttribute('aria-hidden') === 'true') return true;
        return false;
      }

      function getExplicitRole(el) {
        const r = el.getAttribute('role');
        return r || null;
      }

      function inferRole(el) {
        if (el.isContentEditable) return 'textbox';
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        switch (tag) {
          case 'a': return el.hasAttribute('href') ? 'link' : 'generic';
          case 'area': return 'link';
          case 'button': return 'button';
          case 'input':
            if (type === '' || ['text','email','password','tel','url'].includes(type)) return 'textbox';
            if (type === 'search') return 'searchbox';
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            if (type === 'range') return 'slider';
            if (type === 'number') return 'spinbutton';
            if (type === 'file') return 'button';
            if (type === 'submit' || type === 'reset' || type === 'button') return 'button';
            return 'textbox';
          case 'select': return el.hasAttribute('multiple') ? 'listbox' : 'combobox';
          case 'datalist': return 'listbox';
          case 'textarea': return 'textbox';
          case 'h1': return 'heading';
          case 'h2': return 'heading';
          case 'h3': return 'heading';
          case 'h4': return 'heading';
          case 'h5': return 'heading';
          case 'h6': return 'heading';
          case 'ul': case 'ol': case 'menu': return 'list';
          case 'li': return 'listitem';
          case 'dl': return 'list';
          case 'dt': case 'dd': return 'listitem';
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
          case 'svg':
            return el.querySelector(':scope > title') ? 'img' : 'generic';
          case 'canvas': return 'img';
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
          case 'hr': return 'separator';
          case 'progress': case 'meter': return 'progressbar';
          case 'output': return 'status';
          case 'search': return 'search';
          case 'iframe': return 'iframe';
          case 'video': case 'audio': return 'generic';
          default: return 'generic';
        }
      }

      function getRole(el) {
        return getExplicitRole(el) || inferRole(el);
      }

      function refsText(el, attr) {
        const ids = (el.getAttribute(attr) || '').split(/\\s+/).filter(Boolean);
        if (!ids.length) return '';
        const parts = [];
        for (const id of ids) {
          const target = document.getElementById(id);
          const t = target ? (target.textContent || '').trim() : '';
          if (t) parts.push(t);
        }
        return parts.join(' ').slice(0, MAX_NAME_LEN);
      }

      function getLabelText(el) {
        try {
          if (el.labels && el.labels.length > 0) {
            const t = (el.labels[0].textContent || '').trim();
            if (t) return t.slice(0, MAX_NAME_LEN);
          }
        } catch (e) {}
        return '';
      }

      function getName(el) {
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel.trim().slice(0, MAX_NAME_LEN);

        const labelledBy = refsText(el, 'aria-labelledby');
        if (labelledBy) return labelledBy;

        const tag = el.tagName.toLowerCase();

        if (tag === 'svg') {
          const titleEl = el.querySelector(':scope > title');
          const svgTitle = titleEl ? (titleEl.textContent || '').trim() : '';
          if (svgTitle) return svgTitle.slice(0, MAX_NAME_LEN);
        }

        const type = (el.getAttribute('type') || '').toLowerCase();

        // Input buttons carry their label in the value attribute
        if (tag === 'input' && ['submit','reset','button','file'].includes(type)) {
          const v = el.getAttribute('value');
          if (v) return v.trim().slice(0, MAX_NAME_LEN);
        }
        if (tag === 'input' && type === 'image') {
          const alt = el.getAttribute('alt');
          if (alt) return alt.trim().slice(0, MAX_NAME_LEN);
        }

        // <label> association (wrapping or for=)
        const labelText = getLabelText(el);
        if (labelText) return labelText;

        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
          const ph = el.getAttribute('placeholder');
          if (ph) return ph.trim().slice(0, MAX_NAME_LEN);
        }

        const title = el.getAttribute('title');
        if (title) return title.trim().slice(0, MAX_NAME_LEN);

        if (tag === 'img') {
          const alt = el.getAttribute('alt');
          if (alt) return alt.trim().slice(0, MAX_NAME_LEN);
        }

        // For buttons / links / headings / summary — use text content
        const role = getRole(el);
        if (['button', 'link', 'heading', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'cell', 'columnheader', 'rowheader', 'treeitem', 'switch'].includes(role)) {
          const text = (el.textContent || '').trim().slice(0, MAX_NAME_LEN);
          if (text) return text;
        }

        // Interactive elements (clickable span/div without a semantic role) also get a text name
        if (isInteractive(el)) {
          const text = (el.textContent || '').trim().slice(0, MAX_NAME_LEN);
          if (text) return text;
        }

        // Fallback: short text of leaf elements only (avoids duplicating child text)
        if (el.children.length === 0) {
          const text = (el.textContent || '').trim().slice(0, 100);
          if (text) return text;
        }

        return '';
      }

      function isInteractive(el) {
        const role = getRole(el);
        if (['button','link','textbox','searchbox','combobox','listbox','checkbox','radio','switch','slider','spinbutton','tab','menuitem','menuitemcheckbox','menuitemradio','option','treeitem'].includes(role)) return true;
        const tabindex = el.getAttribute('tabindex');
        if (tabindex !== null && tabindex !== '-1') return true;
        const tag = el.tagName.toLowerCase();
        if ((tag === 'a' || tag === 'area') && el.hasAttribute('href')) return true;
        // Inline event handler attributes (onclick, onmousedown, onpointerdown, ontouchstart, ...)
        for (const attr of el.attributes) {
          if (/^on[a-z]/i.test(attr.name)) return true;
        }
        // Interactive ARIA attributes on plain elements (custom widgets)
        if (el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded') || el.hasAttribute('aria-pressed') || el.hasAttribute('aria-activedescendant') || el.hasAttribute('aria-controls')) return true;
        // Cursor pointer (framework-built clickables that style their target)
        if (window.getComputedStyle(el).cursor === 'pointer') return true;
        return false;
      }

      function collectChildren(container, depth, maxDepth, includeBoxes, out) {
        for (const child of container.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const childNode = buildNode(child, depth + 1, maxDepth, includeBoxes);
            if (childNode) out.push(childNode);
          } else if (child.nodeType === Node.TEXT_NODE) {
            const text = (child.textContent || '').trim();
            if (text) out.push(text);
          }
        }
      }

      function buildNode(el, depth, maxDepth, includeBoxes) {
        if (isHidden(el)) return null;
        nodeCount++;
        if (nodeCount > MAX_NODES) {
          nodesTruncated = true;
          return null;
        }

        let role = getRole(el);
        const transparent = role === 'presentation' || role === 'none';
        if (transparent) role = 'generic';

        const tag = el.tagName.toLowerCase();
        const name = transparent ? '' : getName(el);
        const node = { role };
        if (name) node.name = name;
        else node.tag = tag;

        // Assign ref to interactive elements
        if (!transparent && isInteractive(el)) {
          const ref = 'e' + refCounter++;
          node.ref = ref;
          el.setAttribute(REF_ATTR, ref);
        }

        if (!transparent) {
          // Heading level (h1-h6 or aria-level)
          if (role === 'heading') {
            let level = NaN;
            if (/^h[1-6]$/.test(tag)) level = parseInt(tag.charAt(1));
            else level = parseInt(el.getAttribute('aria-level') || '', 10);
            if (!isNaN(level)) node.level = level;
          }

          // Link / iframe URL
          if (role === 'link' || role === 'iframe') {
            const href = el.getAttribute(role === 'iframe' ? 'src' : 'href');
            if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
              node.url = href;
            }
          }

          // Placeholder + current value for editable fields
          if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton') {
            const ph = el.getAttribute('placeholder');
            if (ph) node.placeholder = ph;
            const v = typeof el.value === 'string' ? el.value : '';
            if (v) node.value = v.slice(0, MAX_VALUE_LEN);
          }
          if (role === 'combobox') {
            const sel = [];
            for (const o of el.selectedOptions || []) {
              const t = String(o.textContent || o.value || '').trim();
              if (t) sel.push(t);
            }
            if (sel.length) node.value = sel.join(', ').slice(0, MAX_VALUE_LEN);
          }

          // Checkbox / radio / switch state (ARIA-aware)
          if (['checkbox','radio','switch','menuitemcheckbox','menuitemradio'].includes(role)) {
            const ariaChecked = el.getAttribute('aria-checked');
            if (ariaChecked === 'mixed') {
              node.checked = false;
              node.indeterminate = true;
            } else if (ariaChecked !== null) {
              node.checked = ariaChecked === 'true';
            } else if (typeof el.checked === 'boolean') {
              node.checked = el.checked;
              if (el.indeterminate) node.indeterminate = true;
            }
          }

          // Slider / progressbar value
          if (role === 'slider' || role === 'spinbutton' || role === 'progressbar') {
            const raw = el.getAttribute('aria-valuenow');
            const val = raw !== null ? raw : (el.value !== undefined && el.value !== '' ? String(el.value) : null);
            if (val !== null) {
              const n = Number(val);
              node.valuenow = Number.isNaN(n) ? val : n;
            }
          }

          // Toggle button state
          if (role === 'button') {
            const pressed = el.getAttribute('aria-pressed');
            if (pressed !== null) node.pressed = pressed === 'true';
          }

          const describedBy = refsText(el, 'aria-describedby');
          if (describedBy) node.description = describedBy.slice(0, 300);
        }

        // Disabled
        if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') node.disabled = true;

        // Expanded
        const expanded = el.getAttribute('aria-expanded');
        if (expanded !== null) node.expanded = expanded === 'true';

        // Selected (aria-selected or native option)
        const selectedAttr = el.getAttribute('aria-selected');
        if (selectedAttr !== null) node.selected = selectedAttr === 'true';
        else if (tag === 'option' && el.selected) node.selected = true;

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
          collectChildren(el, depth, maxDepth, includeBoxes, children);
          // Open shadow roots
          if (el.shadowRoot) {
            collectChildren(el.shadowRoot, depth, maxDepth, includeBoxes, children);
          }
          // Same-origin iframe content
          if (tag === 'iframe') {
            try {
              const doc = el.contentDocument;
              if (doc && doc.body) collectChildren(doc.body, depth, maxDepth, includeBoxes, children);
            } catch (e) {}
          }
          if (children.length === 1 && typeof children[0] === 'string') {
            node.text = children[0];
          } else if (children.length > 0) {
            node.children = children;
          }
        } else if (el.childNodes.length > 0) {
          for (const c of el.childNodes) {
            if (c.nodeType === Node.ELEMENT_NODE || (c.nodeType === Node.TEXT_NODE && (c.textContent || '').trim())) {
              node.truncated = true;
              break;
            }
          }
        }

        return node;
      }

      // Build tree from body
      const body = document.body;
      if (!body) return { title: document.title, url: location.href, nodes: [], nodesTruncated: false };

      const nodes = [];
      for (const child of body.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const node = buildNode(child, 0, opts.depth, opts.boxes);
          if (node) nodes.push(node);
        } else if (child.nodeType === Node.TEXT_NODE) {
          const text = (child.textContent || '').trim();
          if (text) nodes.push(text);
        }
      }

      return { title: document.title, url: location.href, nodes, nodesTruncated };
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
      const page = await browser.getBrowserPage(
        browser.headlessMode(),
        browser.getDefaultMaximize(),
        browser.getDefaultIgnoreHttpsErrors()
      )
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
      const page = await browser.getBrowserPage(
        browser.headlessMode(),
        browser.getDefaultMaximize(),
        browser.getDefaultIgnoreHttpsErrors()
      )
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
          .describe("Include each element's bounding box as {x,y,w,h} in CSS pixels"),
        maxNodes: z
          .number()
          .int()
          .positive()
          .max(20_000)
          .optional()
          .describe(
            'Maximum number of visible elements to include (default 1500). Raise for very large pages; output grows accordingly.'
          )
      }
    },
    async ({ depth, boxes, maxNodes }) => {
      const page = await browser.getBrowserPage(
        browser.headlessMode(),
        browser.getDefaultMaximize(),
        browser.getDefaultIgnoreHttpsErrors()
      )
      const snapshot = await extractPageSnapshot(page, { depth, boxes, maxNodes })
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
      const page = await browser.getBrowserPage(
        browser.headlessMode(),
        browser.getDefaultMaximize(),
        browser.getDefaultIgnoreHttpsErrors()
      )
      if (ref) {
        const locator = page.locator(`[data-ptnotes-ref="${ref}"]`)
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
      const page = await browser.getBrowserPage(
        browser.headlessMode(),
        browser.getDefaultMaximize(),
        browser.getDefaultIgnoreHttpsErrors()
      )
      if (ref) {
        const locator = page.locator(`[data-ptnotes-ref="${ref}"]`)
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
      const page = await browser.getBrowserPage(
        browser.headlessMode(),
        browser.getDefaultMaximize(),
        browser.getDefaultIgnoreHttpsErrors()
      )
      if (ref) {
        const locator = page.locator(`[data-ptnotes-ref="${ref}"]`)
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
      const page = await browser.getBrowserPage(
        browser.headlessMode(),
        browser.getDefaultMaximize(),
        browser.getDefaultIgnoreHttpsErrors()
      )
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
      const page = await browser.getBrowserPage(
        browser.headlessMode(),
        browser.getDefaultMaximize(),
        browser.getDefaultIgnoreHttpsErrors()
      )
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
      const page = await browser.getBrowserPage(
        browser.headlessMode(),
        browser.getDefaultMaximize(),
        browser.getDefaultIgnoreHttpsErrors()
      )
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
      const page = await browser.getBrowserPage(
        browser.headlessMode(),
        browser.getDefaultMaximize(),
        browser.getDefaultIgnoreHttpsErrors()
      )
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
