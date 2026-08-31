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
  /** Optional external link shown under the module row in Settings (e.g. a template gallery). */
  link?: { label: string; url: string }
  /** Long description shown to the main agent so it knows when/when to trigger this module. */
  description: string
  /** Extra system-prompt guidance for the module's subagent. */
  systemPrompt: string
  /** Name of the tool that produces the module's deliverable file (e.g. 'create_pptx_file'). */
  outputTool?: string
  /** Module-specific tools added on top of the shared base tool set. */
  tools: PTTool[]
  /** Max model turns for the subagent loop. Defaults to 30; set higher for long-running agents. */
  maxIterations?: number
  /** Hidden modules are internal plumbing: excluded from Settings ▸ Modules, `start_module`
   *  listings and the Modules panel, but still startable programmatically (e.g. bot tasks). */
  hidden?: boolean
}
