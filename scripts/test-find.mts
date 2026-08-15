import assert from 'node:assert/strict'
import { findMatchesInTextRuns } from '../src/shared/find'

// ---- empty query / no matches ----

assert.deepEqual(
  findMatchesInTextRuns([{ text: 'hello world', pos: 0 }], '', false),
  [],
  'empty query returns no results'
)
assert.deepEqual(
  findMatchesInTextRuns([{ text: 'hello world', pos: 0 }], 'xyz', false),
  [],
  'no match returns empty results'
)

// ---- case sensitivity ----

assert.equal(
  findMatchesInTextRuns([{ text: 'Hello hello HELLO', pos: 0 }], 'hello', false).length,
  3,
  'case-insensitive by default'
)
assert.equal(
  findMatchesInTextRuns([{ text: 'Hello hello HELLO', pos: 0 }], 'hello', true).length,
  1,
  'matchCase restricts to exact case'
)

// ---- whitespace-only matches are skipped ----

assert.deepEqual(
  findMatchesInTextRuns([{ text: 'a  b', pos: 0 }], ' ', false),
  [],
  'whitespace-only matches are skipped'
)

// ---- positions across runs ----

assert.deepEqual(
  findMatchesInTextRuns(
    [
      { text: 'foo bar ', pos: 0 },
      { text: 'foo', pos: 8 }
    ],
    'foo',
    false
  ),
  [
    { from: 0, to: 3 },
    { from: 8, to: 11 }
  ],
  'returns correct from/to across multiple text runs'
)

// ---- regex special chars are treated literally ----

assert.equal(
  findMatchesInTextRuns([{ text: 'a.b aXb a.b', pos: 0 }], 'a.b', false).length,
  2,
  'query is escaped so a.b matches literally, not as regex wildcard'
)
assert.equal(
  findMatchesInTextRuns([{ text: '(test) [test]', pos: 0 }], '(test)', false).length,
  1,
  'parentheses are matched literally'
)

// ---- overlapping / consecutive matches within a run ----

assert.deepEqual(
  findMatchesInTextRuns([{ text: 'aaaa', pos: 0 }], 'aa', false),
  [
    { from: 0, to: 2 },
    { from: 2, to: 4 }
  ],
  'non-overlapping consecutive matches are found'
)
assert.deepEqual(
  findMatchesInTextRuns([{ text: 'ababab', pos: 5 }], 'ab', false),
  [
    { from: 5, to: 7 },
    { from: 7, to: 9 },
    { from: 9, to: 11 }
  ],
  'matches with a nonzero base position map to absolute positions'
)

console.log('find tests passed')
