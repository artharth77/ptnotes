/**
 * Local Material Design Icons (MDI) catalog for the infographic module.
 *
 * `@mdi/js` ships every icon as a named export holding its SVG path data
 * (`export var mdiCog = "M12,15.5A3.5,..."`). Icons are referenced in
 * infographic designs as `mdi/<name>` (kebab-case, e.g. `mdi/cog`) and are
 * resolved here — offline, from the bundled catalog — so the renderer never
 * queries the package's remote icon service. The 7,447-icon catalog is loaded
 * lazily (a ~2.8MB module) only on first use.
 */

export const DEFAULT_MDI_ICON = 'star'

/** Synonyms for common item labels that do not match an MDI name verbatim. */
const MDI_ALIASES: Record<string, string> = {
  settings: 'cog',
  gear: 'cog',
  configuration: 'cog',
  preferences: 'cog',
  options: 'cog-outline',
  user: 'account',
  person: 'account',
  profile: 'account',
  people: 'account-group',
  team: 'account-group',
  members: 'account-multiple',
  users: 'account-group',
  mail: 'email',
  inbox: 'email-outline',
  photo: 'image',
  picture: 'image',
  photos: 'image-multiple',
  gallery: 'image-multiple',
  bulb: 'lightbulb',
  idea: 'lightbulb-outline',
  innovation: 'lightbulb-outline',
  search: 'magnify',
  magnifier: 'magnify',
  doc: 'file-document',
  document: 'file-document',
  paperwork: 'file-document',
  storage: 'database',
  copy: 'content-copy',
  duplicate: 'content-copy',
  chain: 'link',
  unlock: 'lock-open',
  open: 'lock-open-variant',
  goal: 'target',
  aim: 'target',
  globe: 'earth',
  world: 'earth',
  internet: 'web',
  browser: 'web',
  office: 'office-building',
  building: 'office-building',
  company: 'office-building',
  organization: 'office-building',
  money: 'cash',
  payment: 'cash-multiple',
  shopping: 'cart',
  'shopping cart': 'cart',
  'shopping-cart': 'cart',
  bag: 'shopping',
  download: 'download',
  upload: 'upload',
  done: 'check',
  complete: 'check',
  completed: 'check',
  finished: 'check',
  success: 'check-circle',
  successfull: 'check-circle',
  error: 'alert-circle',
  warning: 'alert',
  exit: 'exit-to-app',
  logout: 'logout',
  remove: 'close',
  delete: 'trash-can',
  trash: 'trash-can',
  write: 'pen',
  pencil: 'pencil',
  drawing: 'draw',
  design: 'palette',
  color: 'palette',
  paint: 'palette',
  research: 'magnify',
  analysis: 'chart-line',
  analyze: 'chart-line',
  grow: 'trending-up',
  growth: 'trending-up',
  increase: 'trending-up',
  decrease: 'trending-down',
  time: 'clock',
  timing: 'clock',
  deadline: 'alarm',
  reminder: 'alarm',
  notification: 'bell',
  notify: 'bell',
  guard: 'shield-check',
  security: 'shield-check',
  protect: 'shield-check',
  safe: 'shield-check',
  phone: 'phone',
  mobile: 'cellphone',
  call: 'phone',
  sms: 'message-text',
  'text message': 'message-text',
  chat: 'message',
  talk: 'message',
  discussion: 'message-text',
  meeting: 'calendar-check',
  schedule: 'calendar',
  event: 'calendar',
  date: 'calendar',
  birthday: 'cake',
  award: 'trophy',
  prize: 'trophy',
  winner: 'trophy',
  job: 'briefcase',
  work: 'briefcase',
  employment: 'briefcase',
  location: 'map-marker',
  place: 'map-marker',
  address: 'map-marker',
  pin: 'map-marker',
  task: 'clipboard-check',
  checklist: 'clipboard-check',
  todo: 'clipboard-check',
  tasks: 'clipboard-check',
  fix: 'wrench',
  repair: 'wrench',
  maintain: 'wrench',
  maintenance: 'wrench',
  build: 'hammer',
  construction: 'hammer',
  tool: 'tools',
  fixit: 'tools',
  heart: 'heart',
  love: 'heart',
  like: 'thumb-up',
  dislike: 'thumb-down',
  star: 'star',
  favorite: 'star',
  key: 'key',
  password: 'key',
  secret: 'key',
  data: 'database',
  dataset: 'database',
  db: 'database',
  cpu: 'cpu',
  processor: 'cpu',
  memory: 'memory',
  chip: 'chip',
  hardware: 'chip',
  software: 'code-tags',
  code: 'code-tags',
  program: 'code-tags',
  programming: 'code-tags',
  wifi: 'wifi',
  wireless: 'wifi',
  network: 'network',
  networking: 'network',
  cloud: 'cloud',
  home: 'home',
  house: 'home',
  bank: 'bank',
  finance: 'bank',
  moneybag: 'cash',
  wallet: 'wallet',
  card: 'credit-card',
  'payment card': 'credit-card',
  report: 'chart-bar',
  stats: 'chart-bar',
  statistics: 'chart-bar',
  metric: 'chart-bar',
  metrics: 'chart-bar',
  book: 'book',
  reading: 'book-open',
  note: 'note',
  notes: 'note-text',
  file: 'file',
  files: 'file',
  folder: 'folder',
  directory: 'folder',
  link: 'link',
  url: 'link',
  website: 'link-variant',
  image: 'image',
  camera: 'camera',
  'picture video': 'video',
  video: 'video',
  movie: 'film',
  film: 'film',
  play: 'play',
  pause: 'pause',
  send: 'send',
  submit: 'send',
  refresh: 'refresh',
  reload: 'refresh',
  sync: 'sync',
  syncronize: 'sync',
  save: 'content-save',
  floppy: 'content-save',
  tag: 'tag',
  label: 'tag',
  flag: 'flag',
  puzzle: 'puzzle',
  calendar: 'calendar',
  clock: 'clock',
  history: 'history',
  percent: 'percent',
  help: 'help-circle',
  info: 'info',
  information: 'info',
  question: 'help-circle',
  support: 'lifebuoy',
  cancel: 'close-circle',
  handshake: 'handshake',
  deal: 'handshake',
  agreement: 'handshake',
  partnership: 'handshake'
}

/** Convert an `@mdi/js` export key (e.g. `mdiAccountAlertOutline`) to its kebab name. */
function exportKeyToName(key: string): string {
  return key
    .replace(/^mdi/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

let mdiModule: Record<string, string> | null = null

/** Lazily import the `@mdi/js` catalog (only the path-data string exports). */
async function loadMdi(): Promise<Record<string, string>> {
  if (!mdiModule) {
    const mod = (await import('@mdi/js')) as Record<string, unknown>
    const strings: Record<string, string> = {}
    for (const key of Object.keys(mod)) {
      if (!/^mdi[A-Z]/.test(key)) continue
      const value = mod[key]
      if (typeof value === 'string') strings[key] = value
    }
    mdiModule = strings
  }
  return mdiModule
}

let nameIndex: Map<string, string> | null = null

/** Cached kebab-case name → `@mdi/js` export key map. */
async function getNameIndex(): Promise<Map<string, string>> {
  if (nameIndex) return nameIndex
  const mod = await loadMdi()
  const index = new Map<string, string>()
  for (const key of Object.keys(mod)) index.set(exportKeyToName(key), key)
  nameIndex = index
  return index
}

/** Known decorative/qualifier suffixes, used to prefer base icon names. */
const QUALIFIER_SUFFIXES = new Set([
  'outline',
  'circle',
  'circle-outline',
  'box',
  'box-outline',
  'multiple',
  'various',
  'variant',
  'off',
  'remove',
  'plus',
  'minus',
  'check',
  'alert',
  'edit',
  'search',
  'refresh',
  'sync',
  'badge',
  'badge-outline'
])

function isBaseName(tokens: string[]): boolean {
  return tokens.length === 1 || !QUALIFIER_SUFFIXES.has(tokens[tokens.length - 1])
}

/** Resolve the SVG path data for an MDI icon name, or undefined if unknown. */
export async function mdiIconPath(name: string): Promise<string | undefined> {
  const trimmed = name.trim().toLowerCase()
  if (!trimmed) return undefined
  const index = await getNameIndex()
  const key = index.get(trimmed)
  if (!key) return undefined
  const mod = await loadMdi()
  return mod[key]
}

/**
 * Find the MDI icon name that best matches a free-text query (an item label,
 * description or a bare icon name). Exact matches and aliases win; otherwise
 * keyword tokens are scored against the icon name tokens, preferring base
 * names over qualified variants. Returns the kebab name or null.
 */
export async function findMdiIcon(query: string): Promise<string | null> {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const index = await getNameIndex()

  if (index.has(q)) return q

  const alias = MDI_ALIASES[q]
  if (alias && index.has(alias)) return alias

  const tokens = q.split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.length === 0) return null

  let best: { name: string; score: number; base: boolean; len: number } | null = null
  for (const name of index.keys()) {
    const nameTokens = name.split('-')
    let score = 0
    for (const token of tokens) {
      if (nameTokens.some((t) => t === token)) score += 20
      else if (nameTokens.some((t) => t.startsWith(token))) score += 10
      else if (nameTokens.some((t) => t.includes(token))) score += 6
      else if (token.includes('-') && token.split('-').some((p) => p === token)) {
        /* compound query token fully present as a name token handled above */
      }
    }
    if (score === 0) continue
    const base = isBaseName(nameTokens)
    const cand = { name, score, base, len: name.length }
    if (!best || cand.score > best.score) {
      best = cand
    } else if (cand.score === best.score) {
      if (cand.base && !best.base) best = cand
      else if (cand.base === best.base && cand.len < best.len) best = cand
    }
  }
  return best ? best.name : null
}

/** Resolve an icon reference (`mdi/<name>` or a bare name) to its MDI path data. */
async function resolvePath(value: string): Promise<string | undefined> {
  const raw = value.trim()
  if (!raw) return undefined
  const name = raw.startsWith('mdi/') ? raw.slice(4).trim() : raw
  const direct = await mdiIconPath(name)
  if (direct) return direct
  const matched = await findMdiIcon(name)
  return matched ? mdiIconPath(matched) : undefined
}

/**
 * Resolve an icon reference to a `<symbol>` string ready for the package's
 * `loadSVGResource`. Always returns a valid symbol (falling back to the
 * default icon) so the infographic resource loader can never return null and
 * trigger a remote icon lookup.
 */
export async function resolveMdiIconSymbol(value: string): Promise<string> {
  let path = await resolvePath(value)
  if (!path) path = (await mdiIconPath(DEFAULT_MDI_ICON)) ?? ''
  return `<symbol viewBox="0 0 24 24"><path d="${path}"/></symbol>`
}
