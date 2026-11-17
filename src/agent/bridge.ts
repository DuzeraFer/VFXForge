/** Connects the MCP server in the main process to the tools in this window. */

import { runTool, type AgentIdentity } from "./host"

type Call = { callId: string; agent: AgentIdentity; tool: string; args: Record<string, unknown> }

let serving = false

export function serveAgents(): void {
  if (serving || !window.vfxforge) return
  serving = true
  // Calls run one at a time, in arrival order, so edits never overtake each other.
  let queue: Promise<unknown> = Promise.resolve()
  window.vfxforge.serveMcp((call: Call) => {
    const result = queue.then(() => runTool(call.agent, call.tool, call.args))
    queue = result.catch(() => undefined)
    return result
  })
}
