import type { PTTool } from '../ai/tools'

/**
 * The contract every module implements. New modules register a value of this
 * shape through the ModuleRegistry; no core code changes are required.
 */
export interface RegisteredModule {
  /** Stable machine id, e.g. 'pptx'. Used as the `id` argument of `start_module`. */
  id: string
  /** Human-readable name shown in the Modules panel, e.g. 'PowerPoint (PPTX)'. */
  name: string
  /** Short user-facing summary. */
  summary: string
  /** Long description shown to the main agent so it knows when/when to trigger this module. */
  description: string
  /** Extra system-prompt guidance for the module's subagent. */
  systemPrompt: string
  /** Module-specific tools added on top of the shared base tool set. */
  tools: PTTool[]
}
