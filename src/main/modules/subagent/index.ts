import type { RegisteredModule } from '../types'

/**
 * General-purpose long-running background agent. Unlike the specialized modules
 * (pptx/docx/infographic) it has NO outputTool and NO extra tools — it works with
 * the shared base tool set (read/search notes & files, web_search/web_fetch,
 * create_note/update_note, create_kanban_card) and finishes with a concise summary.
 * The main chat agent decides when to start it, and the user can also ask for it
 * explicitly ("run the subagent"). `start_module`'s `expect` argument can request
 * a result payload back via `submit_result`.
 */
export function createSubagentModule(): RegisteredModule {
  return {
    id: 'subagent',
    name: 'Subagent (long-run)',
    summary: 'Runs a long-running background agent for research, analysis and multi-step work.',
    description:
      "A general-purpose long-running background agent. Use it for substantial multi-step work the user should not wait for: deep research across many sources (web_search + web_fetch loops), reading and summarizing many notes or files, drafting long content into notes, cross-referencing data, or any task needing many tool calls. The subagent plans steps and works autonomously with all the base tools (read_note/list_notes (with query to search)/read_file, web_search, web_fetch, create_note/update_note, create_kanban_card). The user may also explicitly ask to 'run the subagent' or 'use the long-run agent' — in that case start this module with their task. Author a DETAILED prompt: the goal, the steps/outline to follow, source references as note:<name> or file:<name>, and what should be produced or saved. Set the `expect` argument to request a specific result payload back (e.g. JSON, a summary, or a list of notes to create). Do NOT use this for specialized deliverables another module handles (PowerPoint, Word, infographic).",
    systemPrompt:
      'Work autonomously and thoroughly. Gather and verify information with the base tools: read_note/list_notes (with a query to search titles and content)/read_file for project sources, and web_search then web_fetch for up-to-date facts (fetch the top relevant results before writing about them). Never invent data — only use facts from the user prompt, project notes/files, or fetched pages. Persist substantial findings as well-structured markdown with create_note (new notes or full rewrites) or update_note (targeted line edits to an existing note — read it first with read_note to get line numbers) and track remaining work with create_kanban_card. When every step is done, write a concise final summary of what you did and where results were saved. If the main chat requested a result payload, submit it via submit_result in the exact requested format before finishing.',
    tools: [],
    maxIterations: 60
  }
}
