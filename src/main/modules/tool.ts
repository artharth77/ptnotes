import type { PTTool } from '../ai/tools'
import type { ModuleRunManager } from './runs'
import type { ModuleRegistry } from './registry'

/** Build the single `start_module` tool exposed to the main chat agent. */
export function buildStartModuleTool(
  manager: ModuleRunManager,
  registry: ModuleRegistry,
  disabled: string[] = []
): PTTool {
  const disabledSet = new Set(disabled)
  const available = registry.list().filter((m) => !disabledSet.has(m.id))
  const modulesDesc =
    available.length > 0
      ? available.map((m) => `- ${m.id}: ${m.description}`).join('\n')
      : '(no modules registered)'

  return {
    definition: {
      type: 'function',
      function: {
        name: 'start_module',
        description: `Start a background module that autonomously produces a deliverable file for the user. Available modules:\n${modulesDesc}\n\nWrite a THOROUGH prompt (goal, audience, outline/spec, and references like note:<name> or file:<name>). The module runs in the background with progress tracking; do NOT wait for it to finish. Confirm it has started and summarize what it will do.`,
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Module id from the list above' },
            title: { type: 'string', description: 'Short human-readable title for this run' },
            prompt: {
              type: 'string',
              description: 'Full detailed instructions/spec for the module subagent'
            }
          },
          required: ['id', 'title', 'prompt']
        }
      }
    },
    async execute(args, ctx) {
      const res = await manager.start(
        ctx.activeProject,
        String(args.id ?? ''),
        String(args.title ?? ''),
        String(args.prompt ?? '')
      )
      return JSON.stringify(res)
    }
  }
}
