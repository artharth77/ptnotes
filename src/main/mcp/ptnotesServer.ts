import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ElicitRequestFormParams } from '@modelcontextprotocol/sdk/types.js'
import { randomBytes } from 'crypto'
import { resolveSecretTokens, secretToken } from '@shared/secrets'
import { DEFAULT_MCP_CATEGORIES } from '@shared/mcpServer'
import type { ConfirmRequest, McpServerCategories } from '@shared/types'
import { tools as chatTools, type PTTool, type ToolContext } from '../ai/tools'
import type { PTNotesService } from '../service/PTNotesService'
import { APP_VERSION } from '../version'

/** Which category each exposed chat tool belongs to. `list_projects` is always available. */
const TOOL_CATEGORY: Record<string, keyof McpServerCategories> = {
  list_notes: 'notes',
  read_note: 'notes',
  create_note: 'notes',
  update_note: 'notes',
  delete_note: 'notes',
  list_kanban_cards: 'kanban',
  create_kanban_card: 'kanban',
  update_kanban_card: 'kanban',
  move_kanban_card: 'kanban',
  add_kanban_comment: 'kanban',
  delete_kanban_card: 'kanban',
  list_schedules: 'planner',
  read_schedule: 'planner',
  create_schedule: 'planner',
  update_schedule: 'planner',
  add_task: 'planner',
  update_task: 'planner',
  set_calendar: 'planner'
}

/** Kanban tools whose arguments may carry secret tokens that must be resolved before execution. */
const SECRET_ARG_TOOLS = new Set(['create_kanban_card', 'update_kanban_card'])

const PROJECT_PROP = {
  type: 'string',
  description:
    'Name of the project to operate on. Every project tool requires this — call list_projects to discover valid names.'
}

const listProjectsTool: PTTool = {
  definition: {
    type: 'function',
    function: {
      name: 'list_projects',
      description:
        'List all PTNotes projects by name. Call this first to discover the project name required by every other tool.',
      parameters: { type: 'object', properties: {} }
    }
  },
  async execute(_args, ctx) {
    const projects = await ctx.service.listProjects()
    return JSON.stringify({
      ok: true,
      projects: projects.map((p) => ({ name: p.name, pathExists: p.pathExists }))
    })
  }
}

/** Copy a tool with a required `project` property injected (the shared definitions are never mutated). */
function withRequiredProject(tool: PTTool): PTTool {
  const params = (tool.definition.function.parameters ?? {}) as {
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
  return {
    ...tool,
    definition: {
      ...tool.definition,
      function: {
        ...tool.definition.function,
        parameters: {
          ...params,
          type: 'object',
          properties: { ...(params.properties ?? {}), project: PROJECT_PROP },
          required: [...new Set([...(params.required ?? []), 'project'])]
        }
      }
    }
  }
}

const projectTools = chatTools
  .filter((t) => TOOL_CATEGORY[t.definition.function.name])
  .map(withRequiredProject)

/** The MCP tool surface for the enabled categories: `list_projects` + notes/kanban/planner tools. */
export function buildMcpTools(categories: McpServerCategories = DEFAULT_MCP_CATEGORIES): PTTool[] {
  return [
    listProjectsTool,
    ...projectTools.filter((t) => categories[TOOL_CATEGORY[t.definition.function.name]])
  ]
}

/** Number of tools exposed for the given categories. */
export function mcpToolCount(categories: McpServerCategories = DEFAULT_MCP_CATEGORIES): number {
  return buildMcpTools(categories).length
}

function errorResult(message: string): {
  content: { type: 'text'; text: string }[]
  isError: true
} {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Build a low-level MCP `Server` (raw JSON-Schema tools) bound to the running PTNotes service. */
export function createPtNotesMcpServer(
  service: PTNotesService,
  categories: McpServerCategories = DEFAULT_MCP_CATEGORIES
): Server {
  const exposedTools = buildMcpTools(categories)
  const server = new Server(
    { name: 'ptnotes', version: APP_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        'PTNotes exposes its project data (notes, kanban cards, planner schedules). Every project tool requires an explicit `project` argument — call list_projects first to discover valid project names.'
    }
  )

  // Secret values referenced by kanban attribute tokens live only in this session's memory.
  const secrets = new Map<string, string>()

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: exposedTools.map((t) => ({
      name: t.definition.function.name,
      description: t.definition.function.description,
      inputSchema: t.definition.function.parameters as {
        type: 'object'
        properties?: Record<string, unknown>
      }
    }))
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    const tool = exposedTools.find((t) => t.definition.function.name === name)
    if (!tool) return errorResult(`Unknown tool: ${name}`)

    const project = typeof args.project === 'string' ? args.project.trim() : ''
    if (name !== 'list_projects' && !project) {
      return errorResult(
        'The `project` argument is required. Call list_projects to discover valid project names.'
      )
    }

    let execArgs = args
    if (SECRET_ARG_TOOLS.has(name)) {
      const { value, unknown } = resolveSecretTokens(args, secrets)
      if (unknown.length > 0) {
        return errorResult(
          `Unknown secret reference: ${unknown.map((id) => secretToken(id)).join(', ')}. Secret tokens are only valid within the current MCP session.`
        )
      }
      execArgs = value as Record<string, unknown>
    }

    const confirm = async (req: Omit<ConfirmRequest, 'id'>): Promise<boolean> => {
      // Option 1: destructive tools require client elicitation; unsupported clients refuse the action.
      if (!server.getClientCapabilities()?.elicitation) return false
      const items = (req.items ?? []).map((item) => `- ${item}`).join('\n')
      const params: ElicitRequestFormParams = {
        mode: 'form',
        message: items ? `${req.message}\n${items}` : req.message,
        requestedSchema: {
          type: 'object',
          properties: {
            confirm: {
              type: 'boolean',
              title: 'Confirm',
              description: 'Approve this action?'
            }
          },
          required: ['confirm']
        }
      }
      try {
        const result = await server.elicitInput(params, { relatedRequestId: extra.requestId })
        return result.action === 'accept' && result.content?.confirm === true
      } catch {
        return false
      }
    }

    const ctx: ToolContext = {
      service,
      activeProject: project,
      activeNoteId: null,
      confirm,
      registerSecret: (value: string): string => {
        const id = randomBytes(6).toString('hex')
        secrets.set(id, value)
        return secretToken(id)
      }
    }

    try {
      const result = await tool.execute(execArgs, ctx)
      return { content: [{ type: 'text' as const, text: result }] }
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  })

  return server
}
