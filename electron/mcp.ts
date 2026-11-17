/**
 * MCP server (docs/05 §5.2). The protocol lives here in the main process; the
 * tools run in the renderer, next to the document and the engine.
 *
 * - Streamable HTTP on 127.0.0.1, random port, bearer token. Port and token
 *   are written to <userData>/mcp.json for the stdio shim.
 * - `vfxforge mcp` is the stdio shim: it proxies to a running app, or, when
 *   none is running, serves the same tools from a hidden window.
 */

import { app, type BrowserWindow, ipcMain } from "electron"
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { PNG } from "pngjs"
import { TOOL_SPECS } from "../src/agent/toolSpecs"

type JsonRpcId = string | number | null
type JsonRpcMessage = { jsonrpc: "2.0"; id?: JsonRpcId; method?: string; params?: Record<string, unknown> }
type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId; result?: unknown; error?: { code: number; message: string } }

type RendererContent = { type: "text"; text: string } | { type: "image"; width: number; height: number; data: Uint8Array }
type RendererResult = { content: RendererContent[]; isError?: boolean }
export type ToolCall = { callId: string; agent: { id: string; name: string }; tool: string; args: Record<string, unknown> }

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
const TOOL_TIMEOUT_MS = 120_000
/** Tools that wait on a service outside the app get longer. */
const SLOW_TOOL_TIMEOUT_MS: Record<string, number> = { generate_image: 300_000 }
/** Tried first; any free port is used if it is taken. */
const DEFAULT_PORT = 47821

const INSTRUCTIONS =
  "VFXForge is a node editor for stylized game VFX textures. You edit the live graph the artist is watching. Call get_guide first. Build in small apply batches, and render and measure after each one. Call finish_working when you are done."

export function mcpConfigPath(): string {
  return join(app.getPath("userData"), "mcp.json")
}

/** "claude-code" and friends show up as "Claude"; other clients keep their own name. */
function displayName(clientInfo: unknown): string {
  const info = (clientInfo ?? {}) as { name?: unknown; title?: unknown }
  const name = typeof info.title === "string" ? info.title : typeof info.name === "string" ? info.name : "Agent"
  return /claude/i.test(name) ? "Claude" : name.slice(0, 24)
}

function encodePng(width: number, height: number, data: Uint8Array): string {
  const png = new PNG({ width, height })
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  return PNG.sync.write(png, { colorType: 6 }).toString("base64")
}

/** Sends tool calls to the window's renderer and waits for the answers. */
export function createToolRunner(getWindow: () => BrowserWindow | null): (call: Omit<ToolCall, "callId">) => Promise<RendererResult> {
  const waiting = new Map<string, (result: RendererResult) => void>()
  // Calls that arrive while the window is still loading wait for it.
  let ready = false
  const held: (() => void)[] = []
  ipcMain.on("mcp:ready", () => {
    ready = true
    for (const send of held.splice(0)) send()
  })
  ipcMain.on("mcp:result", (_event, callId: string, result: RendererResult) => {
    waiting.get(callId)?.(result)
    waiting.delete(callId)
  })
  return (call) =>
    new Promise((resolve) => {
      const win = getWindow()
      if (!win || win.isDestroyed()) {
        resolve({ content: [{ type: "text", text: "The VFXForge window is not open." }], isError: true })
        return
      }
      const callId = randomUUID()
      const timeout = SLOW_TOOL_TIMEOUT_MS[call.tool] ?? TOOL_TIMEOUT_MS
      const timer = setTimeout(() => {
        waiting.delete(callId)
        resolve({ content: [{ type: "text", text: `${call.tool} took longer than ${timeout / 1000} s and was abandoned.` }], isError: true })
      }, timeout)
      waiting.set(callId, (result) => {
        clearTimeout(timer)
        resolve(result)
      })
      const send = (): void => win.webContents.send("mcp:call", { ...call, callId } satisfies ToolCall)
      if (ready) send()
      else held.push(send)
    })
}

export type McpHandler = {
  /** Handles one JSON-RPC message. Returns nothing for notifications. */
  handle: (message: JsonRpcMessage, sessionId: string | undefined) => Promise<{ response?: JsonRpcResponse; sessionId?: string }>
  end: (sessionId: string) => void
}

export function createMcpHandler(runTool: (call: Omit<ToolCall, "callId">) => Promise<RendererResult>): McpHandler {
  const sessions = new Map<string, { id: string; name: string }>()
  const anonymous = { id: "agent", name: "Agent" }

  return {
    async handle(message, sessionId) {
      const id = message.id ?? null
      const reply = (result: unknown): { response: JsonRpcResponse } => ({ response: { jsonrpc: "2.0", id, result } })
      const fail = (code: number, text: string): { response: JsonRpcResponse } => ({ response: { jsonrpc: "2.0", id, error: { code, message: text } } })
      if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return fail(-32600, "Not a JSON-RPC 2.0 request.")
      // Notifications get no answer.
      if (message.id === undefined) return {}

      switch (message.method) {
        case "initialize": {
          const asked = message.params?.protocolVersion
          const session = { id: randomUUID(), name: displayName(message.params?.clientInfo) }
          sessions.set(session.id, session)
          return {
            sessionId: session.id,
            ...reply({
              protocolVersion: typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
              capabilities: { tools: {} },
              serverInfo: { name: "vfxforge", title: "VFXForge", version: app.getVersion() },
              instructions: INSTRUCTIONS
            })
          }
        }
        case "ping":
          return reply({})
        case "tools/list":
          return reply({
            tools: TOOL_SPECS.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: { readOnlyHint: tool.readOnly }
            }))
          })
        case "tools/call": {
          const name = message.params?.name
          if (typeof name !== "string" || !TOOL_SPECS.some((tool) => tool.name === name)) return fail(-32602, `Unknown tool "${String(name)}".`)
          const args = (message.params?.arguments ?? {}) as Record<string, unknown>
          const agent = (sessionId && sessions.get(sessionId)) || anonymous
          const result = await runTool({ agent, tool: name, args })
          return reply({
            content: result.content.map((item) =>
              item.type === "text" ? item : { type: "image", data: encodePng(item.width, item.height, item.data), mimeType: "image/png" }
            ),
            isError: result.isError === true
          })
        }
        default:
          return fail(-32601, `Method "${message.method}" is not supported.`)
      }
    },
    end(sessionId) {
      const session = sessions.get(sessionId)
      if (!session) return
      sessions.delete(sessionId)
      void runTool({ agent: session, tool: "finish_working", args: {} })
    }
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) {
        reject(new Error("Request too large."))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })
}

export type McpServer = { port: number; token: string; close: () => void }

/** Starts the HTTP transport and writes mcp.json. */
export async function startMcpServer(handler: McpHandler): Promise<McpServer> {
  // The token and, when free, the port stay the same between runs, so an HTTP
  // client configured once keeps working.
  const file = mcpConfigPath()
  let token = randomBytes(24).toString("base64url")
  try {
    const previous = (JSON.parse(readFileSync(file, "utf8")) as { token?: unknown }).token
    if (typeof previous === "string" && previous.length >= 24) token = previous
  } catch {
    // First run.
  }
  const expected = Buffer.from(`Bearer ${token}`)

  const authorized = (request: IncomingMessage): boolean => {
    const given = Buffer.from(request.headers.authorization ?? "")
    return given.length === expected.length && timingSafeEqual(given, expected)
  }
  const send = (response: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void => {
    response.writeHead(status, { "content-type": "application/json", ...headers })
    response.end(body === undefined ? undefined : JSON.stringify(body))
  }

  const server: Server = createServer((request, response) => {
    void (async () => {
      // A web page must never reach this server: browsers always send Origin, MCP clients do not.
      if (request.headers.origin) return send(response, 403, { error: "Requests from web pages are not allowed." })
      if ((request.url ?? "").split("?")[0] !== "/mcp") return send(response, 404, { error: "Not found." })
      if (!authorized(request)) return send(response, 401, { error: "Missing or wrong token." })
      const sessionId = typeof request.headers["mcp-session-id"] === "string" ? request.headers["mcp-session-id"] : undefined
      if (request.method === "DELETE") {
        if (sessionId) handler.end(sessionId)
        return send(response, 200, {})
      }
      if (request.method !== "POST") return send(response, 405, { error: "Use POST." }, { allow: "POST, DELETE" })

      let payload: unknown
      try {
        payload = JSON.parse(await readBody(request))
      } catch {
        return send(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "The request body is not valid JSON." } })
      }
      const messages = (Array.isArray(payload) ? payload : [payload]) as JsonRpcMessage[]
      const responses: JsonRpcResponse[] = []
      let newSession: string | undefined
      for (const message of messages) {
        const result = await handler.handle(message, sessionId)
        if (result.sessionId) newSession = result.sessionId
        if (result.response) responses.push(result.response)
      }
      const headers: Record<string, string> = newSession ? { "mcp-session-id": newSession } : {}
      if (responses.length === 0) return send(response, 202, undefined, headers)
      send(response, 200, Array.isArray(payload) ? responses : responses[0], headers)
    })().catch((error: unknown) => send(response, 500, { error: error instanceof Error ? error.message : String(error) }))
  })

  const listen = (port: number): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject)
        resolve()
      })
    })
  await listen(DEFAULT_PORT).catch(() => listen(0))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${port}/mcp`, port, token, pid: process.pid }, null, 2), { mode: 0o600 })

  // mcp.json stays after quitting (it keeps the token); the shim checks that the server answers before using it.
  return { port, token, close: () => server.close() }
}

type RunningApp = { url: string; token: string }

/** The running app's server, if mcp.json points at one that answers. */
async function findRunningApp(): Promise<RunningApp | null> {
  const file = mcpConfigPath()
  if (!existsSync(file)) return null
  try {
    const config = JSON.parse(readFileSync(file, "utf8")) as Partial<RunningApp>
    if (typeof config.url !== "string" || typeof config.token !== "string") return null
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
      signal: AbortSignal.timeout(2000)
    })
    return response.ok ? { url: config.url, token: config.token } : null
  } catch {
    return null
  }
}

/**
 * `vfxforge mcp`: newline-delimited JSON-RPC on stdin/stdout. `localHandler`
 * is called only when no app is running, to serve from this process.
 */
export async function runStdioShim(localHandler: () => Promise<McpHandler>): Promise<void> {
  const running = await findRunningApp()
  const local = running ? null : await localHandler()
  let sessionId: string | undefined

  const forward = async (message: JsonRpcMessage): Promise<JsonRpcResponse | undefined> => {
    if (local) {
      const result = await local.handle(message, sessionId)
      if (result.sessionId) sessionId = result.sessionId
      return result.response
    }
    const response = await fetch(running!.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${running!.token}`, ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
      body: JSON.stringify(message)
    })
    sessionId = response.headers.get("mcp-session-id") ?? sessionId
    if (response.status === 202) return undefined
    return (await response.json()) as JsonRpcResponse
  }

  // One message at a time, in order: edits must not overtake each other.
  let queue: Promise<void> = Promise.resolve()
  const lines = createInterface({ input: process.stdin })
  lines.on("line", (line) => {
    if (!line.trim()) return
    queue = queue.then(async () => {
      let message: JsonRpcMessage
      try {
        message = JSON.parse(line) as JsonRpcMessage
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Not valid JSON." } })}\n`)
        return
      }
      try {
        const response = await forward(message)
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
      } catch (error) {
        if (message.id !== undefined) {
          const text = `VFXForge is not reachable: ${error instanceof Error ? error.message : String(error)}`
          process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: text } })}\n`)
        }
      }
    })
  })
  lines.on("close", () => {
    void queue.then(async () => {
      if (local && sessionId) local.end(sessionId)
      else if (running && sessionId) {
        await fetch(running.url, { method: "DELETE", headers: { authorization: `Bearer ${running.token}`, "mcp-session-id": sessionId } }).catch(() => undefined)
      }
      app.quit()
    })
  })
}
