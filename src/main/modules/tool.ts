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
        description: `Start a background module that autonomously produces a deliverable file for the user. Available modules:\n${modulesDesc}\n\nWrite a THOROUGH prompt (goal, audience, outline/spec, and references like note:<name> or file:<name>). The module runs in the background with progress tracking; do NOT wait for it to finish. If you need a result payload back, set \`expect\` to describe exactly what the module must submit via submit_result (JSON, markdown or plain text). Confirm it has started and summarize what it will do. To continue only once all the modules you started finish, call wait_modules with their runIds.`,
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Module id from the list above' },
            title: { type: 'string', description: 'Short human-readable title for this run' },
            prompt: {
              type: 'string',
              description: 'Full detailed instructions/spec for the module subagent'
            },
            expect: {
              type: 'string',
              description:
                'Optional: describe the result payload the module must submit back via submit_result before finishing (exact format, e.g. "Return a JSON object with keys {title, summary}").'
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
        String(args.prompt ?? ''),
        String(args.expect ?? '')
      )
      return JSON.stringify(res)
    }
  }
}

/** Build the `wait_modules` tool: block until every listed run is terminal, then return their results. */
export function buildWaitModulesTool(manager: ModuleRunManager): PTTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'wait_modules',
        description:
          "Wait for one or more module runs (started earlier with start_module) to finish, then return each run's status, result payload, output files, summary and error. Pass the runIds returned by start_module. Use this when you need the modules' output to continue; do not use it when you do not need the result.",
        parameters: {
          type: 'object',
          properties: {
            runIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'runIds of the module runs to wait for'
            },
            timeoutSeconds: {
              type: 'number',
              description: 'Max seconds to wait (default 600, clamped 30–3600)'
            }
          },
          required: ['runIds']
        }
      }
    },
    async execute(args, ctx) {
      const runIds = Array.isArray(args.runIds)
        ? args.runIds.map(String)
        : [String(args.runIds ?? '')]
      const timeoutSeconds = Math.min(
        Math.max(Math.floor(Number(args.timeoutSeconds)) || 600, 30),
        3600
      )
      const results = await manager.waitForRuns(
        ctx.activeProject,
        runIds,
        timeoutSeconds * 1000,
        ctx.isStopped
      )
      return JSON.stringify({ ok: true, results })
    }
  }
}
