import type { SkillList, SkillScope } from './types'

/** Max rows shown in the slash command popup. */
export const MAX_COMMAND_ROWS = 10

export interface SlashCommandContext {
  project: string | null
  newChat: (project: string) => Promise<void>
  openAiSettings: () => void
}

/**
 * A slash command. Commands are either built-in client actions (`action` set) or
 * skill commands (`scope` set, no action) that submit a prompt referencing the
 * skill so the AI loads it via `read_skill`. Extensible: add new entries to the
 * built-in registry in the renderer to grow the list.
 */
export interface SlashCommand {
  name: string
  description: string
  /** Present on skill commands; used to build the skill reference message. */
  scope?: SkillScope
  /** Client-side action. When set, running the command does not send a message. */
  action?: (ctx: SlashCommandContext) => void | Promise<void>
}

/**
 * In-progress slash token when `value` starts with '/' and the token contains no
 * space yet (so the user is still typing the command name). Returns `null`
 * otherwise (no command context).
 */
export function extractSlashToken(value: string): string | null {
  if (!value.startsWith('/')) return null
  const token = value.slice(1)
  if (token.includes(' ')) return null
  return token
}

/** Case-insensitive match of the query against command names and descriptions. */
export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase()
  return commands.filter(
    (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
  )
}

/**
 * Build the message sent to the AI when a skill command runs. References the skill
 * by name (scope in parentheses) so the model calls `read_skill` first, then uses
 * the remaining text as the prompt.
 */
export function buildSkillMessage(name: string, scope: SkillScope, args: string): string {
  const prompt = args.trim()
  return prompt
    ? `Use the skill "${name}" (scope: ${scope}): ${prompt}`
    : `Use the skill "${name}" (scope: ${scope}).`
}

/**
 * Merge enabled global + project skills into command shapes (no action → AI mode).
 * Dedupes by name (project scope wins over global) and skips names in `exclude`
 * (used to let built-in commands win over same-named skills).
 */
export function buildSkillCommandList(
  skills: SkillList | null,
  exclude: string[] = []
): SlashCommand[] {
  if (!skills) return []
  const excluded = new Set(exclude)
  const byName = new Map<string, SlashCommand>()
  for (const s of skills.global) {
    if (!s.enabled || excluded.has(s.name)) continue
    if (!byName.has(s.name)) {
      byName.set(s.name, { name: s.name, description: s.description || '(skill)', scope: 'global' })
    }
  }
  for (const s of skills.project) {
    if (!s.enabled || excluded.has(s.name)) continue
    byName.set(s.name, {
      name: s.name,
      description: s.description || '(skill)',
      scope: 'project'
    })
  }
  return [...byName.values()]
}
