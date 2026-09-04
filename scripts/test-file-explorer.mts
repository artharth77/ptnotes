import Module from 'node:module'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const ROOT = '/tmp/ptnotes-test-explorer-root'

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

const { PTNotesService } = await import('../src/main/service/PTNotesService')

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

await fs.rm(ROOT, { recursive: true, force: true })
const service = new PTNotesService(ROOT)
const proj = await service.createProject('Work')
const filesRoot = join(ROOT, 'Work', 'files')

// ---- Empty root ----

assert.deepEqual(await service.listExplorerEntries(proj.name), [], 'empty root lists nothing')
const emptyTree = await service.listExplorerTree(proj.name)
assert.equal(emptyTree.name, 'files')
assert.deepEqual(emptyTree.children, [], 'empty tree')
assert.equal(emptyTree.path, '')

// ---- createFilesFolder ----

assert.equal(await service.createFilesFolder(proj.name, '', 'docs'), 'docs')
assert.equal(await service.createFilesFolder(proj.name, '', 'docs'), 'docs (2)', 'auto-suffix')
assert.equal(await service.createFilesFolder(proj.name, 'docs', 'sub'), 'docs/sub')
assert.equal(
  await service.createFilesFolder(proj.name, 'docs (2)/sub', 'deep'),
  'docs (2)/sub/deep',
  'nested with space in path'
)

await assert.rejects(() => service.createFilesFolder(proj.name, '', 'a/b'), /path separators/)
await assert.rejects(() => service.createFilesFolder(proj.name, '', '..'), /Invalid name/)
await assert.rejects(() => service.createFilesFolder(proj.name, '', '.'), /Invalid name/)
await assert.rejects(() => service.createFilesFolder(proj.name, '', '.hidden'), /dot/)
await assert.rejects(() => service.createFilesFolder(proj.name, '', '  '), /empty/)
await assert.rejects(() => service.createFilesFolder(proj.name, '..', 'x'), /Invalid folder path/)

// ---- listExplorerEntries ----

await fs.writeFile(join(filesRoot, 'docs', 'a.txt'), 'hello')
await fs.writeFile(join(filesRoot, 'docs', 'b.md'), 'hi there')
await fs.writeFile(join(filesRoot, 'docs', '.secret'), 'nope')

const docsEntries = await service.listExplorerEntries(proj.name, 'docs')
assert.deepEqual(
  docsEntries.map((e) => [e.name, e.isDir, e.size]),
  [
    ['sub', true, null],
    ['a.txt', false, 5],
    ['b.md', false, 8]
  ],
  'dirs first, dot-entries skipped, sizes'
)
assert.ok(docsEntries[0].mtime > 0, 'mtime present')
assert.equal(docsEntries[1].path, 'docs/a.txt', 'relative path with /')

const rootEntries = await service.listExplorerEntries(proj.name)
assert.deepEqual(
  rootEntries.map((e) => e.name),
  ['docs', 'docs (2)'],
  'root sorted dirs first'
)

assert.deepEqual(
  await service.listExplorerEntries(proj.name, '../escape'),
  [],
  'traversal rejected'
)
assert.deepEqual(await service.listExplorerEntries(proj.name, '/etc'), [], 'absolute rejected')

// ---- copyFilesEntries ----

await fs.mkdir(join(filesRoot, 'docs', 'sub', 'inner'), { recursive: true })
await fs.writeFile(join(filesRoot, 'docs', 'sub', 'inner', 'x.txt'), 'deep file')

await service.copyFilesEntries(proj.name, ['docs/a.txt'], 'docs/sub')
const copied = await fs.readFile(join(filesRoot, 'docs', 'sub', 'a.txt'), 'utf8')
assert.equal(copied, 'hello', 'file copied')

await service.copyFilesEntries(proj.name, ['docs'], 'docs (2)')
const copiedTree = await service.listExplorerEntries(proj.name, 'docs (2)/docs/sub/inner')
assert.equal(copiedTree.length, 1, 'folder copied recursively')

await service.copyFilesEntries(proj.name, ['docs/a.txt'], 'docs (2)')
assert.ok(await exists(join(filesRoot, 'docs (2)', 'a.txt')), 'file copied into folder root')
await service.copyFilesEntries(proj.name, ['docs/a.txt'], 'docs (2)')
assert.ok(await exists(join(filesRoot, 'docs (2)', 'a (2).txt')), 'conflict suffix')

await assert.rejects(
  () => service.copyFilesEntries(proj.name, ['docs'], 'docs/sub'),
  /into itself/,
  'copy folder into descendant'
)
await assert.rejects(
  () => service.copyFilesEntries(proj.name, ['../x'], ''),
  /Invalid path/,
  'traversal rejected on copy'
)
await assert.rejects(
  () => service.copyFilesEntries(proj.name, ['docs/a.txt'], '..'),
  /Invalid destination/,
  'bad destination rejected'
)

// ---- moveFilesEntries ----

await fs.writeFile(join(filesRoot, 'b-move.txt'), 'move me')
await service.moveFilesEntries(proj.name, ['b-move.txt'], 'docs (2)/docs')
assert.equal(
  await fs.readFile(join(filesRoot, 'docs (2)', 'docs', 'b-move.txt'), 'utf8'),
  'move me',
  'file moved'
)
assert.equal(await service.listFiles(proj.name).then((l) => l.includes('b-move.txt')), false)

// moving an item that already lives in the destination is a no-op
await service.moveFilesEntries(proj.name, ['docs (2)/docs/b-move.txt'], 'docs (2)/docs')
assert.ok(await exists(join(filesRoot, 'docs (2)', 'docs', 'b-move.txt')), 'same-dir move no-op')

await fs.mkdir(join(filesRoot, 'mv-src', 'child'), { recursive: true })
await fs.writeFile(join(filesRoot, 'mv-src', 'child', 'c.txt'), 'c')
await service.moveFilesEntries(proj.name, ['mv-src'], 'docs (2)')
assert.ok(
  await exists(join(filesRoot, 'docs (2)', 'mv-src', 'child', 'c.txt')),
  'folder moved recursively'
)
assert.equal(await exists(join(filesRoot, 'mv-src')), false, 'source removed')

await assert.rejects(
  () => service.moveFilesEntries(proj.name, ['docs'], 'docs/sub'),
  /into itself/,
  'move folder into descendant'
)
await assert.rejects(
  () => service.moveFilesEntries(proj.name, [''], ''),
  /Invalid path/,
  'root cannot be moved'
)

// ---- renameFilesEntry ----

const renamed = await service.renameFilesEntry(proj.name, 'docs/a.txt', 'renamed.txt')
assert.equal(renamed, 'docs/renamed.txt')
assert.equal(await exists(join(filesRoot, 'docs', 'a.txt')), false)
assert.equal(await fs.readFile(join(filesRoot, 'docs', 'renamed.txt'), 'utf8'), 'hello')

await assert.rejects(
  () => service.renameFilesEntry(proj.name, 'docs/renamed.txt', 'b.md'),
  /already exists/,
  'rename onto existing name'
)
await assert.rejects(
  () => service.renameFilesEntry(proj.name, 'docs/renamed.txt', 'x/y'),
  /path separators/,
  'rename with separator'
)
await assert.rejects(
  () => service.renameFilesEntry(proj.name, 'docs/renamed.txt', '.dot'),
  /dot/,
  'rename to dotfile'
)

// ---- deleteFilesEntries ----

await fs.writeFile(join(filesRoot, 'doomed.txt'), 'bye')
await service.deleteFilesEntries(proj.name, ['doomed.txt', 'docs (2)/docs'])
assert.equal(await exists(join(filesRoot, 'doomed.txt')), false)
assert.equal(await exists(join(filesRoot, 'docs (2)', 'docs')), false)
await assert.rejects(
  () => service.deleteFilesEntries(proj.name, ['..']),
  /Invalid path/,
  'cannot delete root or escape'
)

// ---- importDroppedFile ----

const dropsRoot = '/tmp/ptnotes-test-drops'
await fs.rm(dropsRoot, { recursive: true, force: true })
await fs.mkdir(dropsRoot, { recursive: true })
await fs.writeFile(join(dropsRoot, 'photo.png'), 'PNGDATA')
await fs.writeFile(join(dropsRoot, 'photo-copy.png'), 'OTHER')
await fs.mkdir(join(dropsRoot, 'folder-drop'), { recursive: true })
await fs.writeFile(join(dropsRoot, 'folder-drop', 'inner.txt'), 'inner')

const importedPath = await service.importDroppedFile(
  proj.name,
  join(dropsRoot, 'photo.png'),
  'docs',
  'photo.png'
)
assert.equal(importedPath, 'docs/photo.png')
assert.equal(
  await fs.readFile(join(filesRoot, 'docs', 'photo.png'), 'utf8'),
  'PNGDATA',
  'raw copy preserves content'
)

const importedSuffix = await service.importDroppedFile(
  proj.name,
  join(dropsRoot, 'photo-copy.png'),
  'docs',
  'photo.png'
)
assert.equal(importedSuffix, 'docs/photo (2).png', 'import conflict auto-suffix')

const importedRoot = await service.importDroppedFile(proj.name, join(dropsRoot, 'photo.png'), '')
assert.equal(importedRoot, 'photo.png', 'import into files root')

const importedFolder = await service.importDroppedFile(
  proj.name,
  join(dropsRoot, 'folder-drop'),
  ''
)
assert.equal(importedFolder, 'folder-drop', 'folder drop import')
assert.ok(
  await exists(join(filesRoot, 'folder-drop', 'inner.txt')),
  'folder drop copied recursively'
)

await assert.rejects(
  () => service.importDroppedFile(proj.name, join(dropsRoot, 'photo.png'), '..'),
  /Invalid destination/,
  'drop destination traversal rejected'
)
await assert.rejects(
  () => service.importDroppedFile(proj.name, '/tmp/does-not-exist-xyz', 'docs', 'a.txt'),
  /ENOENT/,
  'missing source rejected'
)

// ---- readFileText ----

await fs.writeFile(join(filesRoot, 'readme.md'), '# Hello\n\nSome **markdown**.')
await fs.writeFile(join(filesRoot, 'notes.txt'), 'plain text')
assert.equal(await service.readFileText(proj.name, 'readme.md'), '# Hello\n\nSome **markdown**.')
assert.equal(await service.readFileText(proj.name, 'notes.txt'), 'plain text')
assert.equal(
  await service.readFileText(proj.name, 'docs/photo.png'),
  'PNGDATA',
  'text read is content-agnostic (guard is by size, not extension)'
)
await assert.rejects(
  () => service.readFileText(proj.name, '../escape.md'),
  /not found|Invalid/i,
  'traversal rejected'
)
await assert.rejects(
  () => service.readFileText(proj.name, 'missing.md'),
  /File not found/,
  'missing file rejected'
)
const bigPath = join(filesRoot, 'big.log')
await fs.writeFile(bigPath, 'x'.repeat(2 * 1024 * 1024 + 1))
await assert.rejects(() => service.readFileText(proj.name, 'big.log'), /too large/, 'size cap')
await fs.rm(bigPath)

// ---- listExplorerTree ----

await fs.mkdir(join(filesRoot, 'zoo', 'pen'), { recursive: true })
await fs.mkdir(join(filesRoot, 'zoo', 'ark'), { recursive: true })
const tree = await service.listExplorerTree(proj.name)
assert.deepEqual(
  tree.children.map((c) => c.name),
  ['docs', 'docs (2)', 'folder-drop', 'zoo'],
  'tree sorted'
)
const zoo = tree.children.find((c) => c.name === 'zoo')
assert.deepEqual(
  zoo?.children.map((c) => [c.name, c.path]),
  [
    ['ark', 'zoo/ark'],
    ['pen', 'zoo/pen']
  ],
  'nested tree paths'
)
assert.equal(zoo?.children[0].children.length, 0, 'leaf nodes')

console.log('test-file-explorer: all assertions passed')
