export interface WebCliOptions {
  mode: 'web'
  host: string
  port: number
  dataPath?: string
  docPath?: string
  token?: string
  noAuth: boolean
}

export interface DesktopCliOptions {
  mode: 'desktop'
  dataPath?: string
  docPath?: string
}

export type CliOptions = DesktopCliOptions | WebCliOptions

export const DEFAULT_WEB_HOST = '127.0.0.1'
export const DEFAULT_WEB_PORT = 9380

/** Flags Electron itself injects — never user arguments. */
const ELECTRON_FLAGS = new Set([
  '--no-sandbox',
  '--disable-gpu',
  '--disable-gpu-sandbox',
  '--enable-logging',
  '--in-process-gpu',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-pipe'
])

/** Flags that consume the following token (so their value is never a subcommand). */
const VALUE_FLAGS = new Set([
  '--host',
  '--port',
  '--data-path',
  '--doc-path',
  '--token',
  '--js-flags',
  '--user-data-dir',
  '--lang',
  '--inspect',
  '--inspect-brk',
  '--remote-debugging-port'
])

export function cliUsage(): string {
  return [
    'Usage: ptnotes [web] [options]',
    '',
    'Options:',
    `  web                    Start the headless web UI server (default port ${DEFAULT_WEB_PORT})`,
    `  --host <addr>          Listen address for the web UI (default ${DEFAULT_WEB_HOST})`,
    `  --port <n>             Listen port for the web UI (default ${DEFAULT_WEB_PORT})`,
    '  --data-path <dir>      Directory for app config/state (settings, AI profiles, bots.db)',
    '  --doc-path <dir>       Project root folder (stored as Settings ▸ Storage)',
    '  --token <token>        Fixed access code instead of a generated one',
    '  --no-auth              Disable the access code (trusted networks only)',
    '  --help, -h             Show this help',
    '',
    'Examples:',
    '  ptnotes                                  Start the desktop app',
    '  ptnotes web                              Web UI on 127.0.0.1:9380',
    '  ptnotes web --host 0.0.0.0 --port 8080  Expose the web UI on the LAN',
    '  ptnotes web --doc-path ~/notes           Use ~/notes as the project root'
  ].join('\n')
}

/**
 * Parse `process.argv` for the app: no subcommand → desktop (unchanged),
 * `web` → headless web UI options. Tolerates Electron's own flags and the
 * injected app path, so it works for `ptnotes web …`, `electron . web …` and
 * `electron-vite dev -- web …` alike. Supports `--flag value` and `--flag=value`.
 */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  const tokens = argv.slice(1)

  const value = (flag: string): string | undefined => {
    const inline = tokens.find((t) => t.startsWith(`${flag}=`))
    if (inline) return inline.slice(flag.length + 1)
    const i = tokens.indexOf(flag)
    if (i === -1) return undefined
    const next = tokens[i + 1]
    if (next === undefined || next.startsWith('-')) return ''
    return next
  }
  const has = (flag: string): boolean =>
    tokens.includes(flag) || tokens.some((t) => t.startsWith(`${flag}=`))

  const dataPath = value('--data-path')
  const docPath = value('--doc-path')
  const common = {
    ...(dataPath ? { dataPath } : {}),
    ...(docPath ? { docPath } : {})
  }

  if (has('--help') || has('-h')) return { mode: 'desktop', ...common }

  // Tokens consumed as flag values are not positional subcommands.
  const consumed = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.includes('=') || !VALUE_FLAGS.has(token)) continue
    const next = tokens[i + 1]
    if (next !== undefined && !next.startsWith('-')) consumed.add(next)
  }
  const positional = tokens.filter(
    (t) => !t.startsWith('-') && !ELECTRON_FLAGS.has(t) && !consumed.has(t)
  )
  if (!positional.includes('web')) return { mode: 'desktop', ...common }

  const portRaw = value('--port')
  let port = DEFAULT_WEB_PORT
  if (portRaw !== undefined) {
    const parsed = Number(portRaw)
    if (portRaw === '' || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(`Invalid --port: "${portRaw}"`)
    }
    port = parsed
  }

  const host = value('--host')
  if (host === '') throw new Error('--host requires a value')
  const token = value('--token')
  if (token === '') throw new Error('--token requires a value')

  return {
    mode: 'web',
    host: host || DEFAULT_WEB_HOST,
    port,
    ...common,
    ...(token ? { token } : {}),
    noAuth: has('--no-auth')
  }
}
