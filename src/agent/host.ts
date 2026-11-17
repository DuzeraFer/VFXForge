/**
 * Runs MCP tools against the live document and engine. The main process only
 * carries the calls; everything that touches the graph happens here, through
 * the same ops the UI uses.
 */

import { session } from "../app/session"
import { applyOps, BatchError, nextId, type Graph, type Op, type ParamValue } from "../doc"
import type { Engine } from "../engine/evaluator"
import { toRgba8 } from "../engine/evaluator"
import { measureFrame, measureMotion } from "../engine/measure"
import { compositeOver, resolveTarget, sheetLayout, type Rgba8Image, type Target } from "../engine/render"
import { resolveGraph, type Problem } from "../engine/validate"
import { nodeDefs, registry } from "../nodes"
import { graphText } from "./graphText"
import { generateFor } from "../ai/generation"
import { GUIDE } from "./guide"
import { placeNewNodes } from "./place"
import { TOOL_SPECS } from "./toolSpecs"

export type ToolContent = { type: "text"; text: string } | { type: "image"; width: number; height: number; data: Uint8Array }
export type ToolResult = { content: ToolContent[]; isError?: boolean }
export type AgentIdentity = { id: string; name: string }

class ToolError extends Error {}

let engine: Engine | null = null
/** The app hands over its engine once the GPU is ready. */
export function setAgentEngine(next: Engine | null): void {
  engine = next
}

type Args = Record<string, unknown>

const text = (value: string): ToolResult => ({ content: [{ type: "text", text: value }] })
/** Indented JSON, with lists of plain numbers or short strings kept on one line. */
const json = (value: unknown): ToolResult =>
  text(JSON.stringify(value, null, 1).replace(/\[\s*((?:-?[\d.e+-]+|"[^"\n]{0,24}"|true|false)(?:,\s*(?:-?[\d.e+-]+|"[^"\n]{0,24}"|true|false))*)\s*\]/g, (_all, inner: string) => `[${inner.replace(/\s*\n\s*/g, " ")}]`))

function graphOf(args: Args): Graph {
  const state = session.getState()
  const id = typeof args.graphId === "string" ? args.graphId : state.activeGraphId
  const graph = state.project.graphs.find((g) => g.id === id)
  if (!graph) throw new ToolError(id ? `There is no graph "${id}". Graphs: ${state.project.graphs.map((g) => g.id).join(", ")}.` : "The project has no graph yet. Use create_graph.")
  return graph
}

function targetOf(graph: Graph, args: Args): Target {
  try {
    return resolveTarget(graph, registry, typeof args.target === "string" ? args.target : undefined)
  } catch (error) {
    throw new ToolError(error instanceof Error ? error.message : String(error))
  }
}

// ── Rendering ─────────────────────────────────────────────

async function frameOf(graph: Graph, target: Target, frame: number): Promise<{ image: Rgba8Image; gray: boolean }> {
  if (!engine) throw new ToolError("The GPU is not ready, so nothing can be rendered right now.")
  if (!Number.isInteger(frame) || frame < 0 || frame >= graph.settings.frames) {
    throw new ToolError(`Frame ${frame} is outside this graph's ${graph.settings.frames} frame(s) (0 to ${graph.settings.frames - 1}).`)
  }
  // The preview and thumbnails share this engine, so point it at our graph right before each evaluation.
  const { problems } = engine.setGraph(graph, session.getState().project.seed)
  let result
  try {
    result = engine.evaluate(target.nodeId, target.output, frame)
  } catch (error) {
    const related = problems.map((p) => `${p.nodeId}: ${p.message}`).join(" ")
    throw new ToolError(`Cannot render ${target.nodeId}.${target.output}: ${error instanceof Error ? error.message : String(error)}${related ? ` Problems in the graph: ${related}` : ""}`)
  }
  const pixels = await engine.readPixels(result)
  await engine.settle().catch((error: unknown) => {
    throw new ToolError(`Shader error: ${error instanceof Error ? error.message : String(error)}`)
  })
  return { image: { width: result.width, height: result.height, data: toRgba8(pixels) }, gray: result.type === "gray" }
}

/** Frames laid out in a grid, left to right then top to bottom. */
function grid(frames: Rgba8Image[], cols: number): Rgba8Image {
  const { width, height } = frames[0]
  const rows = Math.ceil(frames.length / cols)
  const data = new Uint8ClampedArray(width * cols * height * rows * 4)
  frames.forEach((frame, i) => {
    const left = (i % cols) * width
    const top = Math.floor(i / cols) * height
    for (let y = 0; y < height; y++) data.set(frame.data.subarray(y * width * 4, (y + 1) * width * 4), ((top + y) * width * cols + left) * 4)
  })
  return { width: width * cols, height: height * rows, data }
}

function tile2(image: Rgba8Image): Rgba8Image {
  return grid([image, image, image, image], 2)
}

function flatten(image: Rgba8Image, background: unknown): Rgba8Image {
  const name = typeof background === "string" ? background.toLowerCase() : "checker"
  if (name === "transparent") return image
  if (name === "black") return compositeOver(image, [0, 0, 0])
  if (name === "white") return compositeOver(image, [255, 255, 255])
  const hex = /^#?([0-9a-f]{6})$/.exec(name)
  if (hex) {
    const n = Number.parseInt(hex[1], 16)
    return compositeOver(image, [(n >> 16) & 255, (n >> 8) & 255, n & 255])
  }
  if (name !== "checker") throw new ToolError(`Unknown background "${String(background)}". Use checker, black, white, transparent or a color like #2a1f2b.`)
  const data = new Uint8ClampedArray(image.data.length)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4
      const shade = ((x >> 3) + (y >> 3)) % 2 === 0 ? 42 : 52
      const a = image.data[i + 3] / 255
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(image.data[i + c] * a + shade * (1 - a))
      data[i + 3] = 255
    }
  }
  return { width: image.width, height: image.height, data }
}

const picture = (image: Rgba8Image): ToolContent => ({
  type: "image",
  width: image.width,
  height: image.height,
  data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)
})

// ── Editing ───────────────────────────────────────────────

const PROBLEMS_THAT_BLOCK: ReadonlySet<Problem["code"]> = new Set(["unknown_type", "unknown_param", "bad_param", "unknown_socket", "type_mismatch", "bad_driver"])

/** Agent-facing ops to document ops, and the nodes they touch. */
function translate(graph: Graph, raw: unknown[], projectSeed: number): { ops: Op[]; touched: string[]; added: { id: string; placed: boolean }[] } {
  const ops: Op[] = []
  const touched = new Set<string>()
  const added: { id: string; placed: boolean }[] = []
  const taken = graph.nodes.map((n) => n.id)
  const nodeOf = (ref: unknown): string => String(ref).split(".")[0]

  raw.forEach((item, index) => {
    const op = item as Record<string, unknown>
    const where = `Op ${index}`
    const need = (key: string): string => {
      if (typeof op[key] !== "string" || op[key] === "") throw new ToolError(`${where} (${String(op.op)}) needs "${key}".`)
      return op[key]
    }
    const guard = typeof op.ifVersion === "number" ? { ifVersion: op.ifVersion } : {}
    switch (op.op) {
      case "add_node": {
        const type = need("type")
        if (!registry.get(type)) throw new ToolError(`${where}: there is no node type "${type}". Call list_node_types.`)
        const id = typeof op.id === "string" ? op.id : nextId(taken, "n")
        taken.push(id)
        const position = Array.isArray(op.position) ? (op.position as [number, number]) : undefined
        ops.push({
          op: "add_node",
          graphId: graph.id,
          type,
          id,
          ...(typeof op.name === "string" ? { name: op.name } : {}),
          ...(op.params && typeof op.params === "object" ? { params: op.params as Record<string, ParamValue> } : {}),
          ...(position ? { position } : {})
        })
        added.push({ id, placed: !!position })
        touched.add(id)
        break
      }
      case "remove_node":
        ops.push({ op: "remove_node", graphId: graph.id, id: need("id"), ...guard })
        break
      case "set_params":
        if (!op.params || typeof op.params !== "object") throw new ToolError(`${where} (set_params) needs "params".`)
        ops.push({ op: "set_params", graphId: graph.id, id: need("id"), params: op.params as Record<string, ParamValue | null>, ...guard })
        touched.add(need("id"))
        break
      case "connect":
        ops.push({ op: "connect", graphId: graph.id, from: need("from"), to: need("to") })
        touched.add(nodeOf(op.to))
        break
      case "disconnect":
        ops.push({ op: "disconnect", graphId: graph.id, to: need("to") })
        touched.add(nodeOf(op.to))
        break
      case "drive_param":
        ops.push({ op: "drive_param", graphId: graph.id, id: need("id"), param: need("param"), from: typeof op.from === "string" ? op.from : null, ...guard })
        touched.add(need("id"))
        break
      case "move_node":
        if (!Array.isArray(op.position)) throw new ToolError(`${where} (move_node) needs "position": [x, y].`)
        ops.push({ op: "move_node", graphId: graph.id, id: need("id"), position: op.position as [number, number] })
        break
      case "rename":
        ops.push({ op: "rename", graphId: graph.id, id: need("id"), name: typeof op.name === "string" ? op.name : null, ...guard })
        touched.add(need("id"))
        break
      case "set_node_flags":
        ops.push({
          op: "set_node_flags",
          graphId: graph.id,
          id: need("id"),
          ...(typeof op.bypass === "boolean" ? { bypass: op.bypass } : {}),
          ...(typeof op.locked === "boolean" ? { locked: op.locked } : {}),
          ...guard
        })
        touched.add(need("id"))
        break
      case "set_graph": {
        const settings: Record<string, unknown> = {}
        for (const key of ["width", "height", "frames", "fps", "loop"]) if (op[key] !== undefined) settings[key] = op[key]
        if (Array.isArray(op.size)) [settings.width, settings.height] = op.size as number[]
        if (typeof op.name === "string" || Object.keys(settings).length > 0) {
          ops.push({ op: "set_graph", graphId: graph.id, ...(typeof op.name === "string" ? { name: op.name } : {}), ...(Object.keys(settings).length > 0 ? { settings } : {}) })
        }
        if (typeof op.seed === "number" && op.seed !== projectSeed) ops.push({ op: "set_project", seed: op.seed })
        break
      }
      case "expose_param":
      case "add_comment_box":
        throw new ToolError(`${where}: "${String(op.op)}" is not available yet.`)
      default:
        throw new ToolError(`${where}: unknown operation "${String(op.op)}". See the apply tool description for the list.`)
    }
  })
  return { ops, touched: [...touched], added }
}

function apply(agent: AgentIdentity, args: Args): ToolResult {
  const graph = graphOf(args)
  if (!Array.isArray(args.ops) || args.ops.length === 0) throw new ToolError('apply needs "ops": a list with at least one operation.')
  const label = typeof args.label === "string" && args.label.trim() ? args.label.trim() : "Agent edit"
  const { project } = session.getState()
  const { ops, touched, added } = translate(graph, args.ops, project.seed)

  // Dry run: learn where the new nodes go and whether the result is valid, before the artist sees anything.
  let after: Graph
  try {
    after = applyOps(project, ops, { respectLocks: true }).project.graphs.find((g) => g.id === graph.id)!
  } catch (error) {
    if (error instanceof BatchError) throw new ToolError(`Nothing was changed. ${error.message}`)
    throw error
  }
  const before = new Set(resolveGraph(graph, registry).problems.map((p) => `${p.nodeId}|${p.code}|${p.message}`))
  const problems = resolveGraph(after, registry).problems
  const blocking = problems.filter((p) => PROBLEMS_THAT_BLOCK.has(p.code) && !before.has(`${p.nodeId}|${p.code}|${p.message}`))
  if (blocking.length > 0) {
    throw new ToolError(`Nothing was changed. The result would be invalid:\n${blocking.map((p) => `- ${p.nodeId}: ${p.message}`).join("\n")}`)
  }
  const spots = placeNewNodes(after, added.filter((a) => !a.placed).map((a) => a.id))
  for (const [id, position] of spots) ops.push({ op: "move_node", graphId: graph.id, id, position })

  try {
    session.agentApply(agent, graph.id, ops, label, touched)
  } catch (error) {
    if (error instanceof BatchError) throw new ToolError(`Nothing was changed. ${error.message}`)
    throw error
  }
  const waiting = problems.filter((p) => p.code === "missing_input" && touched.includes(p.nodeId))
  const lines = [`Applied "${label}" (${args.ops.length} operation${args.ops.length === 1 ? "" : "s"}).`]
  if (added.length > 0) lines.push(`New nodes: ${added.map((a) => a.id).join(", ")}.`)
  if (waiting.length > 0) lines.push(`Still to connect:\n${waiting.map((p) => `- ${p.nodeId}: ${p.message}`).join("\n")}`)
  return text(lines.join("\n"))
}

// ── Reading ───────────────────────────────────────────────

function basicInfo(): ToolResult {
  const state = session.getState()
  return json({
    project: state.project.name,
    file: state.path,
    unsavedChanges: state.dirty,
    seed: state.project.seed,
    activeGraph: state.activeGraphId,
    graphs: state.project.graphs.map((g) => ({
      id: g.id,
      name: g.name,
      size: `${g.settings.width}x${g.settings.height}`,
      frames: g.settings.frames,
      fps: g.settings.fps,
      loop: g.settings.loop,
      nodes: g.nodes.length,
      outputs: g.nodes.filter((n) => n.type === "output").map((n) => ({ nodeId: n.id, name: n.params.name ?? "output" }))
    })),
    nodeTypes: nodeDefs.length
  })
}

function selection(): ToolResult {
  const state = session.getState()
  const graph = state.activeGraph
  return json({
    activeGraph: state.activeGraphId,
    selected: state.selection.map((id) => {
      const node = graph?.nodes.find((n) => n.id === id)
      return { id, type: node?.type, name: node?.name }
    }),
    pinnedInPreview: state.pinnedNodeId
  })
}

function nodeInfo(args: Args): ToolResult {
  const graph = graphOf(args)
  const node = graph.nodes.find((n) => n.id === args.nodeId)
  if (!node) throw new ToolError(`Graph "${graph.id}" has no node "${String(args.nodeId)}". Nodes: ${graph.nodes.map((n) => n.id).join(", ") || "none"}.`)
  const def = registry.get(node.type)
  const resolved = resolveGraph(graph, registry)
  return json({
    id: node.id,
    type: node.type,
    name: node.name,
    version: node.version,
    locked: !!node.locked,
    bypass: !!node.bypass,
    doc: def?.doc,
    params: Object.fromEntries(
      Object.entries(def?.params ?? {}).map(([name, schema]) => {
        const { doc, default: fallback, ...rest } = schema
        return [name, { ...rest, default: fallback, value: name in node.params ? node.params[name] : fallback, ...(node.driven[name] ? { drivenBy: node.driven[name] } : {}), ...(doc ? { doc } : {}) }]
      })
    ),
    inputs: Object.fromEntries(
      Object.entries(def?.inputs ?? {}).map(([name, input]) => [name, { type: input.type, optional: !!input.optional, from: graph.links.find((l) => l.to === `${node.id}.${name}`)?.from ?? null }])
    ),
    outputs: Object.fromEntries(Object.keys(def?.outputs ?? {}).map((name) => [name, resolved.outputTypes.get(`${node.id}.${name}`) ?? "unresolved"])),
    problems: resolved.problems.filter((p) => p.nodeId === node.id).map((p) => p.message)
  })
}

function nodeTypes(args: Args): ToolResult {
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : ""
  const sockets = (def: (typeof nodeDefs)[number]): string =>
    `(${Object.entries(def.inputs).map(([n, i]) => `${n}: ${i.type}${i.optional ? "?" : ""}`).join(", ")}) -> (${Object.entries(def.outputs).map(([n, t]) => `${n}: ${t}`).join(", ")})`
  if (!query) {
    const lines = [...nodeDefs]
      .sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type))
      .map((def) => `${def.type.padEnd(16)} [${def.category}]  ${sockets(def)}  ${def.doc.split(". ")[0].replace(/\.$/, "")}.`)
    return text(`${lines.join("\n")}\n\nCall list_node_types with a type name for its parameters.`)
  }
  const words = query.split(/\s+/)
  const exact = nodeDefs.filter((def) => def.type === query.replace(/\s+/g, "_"))
  const found = exact.length > 0 ? exact : nodeDefs.filter((def) => words.every((w) => `${def.type} ${def.category} ${def.doc}`.toLowerCase().includes(w)))
  if (found.length === 0) return text(`No node type matches "${query}". Call list_node_types without a query to see them all.`)
  return json(
    found.slice(0, 8).map((def) => ({
      type: def.type,
      category: def.category,
      doc: def.doc,
      inputs: Object.fromEntries(Object.entries(def.inputs).map(([n, i]) => [n, i.optional ? `${i.type} (optional)` : i.type])),
      outputs: def.outputs,
      params: Object.fromEntries(Object.entries(def.params).map(([name, schema]) => [name, schema]))
    }))
  )
}

function history(args: Args): ToolResult {
  const limit = typeof args.limit === "number" ? Math.max(1, Math.min(100, Math.floor(args.limit))) : 20
  const { done } = session.getState().history
  return json(
    [...done]
      .reverse()
      .slice(0, limit)
      .map((t) => ({ id: t.id, label: t.label, by: t.author.kind === "agent" ? t.author.name : "artist", at: t.timestamp, operations: t.ops.length }))
  )
}

// ── See and measure ───────────────────────────────────────

async function render(args: Args): Promise<ToolResult> {
  const graph = graphOf(args)
  const target = targetOf(graph, args)
  let image: Rgba8Image
  let note: string
  if (args.frame === "sheet") {
    const frames: Rgba8Image[] = []
    for (let f = 0; f < graph.settings.frames; f++) frames.push((await frameOf(graph, target, f)).image)
    const layout = sheetLayout(frames.length)
    image = grid(frames, layout.cols)
    note = `${target.nodeId}.${target.output}, all ${frames.length} frames, ${layout.cols}x${layout.rows} grid of ${graph.settings.width}x${graph.settings.height}`
  } else {
    const frame = typeof args.frame === "number" ? args.frame : 0
    image = (await frameOf(graph, target, frame)).image
    note = `${target.nodeId}.${target.output}, frame ${frame} of ${graph.settings.frames}, ${image.width}x${image.height}`
  }
  if (args.tile === true) {
    image = tile2(image)
    note += ", tiled 2x2"
  }
  return { content: [{ type: "text", text: note }, picture(flatten(image, args.background))] }
}

async function renderFrames(args: Args): Promise<ToolResult> {
  const graph = graphOf(args)
  const target = targetOf(graph, args)
  const total = graph.settings.frames
  const count = Math.min(8, total)
  const chosen = Array.isArray(args.frames) && args.frames.length > 0 ? (args.frames as number[]) : Array.from({ length: count }, (_, i) => Math.floor((i * total) / count))
  const frames: Rgba8Image[] = []
  for (const f of chosen) frames.push((await frameOf(graph, target, f)).image)
  return {
    content: [{ type: "text", text: `${target.nodeId}.${target.output}, frames ${chosen.join(", ")} of ${total}, left to right` }, picture(flatten(grid(frames, frames.length), args.background))]
  }
}

/** Grayscale images have no alpha: their brightness is the shape. */
function luminanceAsAlpha(image: Rgba8Image): Rgba8Image {
  const data = new Uint8ClampedArray(image.data)
  for (let i = 0; i < data.length; i += 4) data[i + 3] = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])
  return { width: image.width, height: image.height, data }
}

async function measure(args: Args): Promise<ToolResult> {
  const graph = graphOf(args)
  const target = targetOf(graph, args)
  const frame = typeof args.frame === "number" ? args.frame : 0
  const first = await frameOf(graph, target, frame)
  const useLuminance = args.mask === "luminance" || (args.mask !== "alpha" && first.gray)
  const prepare = (image: Rgba8Image): Rgba8Image => (useLuminance ? luminanceAsAlpha(image) : image)
  const result: Record<string, unknown> = {
    target: `${target.nodeId}.${target.output}`,
    frame,
    shapeIs: useLuminance ? "pixels brighter than 50%" : "pixels with alpha above 50%",
    ...measureFrame(prepare(first.image))
  }
  if (args.motion === true) {
    const frames: Rgba8Image[] = []
    for (let f = 0; f < graph.settings.frames; f++) frames.push(prepare((await frameOf(graph, target, f)).image))
    result.motion = measureMotion(frames)
  }
  return json(result)
}

// ── Dispatch ──────────────────────────────────────────────

const READ_ONLY = new Set(TOOL_SPECS.filter((t) => t.readOnly).map((t) => t.name))

export async function runTool(agent: AgentIdentity, name: string, args: Args): Promise<ToolResult> {
  try {
    if (!READ_ONLY.has(name) && name !== "finish_working") session.agentSeen(agent.id, agent.name)
    switch (name) {
      case "get_guide":
        return text(GUIDE)
      case "get_basic_info":
        return basicInfo()
      case "get_selection":
        return selection()
      case "get_graph": {
        const graph = graphOf(args)
        const problems = resolveGraph(graph, registry).problems
        const body = graphText(graph, registry, session.getState().project.seed, args.detail === "full" ? "full" : "compact")
        return text(problems.length > 0 ? `${body}\n\nproblems:\n${problems.map((p) => `- ${p.nodeId}: ${p.message}`).join("\n")}` : body)
      }
      case "get_node":
        return nodeInfo(args)
      case "list_node_types":
        return nodeTypes(args)
      case "get_history":
        return history(args)
      case "render":
        return await render(args)
      case "render_frames":
        return await renderFrames(args)
      case "measure":
        return await measure(args)
      case "apply":
        return apply(agent, args)
      case "generate_image": {
        const graph = graphOf(args)
        const nodeId = typeof args.nodeId === "string" ? args.nodeId : ""
        const node = graph.nodes.find((n) => n.id === nodeId)
        if (!node) throw new ToolError(`Graph ${graph.id} has no node "${nodeId}".`)
        if (node.type !== "ai_image") throw new ToolError(`${nodeId} is a ${node.type} node. Only ai_image nodes generate pictures.`)
        const problem = await generateFor(graph, nodeId, { kind: "agent", ...agent })
        if (problem) throw new ToolError(problem)
        return text(`Generated a new picture for ${nodeId}. Render ${nodeId} (and ${nodeId}.mask) to look at it before building on it.`)
      }
      case "create_graph": {
        const { project } = session.getState()
        const id = nextId(project.graphs.map((g) => g.id), "g")
        const settings: Record<string, number> = {}
        for (const key of ["width", "height", "frames", "fps"]) if (typeof args[key] === "number") settings[key] = args[key]
        const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : `Graph ${project.graphs.length + 1}`
        session.agentApply(agent, id, [{ op: "add_graph", id, name, settings }], `Create graph "${name}"`, [])
        if (args.open === true) session.setActiveGraph(id)
        return text(`Created graph ${id} "${name}".${args.open === true ? " It is now open in the editor." : ""}`)
      }
      case "set_selection": {
        const graph = graphOf(args)
        const ids = Array.isArray(args.nodeIds) ? (args.nodeIds as unknown[]).map(String) : []
        const missing = ids.filter((id) => !graph.nodes.some((n) => n.id === id))
        if (missing.length > 0) throw new ToolError(`The open graph has no node ${missing.join(", ")}.`)
        session.select(ids)
        return text(ids.length > 0 ? `Selected ${ids.join(", ")}.` : "Cleared the selection.")
      }
      case "save_project": {
        const { path } = session.getState()
        if (!path) throw new ToolError("This project has never been saved, so there is no file to write to. Ask the artist to save it once (Ctrl+S).")
        await session.save()
        if (session.getState().dirty) throw new ToolError(`Could not save to ${path}.`)
        return text(`Saved ${path}.`)
      }
      case "finish_working":
        session.agentFinish(agent.id)
        if (typeof args.summary === "string" && args.summary.trim()) session.agentLog(agent.name, args.summary.trim())
        return text("Done. Your highlights are cleared.")
      default:
        throw new ToolError(`Unknown tool "${name}".`)
    }
  } catch (error) {
    if (error instanceof ToolError || error instanceof BatchError) return { content: [{ type: "text", text: error.message }], isError: true }
    return { content: [{ type: "text", text: `Internal error in ${name}: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
  }
}
