import assert from 'node:assert/strict'
import { encodeFileToken, fileTokenHasBareSpace, parseFileToken } from '../src/shared/fileMention'

// ---- parseFileToken ----

assert.deepEqual(parseFileToken(''), { dir: '', filter: '' }, 'empty token')
assert.deepEqual(parseFileToken('re'), { dir: '', filter: 're' }, 'top-level filter')
assert.deepEqual(parseFileToken('docs/re'), { dir: 'docs', filter: 're' }, 'dir + filter')
assert.deepEqual(parseFileToken('docs/'), { dir: 'docs', filter: '' }, 'trailing slash lists a dir')
assert.deepEqual(
  parseFileToken('docs/sub/deep'),
  { dir: 'docs/sub', filter: 'deep' },
  'nested dir prefix'
)
assert.deepEqual(
  parseFileToken('"my folder"/'),
  { dir: 'my folder', filter: '' },
  'quoted segment with space'
)
assert.deepEqual(
  parseFileToken('"my folder"/re'),
  { dir: 'my folder', filter: 're' },
  'quoted dir + filter'
)
assert.deepEqual(
  parseFileToken('docs/"my folder"/re'),
  { dir: 'docs/my folder', filter: 're' },
  'mixed unquoted/quoted segments'
)
assert.deepEqual(
  parseFileToken('docs/"a b"/"c d"/x'),
  { dir: 'docs/a b/c d', filter: 'x' },
  'multiple quoted segments'
)
assert.deepEqual(
  parseFileToken('"my fo'),
  { dir: '', filter: 'my fo' },
  'unclosed quote still collects the filter while typing'
)

// ---- fileTokenHasBareSpace ----

assert.equal(fileTokenHasBareSpace('docs/re'), false, 'plain token has no bare space')
assert.equal(fileTokenHasBareSpace('docs/rep ort'), true, 'bare space ends the mention')
assert.equal(fileTokenHasBareSpace('"my folder"/'), false, 'space inside quotes is allowed')
assert.equal(
  fileTokenHasBareSpace('"my folder"/ and prose'),
  true,
  'space outside quotes after a quoted segment ends the mention'
)
assert.equal(fileTokenHasBareSpace('"un closed'), false, 'space inside an open quote is allowed')
assert.equal(fileTokenHasBareSpace('"a"/"b c"/'), false, 'multiple quoted segments')
assert.equal(fileTokenHasBareSpace(''), false, 'empty token')

// ---- encodeFileToken ----

assert.equal(encodeFileToken('docs'), 'docs', 'plain path stays unquoted')
assert.equal(encodeFileToken('my folder'), '"my folder"', 'segment with space is quoted')
assert.equal(
  encodeFileToken('docs/my folder'),
  'docs/"my folder"',
  'only the spaced segment is quoted'
)
assert.equal(encodeFileToken('a b/c d'), '"a b"/"c d"', 'all spaced segments quoted')

// ---- round trip: encode → drill token → parse ----

const drill = `#${encodeFileToken('docs/my folder')}/`
assert.equal(drill, '#docs/"my folder"/', 'drill-in token quotes the spaced segment')
assert.deepEqual(
  parseFileToken(drill.slice(1)),
  { dir: 'docs/my folder', filter: '' },
  'drill-in token parses back to the real dir'
)

console.log('file mention tests passed')
