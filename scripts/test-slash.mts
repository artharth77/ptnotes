import assert from 'node:assert/strict'
import type { SkillList } from '../src/shared/types'
import {
  MAX_COMMAND_ROWS,
  buildSkillCommandList,
  buildSkillMessage,
  extractSlashToken,
  filterSlashCommands
} from '../src/shared/slash'
import type { SlashCommand } from '../src/shared/slash'

// ---- extractSlashToken ----

assert.equal(extractSlashToken(''), null, 'empty input has no token')
assert.equal(extractSlashToken('hello'), null, 'non-slash input has no token')
assert.equal(extractSlashToken('hello /new'), null, 'slash not at start has no token')
assert.equal(extractSlashToken('/'), '', 'lone slash is an empty token')
assert.equal(extractSlashToken('/new'), 'new', 'simple command token')
assert.equal(extractSlashToken('/New '), null, 'trailing space closes the token')
assert.equal(extractSlashToken('/my skill'), null, 'space inside token closes it')
assert.equal(extractSlashToken('/note:meeting @x'), null, 'any space closes the token')

// ---- filterSlashCommands ----

const sampleCommands: SlashCommand[] = [
  { name: 'new', description: 'Start a new chat' },
  { name: 'models', description: 'Open AI settings to choose a model' },
  { name: 'summarize', description: 'Summarize the active note', scope: 'project' }
]

assert.deepEqual(
  filterSlashCommands(sampleCommands, '').map((c) => c.name),
  ['new', 'models', 'summarize'],
  'empty query keeps all commands'
)
assert.deepEqual(
  filterSlashCommands(sampleCommands, 'mo').map((c) => c.name),
  ['models'],
  'prefix match on name'
)
assert.deepEqual(
  filterSlashCommands(sampleCommands, 'NEW').map((c) => c.name),
  ['new'],
  'case-insensitive name match'
)
assert.deepEqual(
  filterSlashCommands(sampleCommands, 'settings').map((c) => c.name),
  ['models'],
  'match on description'
)
assert.deepEqual(filterSlashCommands(sampleCommands, 'zzz'), [], 'no match yields empty list')

// ---- buildSkillMessage ----

assert.equal(
  buildSkillMessage('meeting', 'global', 'summarize this note'),
  'Use the skill "meeting" (scope: global): summarize this note',
  'message embeds name, scope and prompt'
)
assert.equal(
  buildSkillMessage('meeting', 'project', '  '),
  'Use the skill "meeting" (scope: project).',
  'empty args produce a bare skill reference'
)
assert.equal(
  buildSkillMessage('meeting', 'project', '  do it  '),
  'Use the skill "meeting" (scope: project): do it',
  'args are trimmed'
)

// ---- buildSkillCommandList ----

const skills: SkillList = {
  global: [
    { scope: 'global', name: 'writing', description: 'Writing style guide', enabled: true },
    { scope: 'global', name: 'disabled-skill', description: 'Off', enabled: false },
    { scope: 'global', name: 'shared', description: 'Global copy', enabled: true }
  ],
  project: [
    { scope: 'project', name: 'research', description: 'Research workflow', enabled: true },
    { scope: 'project', name: 'shared', description: 'Project copy', enabled: true },
    { scope: 'project', name: 'new', description: 'A skill that collides with /new', enabled: true }
  ],
  builtin: []
}

assert.deepEqual(buildSkillCommandList(null), [], 'null skill list yields no commands')

const merged = buildSkillCommandList(skills)
const mergedNames = merged.map((c) => c.name)
assert.deepEqual(
  mergedNames,
  ['writing', 'shared', 'research', 'new'],
  'disabled skills excluded, duplicates deduped (built-in collisions kept until excluded)'
)
assert.equal(
  merged.find((c) => c.name === 'shared')?.scope,
  'project',
  'project scope wins over global on name collision'
)

const excluded = buildSkillCommandList(skills, ['new', 'research'])
assert.deepEqual(
  excluded.map((c) => c.name),
  ['writing', 'shared'],
  'excluded names (built-in collisions) are skipped'
)
assert.equal(excluded[0]?.action, undefined, 'skill commands have no action (AI mode)')

// ---- MAX_COMMAND_ROWS ----
assert.equal(MAX_COMMAND_ROWS, 10, 'popup caps at 10 rows')

console.log('slash tests passed')
