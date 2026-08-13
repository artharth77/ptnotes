import type { SlashCommand, SlashCommandContext } from '@shared/slash'

/**
 * Built-in slash commands (client actions). Skills are merged in dynamically by
 * the chat UI via `buildSkillCommandList`. To add a command later, append an
 * entry here and it shows up in the `/` popup automatically.
 */
export const builtinSlashCommands: SlashCommand[] = [
  {
    name: 'new',
    description: 'Start a new chat',
    action: (ctx: SlashCommandContext) => {
      if (ctx.project) void ctx.newChat(ctx.project)
    }
  },
  {
    name: 'models',
    description: 'Open AI settings to choose a model',
    action: (ctx: SlashCommandContext) => {
      ctx.openAiSettings()
    }
  }
]

/** Built-in names so same-named skills are hidden (built-ins win). */
export const builtinSlashNames: string[] = builtinSlashCommands.map((c) => c.name)
