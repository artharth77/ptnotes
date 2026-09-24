import type { McpServerCategories } from './types'

/** Default localhost port for the built-in MCP server. */
export const DEFAULT_MCP_PORT = 3737

export const MCP_LOOPBACK_ADDRESS = '127.0.0.1'
export const MCP_ALL_INTERFACES_ADDRESS = '0.0.0.0'

/** Streamable HTTP path clients connect to. */
export const MCP_PATH = '/mcp'

/** Tool categories exposed by default. */
export const DEFAULT_MCP_CATEGORIES: McpServerCategories = {
  notes: true,
  kanban: true,
  planner: true
}
