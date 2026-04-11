/**
 * Shared allowed tools list -- used by both warm session and cold dispatch.
 * Single source of truth to prevent tool access divergence between paths.
 *
 * Customize this list based on which MCP servers you have configured.
 * The defaults here are the basic Claude Code tools. Add your own MCP
 * tool names as needed (e.g., 'mcp__my-server__my-tool').
 */

export const ALLOWED_TOOLS_LIST = [
  // Core Claude Code tools
  'Read', 'Glob', 'Grep', 'Write',
  'WebFetch', 'WebSearch',
  // TG send (for cold path -- warm path uses grammy directly)
  'mcp__telegram__send_message',
  // TODO: Add your MCP tools here, e.g.:
  // 'mcp__my-server__my-tool',
]

export const ALLOWED_TOOLS = ALLOWED_TOOLS_LIST.join(',')
