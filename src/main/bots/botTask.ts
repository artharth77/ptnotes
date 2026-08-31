import type { ModuleRunManager } from '../modules/runs'
import type { ModuleRegistry } from '../modules/registry'
import { buildStartModuleTool, buildWaitModulesTool } from '../modules/tool'
import type { RegisteredModule } from '../modules/types'

const BOT_TASK_SYSTEM_PROMPT = `You are executing a single background task that was assigned to you inside a group chat. The group chat itself has no tools — you are the execution arm: everything that needs reading, writing files, notes, kanban cards or schedules happens here.

Guidelines:
- Focus on exactly the assigned task. Do not start unrelated work.
- Resolve inline source references yourself (note:<notename> / file:<filename> / plan:<schedule id>).
- Persist anything durable: write results into notes, kanban cards, schedules or output files via your tools rather than keeping them only in the final message.
- If a module is the right way to produce a deliverable (presentation, spreadsheet, diagram, long research), start it with start_module and collect it with wait_modules.
- When you are finished, submit_result with a concise report: what you did, the outcome, and the paths of anything you created.`

/**
 * The hidden internal module that powers bot background tasks. Reuses the whole
 * ModuleRunner pipeline (plan/steps/trace/transcript) but is excluded from the
 * Modules UI and from `start_module` listings; only the group-chat orchestrator
 * starts it, with `botId`/`groupId` recorded on the run.
 */
export function createBotTaskModule(
  manager: ModuleRunManager,
  registry: ModuleRegistry,
  disabledModules: string[]
): RegisteredModule {
  return {
    id: 'bot-task',
    name: 'Bot Task',
    summary: 'Background task run by a group-chat bot.',
    description: 'Internal: background task execution for bot group chats.',
    systemPrompt: BOT_TASK_SYSTEM_PROMPT,
    hidden: true,
    tools: [
      buildStartModuleTool(manager, registry, disabledModules),
      buildWaitModulesTool(manager)
    ],
    maxIterations: 60
  }
}
