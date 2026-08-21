import Module from 'node:module'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const ROOT = '/tmp/ptnotes-config-test-root'

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return { app: { getPath: () => ROOT, getAppPath: () => ROOT } }
  }
  return origLoad.call(this, request, parent, isMain)
}

await fs.rm(ROOT, { recursive: true, force: true })
await fs.mkdir(ROOT, { recursive: true })

const { AIConfigStore } = await import('../src/main/ai/config')
const filePath = join(ROOT, 'ai-provider.json')

// No file → default config (Profile 1 active, global PDF on)
let store = new AIConfigStore()
const cfg = await store.getAll()
assert.equal(cfg.profiles.length, 1)
assert.equal(cfg.profiles[0].id, 'profile-1')
assert.equal(cfg.activeProfileId, 'profile-1')
assert.equal(cfg.uploadPdfEnabled, true)

// Legacy flat config → migrates to Profile 1 active, global PDF hoisted, file rewritten.
const legacy = {
  baseUrl: 'https://legacy.example/v1',
  apiKey: 'legacy-key',
  model: 'legacy-model',
  uploadPdfEnabled: false
}
await fs.writeFile(filePath, JSON.stringify(legacy), 'utf8')
store = new AIConfigStore()
const active = await store.load()
assert.equal(active.baseUrl, 'https://legacy.example/v1')
assert.equal(active.apiKey, 'legacy-key')
assert.equal(active.model, 'legacy-model')
assert.equal(active.uploadPdfEnabled, false)
const migrated = await store.getAll()
assert.equal(migrated.profiles.length, 1)
assert.equal(migrated.profiles[0].id, 'profile-1')
assert.equal(migrated.profiles[0].name, 'Profile 1')
assert.equal(migrated.profiles[0].baseUrl, 'https://legacy.example/v1')
assert.equal(migrated.activeProfileId, 'profile-1')
assert.equal(migrated.uploadPdfEnabled, false)
const diskRaw = JSON.parse(await fs.readFile(filePath, 'utf8'))
assert.ok(Array.isArray(diskRaw.profiles), 'file rewritten to profile shape')
assert.equal(diskRaw.version, 1)

// getAll / saveAll round-trip with multiple profiles; active resolution.
store = new AIConfigStore()
await store.saveAll({
  profiles: [
    { id: 'profile-1', name: 'Profile 1', baseUrl: 'https://a/v1', apiKey: 'k1', model: 'm1' },
    {
      id: 'ollama',
      name: 'Local',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'llama'
    }
  ],
  activeProfileId: 'ollama',
  uploadPdfEnabled: true
})
let full = await store.getAll()
assert.equal(full.profiles.length, 2)
assert.equal(full.activeProfileId, 'ollama')
assert.equal(full.uploadPdfEnabled, true)
let load = await store.load()
assert.equal(load.baseUrl, 'http://localhost:11434/v1')
assert.equal(load.model, 'llama')
assert.equal(load.apiKey, '')

// Switching active profile changes the returned active config.
await store.saveAll({ ...full, activeProfileId: 'profile-1' })
load = await store.load()
assert.equal(load.baseUrl, 'https://a/v1')
assert.equal(load.model, 'm1')
assert.equal(load.uploadPdfEnabled, true)

// saveAll with an invalid activeProfileId falls back to the first profile.
full = await store.getAll()
await store.saveAll({ ...full, activeProfileId: 'nope' })
load = await store.load()
assert.equal(load.baseUrl, 'https://a/v1')
const afterFallback = await store.getAll()
assert.equal(afterFallback.activeProfileId, 'profile-1')

// File mode is 0600 when the store creates the file.
await fs.rm(filePath, { force: true })
store = new AIConfigStore()
await store.saveAll({
  profiles: [
    { id: 'profile-1', name: 'Profile 1', baseUrl: 'https://a/v1', apiKey: 'k1', model: 'm1' }
  ],
  activeProfileId: 'profile-1',
  uploadPdfEnabled: true
})
const mode = (await fs.stat(filePath)).mode & 0o777
assert.equal(mode, 0o600)

console.log('AI CONFIG STORE TESTS PASSED')
