/**
 * CLI argument parsing tests — pure shared logic, no Electron dependencies.
 * Run: tsx --tsconfig tsconfig.node.json scripts/test-cli-args.mts
 */
import assert from 'node:assert/strict'
import { cliUsage, parseCliArgs, DEFAULT_WEB_HOST, DEFAULT_WEB_PORT } from '../src/shared/cliArgs'

// Desktop launches are unchanged, with or without Electron's own flags.
assert.deepEqual(parseCliArgs(['electron', '.']), { mode: 'desktop' })
assert.deepEqual(parseCliArgs(['ptnotes']), { mode: 'desktop' })
assert.deepEqual(parseCliArgs(['electron', '.', '--no-sandbox', '--enable-logging']), {
  mode: 'desktop'
})
assert.deepEqual(parseCliArgs(['ptnotes', '--data-path', '/tmp/pstate']), {
  mode: 'desktop',
  dataPath: '/tmp/pstate'
})
assert.deepEqual(parseCliArgs(['ptnotes', '--help']), { mode: 'desktop' })

// `web` subcommand with defaults.
assert.deepEqual(parseCliArgs(['ptnotes', 'web']), {
  mode: 'web',
  host: DEFAULT_WEB_HOST,
  port: DEFAULT_WEB_PORT,
  noAuth: false
})
assert.deepEqual(parseCliArgs(['electron', '.', 'web']), {
  mode: 'web',
  host: DEFAULT_WEB_HOST,
  port: DEFAULT_WEB_PORT,
  noAuth: false
})

// Everything at once.
assert.deepEqual(
  parseCliArgs([
    'electron',
    '.',
    '--no-sandbox',
    'web',
    '--host',
    '0.0.0.0',
    '--port',
    '8080',
    '--data-path',
    '/state',
    '--doc-path',
    '/docs',
    '--token',
    'abc123'
  ]),
  {
    mode: 'web',
    host: '0.0.0.0',
    port: 8080,
    dataPath: '/state',
    docPath: '/docs',
    token: 'abc123',
    noAuth: false
  }
)

// `--flag=value` form + escape hatch.
assert.deepEqual(parseCliArgs(['ptnotes', 'web', '--port=9999', '--no-auth']), {
  mode: 'web',
  host: DEFAULT_WEB_HOST,
  port: 9999,
  noAuth: true
})

// A flag *value* called "web" is not the subcommand.
assert.equal(parseCliArgs(['ptnotes', '--data-path', 'web']).mode, 'desktop')

// Rejections.
assert.throws(() => parseCliArgs(['ptnotes', 'web', '--port', 'abc']), /Invalid --port/)
assert.throws(() => parseCliArgs(['ptnotes', 'web', '--port']), /Invalid --port/)
assert.throws(() => parseCliArgs(['ptnotes', 'web', '--port', '70000']), /Invalid --port/)
assert.throws(() => parseCliArgs(['ptnotes', 'web', '--host']), /--host requires a value/)

const usage = cliUsage()
assert.match(usage, /ptnotes web/)
assert.match(usage, /--data-path/)
assert.match(usage, /--doc-path/)
assert.match(usage, /--no-auth/)

console.log('cli-args tests passed')
