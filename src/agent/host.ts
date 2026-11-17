/**
 * Runs MCP tools against the live document and engine. The main process only
 * carries the calls; everything that touches the graph happens here, through
 * the same ops the UI uses.
 */

import { assetPixels, snapshotOp } from "../app/board"
import { planFunctionFromNodes } from "../app/functions"
import { offerVariations } from "../app/variations"
import { session } from "../app/session"
import { addComment, addReference, applyOps, BatchError, BoardError, importFunctionOps, nextId, replyToComment, threadsOf, type Graph, type Op, type ParamValue, type Preset, type Speaker } from "../doc"
import { contactSheet, gridColumns, MAX_VARIATIONS, seedVariations, variantGraph, type Variation } from "../engine/variations"
import { functionType, usesGraph } from "../engine/functions"
import { recipe, recipes } from "../library/recipes"
import type { Engine } from "../engine/evaluator"
import { toRgba8 } from "../engine/evaluator"
import { measureFrame, measureMotion } from "../engine/measure"
import { compositeOver, defaultResultName, isResultNode, resolveTarget, sheetLayout, type Rgba8Image, type Target } from "../engine/render"
import { resolveGraph, type Problem } from "../engine/validate"
import type { ResolvedNodeDef } from "../engine/nodeDef"
import { registry } from "../nodes"
import { formatValue, graphText, graphTextOps, GraphTextError, parseGraphText } from "./graphText"
import { generateFor } from "../ai/generation"
import { cleanSettings, exportFromApp, loadExportSettings } from "../export/run"
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

async function frameOf(graph: Graph, target: Target, frame: number, seed = session.getState().project.seed): Promise<{ image: Rgba8Image; gray: boolean }> {
  if (!engine) throw new ToolError("The GPU is not ready, so nothing can be rendered right now.")
  if (!Number.isInteger(frame) || frame < 0 || frame >= graph.settings.frames) {
    throw new ToolError(`Frame ${frame} is outside this graph's ${graph.settings.frames} frame(s) (0 to ${graph.settings.frames - 1}).`)
  }
  // The preview and thumbnails share this engine, so point it at our graph right before each evaluation.
  const { problems } = engine.setGraph(graph, seed)
  let result
  try {
    result = engine.evaluate(target.nodeId, target.output, frame)
  } catch (error) {
    const related = problems.map((p) => `${p.nodeId}: ${p.message}`).join(" ")
    throw new ToolError(`Cannot render ${target.nodeId}.${target.output}: ${error instanceof Error ? error.message : String(error)}${related ? ` Problems in the graph: ${related}` : ""}`)
  }
  const shaderError = (error: unknown): never => {
    throw new ToolError(`Cannot render ${target.nodeId}.${target.output}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const pixels = await engine.readPixels(result).catch(shaderError)
  await engine.settle().catch(shaderError)
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

const PROBLEMS_THAT_BLOCK: ReadonlySet<Problem["code"]> = new Set(["unknown_type", "unknown_param", "bad_param", "unknown_socket", "type_mismatch", "bad_driver", "bad_function"])

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
        if (usesGraph(registry.get(type)!, graph.id, registry)) throw new ToolError(`${where}: ${type} cannot be used in graph ${graph.id}, because that function would then contain itself.`)
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
        const extra = {
          ...(typeof op.function === "boolean" ? { function: op.function } : {}),
          ...(typeof op.description === "string" || op.description === null ? { description: op.description ? op.description : null } : {})
        }
        if (typeof op.name === "string" || Object.keys(settings).length > 0 || Object.keys(extra).length > 0) {
          ops.push({ op: "set_graph", graphId: graph.id, ...(typeof op.name === "string" ? { name: op.name } : {}), ...(Object.keys(settings).length > 0 ? { settings } : {}), ...extra })
        }
        if (typeof op.seed === "number" && op.seed !== projectSeed) ops.push({ op: "set_project", seed: op.seed })
        break
      }
      case "expose_param": {
        const id = need("id")
        const param = need("param")
        const node = graph.nodes.find((n) => n.id === id) ?? null
        // A node added earlier in this batch is not in the graph yet; the dry run checks those.
        const def = node && registry.get(node.type)
        if (def && !(param in def.params)) throw new ToolError(`${where}: ${node.type} has no parameter "${param}". It has: ${Object.keys(def.params).join(", ") || "none"}.`)
        ops.push({
          op: "expose_param",
          graphId: graph.id,
          id,
          param,
          ...(typeof op.as === "string" ? { as: op.as } : {}),
          ...(typeof op.label === "string" ? { label: op.label } : {})
        })
        touched.add(id)
        break
      }
      case "unexpose_param":
        ops.push({ op: "unexpose_param", graphId: graph.id, as: need("as") })
        break
      case "set_presets": {
        if (!Array.isArray(op.presets)) throw new ToolError(`${where} (set_presets) needs "presets": a list of { name, values }.`)
        ops.push({ op: "set_presets", graphId: graph.id, presets: op.presets as Preset[] })
        break
      }
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

function describeFunction(def: ResolvedNodeDef): string {
  const lines = [`inputs: ${Object.entries(def.inputs).map(([n, i]) => `${n}: ${i.type}`).join(", ") || "none"}`, `outputs: ${Object.entries(def.outputs).map(([n, t]) => `${n}: ${t}`).join(", ")}`]
  const params = Object.entries(def.params).map(([name, schema]) => `${name} (${schema.type}${schema.type === "gradient" ? "" : `, default ${formatValue(schema.default as ParamValue)}`})`)
  lines.push(`params: ${params.join(", ") || "none"}`)
  const presets = def.fn?.graph.presets?.map((p) => p.name) ?? []
  if (presets.length > 0) lines.push(`presets: ${presets.join(", ")}`)
  return lines.join("\n")
}

function listFunctions(): ToolResult {
  const { project } = session.getState()
  const parts: string[] = []
  const mine = project.graphs.filter((g) => g.function)
  parts.push(mine.length > 0 ? "In this project (use the type with add_node; get_graph shows what is inside):" : "This project has no functions yet.")
  for (const graph of mine) {
    const def = registry.get(functionType(graph.id))
    parts.push(`\n${functionType(graph.id)}  "${graph.name}"${graph.description ? `  ${graph.description}` : ""}\n${def ? describeFunction(def) : "Not usable as a node yet: it has no output node."}`)
  }
  const shipped = recipes.filter((r) => !mine.some((g) => g.id === r.id))
  if (shipped.length > 0) {
    parts.push("\nRecipes that ship with VFXForge (call add_function with the recipe id to copy one into the project):")
    for (const r of shipped) parts.push(`${r.id}  "${r.name}"  ${r.description}`)
  }
  return text(parts.join("\n"))
}

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
      ...(g.function ? { function: true, nodeType: functionType(g.id) } : {}),
      size: `${g.settings.width}x${g.settings.height}`,
      frames: g.settings.frames,
      fps: g.settings.fps,
      loop: g.settings.loop,
      nodes: g.nodes.length,
      outputs: g.nodes.filter((n) => isResultNode(n.type)).map((n) => ({ nodeId: n.id, name: n.params.name ?? defaultResultName(n.type), ...(n.type === "sheet_output" ? { sheet: true } : {}), ...(n.type === "packed_output" ? { packed: true } : {}) }))
    })),
    references: state.project.references.length,
    openComments: state.project.comments.filter((c) => !c.resolved && state.project.graphs.some((g) => g.id === c.graphId)).length,
    nodeTypes: registry.list().length
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
  const sockets = (def: ResolvedNodeDef): string =>
    `(${Object.entries(def.inputs).map(([n, i]) => `${n}: ${i.type}${i.optional ? "?" : ""}`).join(", ")}) -> (${Object.entries(def.outputs).map(([n, t]) => `${n}: ${t}`).join(", ")})`
  const nodeDefs = registry.list()
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

// ── References, comments, snapshots, variations (docs/05 §5.7) ──

const speaker = (agent: AgentIdentity): Speaker => ({ author: agent.name, agent: true })

/** Runs a board change for an agent; a refusal goes back to it as the tool's error. */
function board<T>(build: () => T): T {
  try {
    return build()
  } catch (error) {
    if (error instanceof BoardError || error instanceof BatchError) throw new ToolError(error.message)
    throw error
  }
}

/** Scales a picture down so its longer side is at most `limit`. */
async function fit(image: Rgba8Image, limit: number): Promise<Rgba8Image> {
  const scale = Math.min(1, limit / Math.max(image.width, image.height))
  if (scale === 1) return image
  const source = new OffscreenCanvas(image.width, image.height)
  source.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")!
  context.drawImage(source, 0, 0, width, height)
  return { width, height, data: context.getImageData(0, 0, width, height).data }
}

/** A picture of the same height as `height`, centered in a box `width` wide. */
async function boxed(image: Rgba8Image, width: number, height: number): Promise<Rgba8Image> {
  const scale = Math.min(width / image.width, height / image.height)
  const source = new OffscreenCanvas(image.width, image.height)
  source.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")!
  const w = image.width * scale
  const h = image.height * scale
  context.drawImage(source, (width - w) / 2, (height - h) / 2, w, h)
  return { width, height, data: context.getImageData(0, 0, width, height).data }
}

function listReferences(): ToolResult {
  const { references, snapshots = [] } = session.getState().project
  if (references.length === 0 && snapshots.length === 0) return text("The reference board is empty and there are no snapshots. The artist adds pictures under References; you can add one with add_reference if they gave you a file.")
  return json({
    references: references.map((r) => ({ id: r.id, name: r.name, note: r.note })),
    snapshots: snapshots.map((snap) => ({ id: snap.id, name: snap.name, graphId: snap.graphId, target: snap.target, frame: snap.frame, by: snap.by, time: snap.timestamp })),
    next: "get_reference shows one. render_compare puts one next to a render."
  })
}

/** A reference or a snapshot, by id. */
function boardPicture(id: unknown): { image: string; label: string; note?: string } {
  const { references, snapshots = [] } = session.getState().project
  const reference = references.find((r) => r.id === id)
  if (reference) return { image: reference.image, label: reference.name ?? reference.id, note: reference.note }
  const snap = snapshots.find((item) => item.id === id)
  if (snap) return { image: snap.image, label: snap.name }
  throw new ToolError(`There is no reference or snapshot "${String(id)}". References: ${references.map((r) => r.id).join(", ") || "none"}. Snapshots: ${snapshots.map((item) => item.id).join(", ") || "none"}.`)
}

async function pixelsOf(ref: string, label: string): Promise<Rgba8Image> {
  const pixels = ref ? await assetPixels(ref).catch(() => null) : null
  if (!pixels) throw new ToolError(`The picture of "${label}" cannot be found. It may have been moved away from the project's .assets folder.`)
  return pixels
}

async function getReference(args: Args): Promise<ToolResult> {
  const found = boardPicture(args.id)
  const image = await fit(await pixelsOf(found.image, found.label), 768)
  return { content: [{ type: "text", text: `${found.label}, ${image.width}x${image.height}${found.note ? `\nThe artist's note: ${found.note}` : ""}` }, picture(flatten(image, args.background))] }
}

async function addReferenceTool(agent: AgentIdentity, args: Args): Promise<ToolResult> {
  if (typeof args.path !== "string" || args.path.trim() === "") throw new ToolError('add_reference needs "path": the full path of an image file on this computer.')
  const result = await window.vfxforge?.importAssetPath(session.getState().path, args.path.trim())
  if (!result) throw new ToolError("Pictures cannot be read here.")
  if (!result.ok) throw new ToolError(result.error)
  const { op, id } = board(() => addReference(session.getState().project, result.ref, typeof args.name === "string" ? args.name : result.name, typeof args.note === "string" ? args.note : undefined))
  board(() => session.agentApply(agent, session.getState().activeGraphId ?? "", [op], "Add a reference", []))
  return text(`Added it to the reference board as ${id}.`)
}

async function renderCompare(args: Args): Promise<ToolResult> {
  const graph = graphOf(args)
  const target = targetOf(graph, args)
  const found = boardPicture(args.referenceId ?? args.id)
  const frame = typeof args.frame === "number" ? args.frame : 0
  const mine = (await frameOf(graph, target, frame)).image
  const other = await pixelsOf(found.image, found.label)
  // Same height, the reference keeps its proportions.
  const height = Math.min(512, Math.max(mine.height, 256))
  const left = await boxed(mine, Math.round((mine.width / mine.height) * height), height)
  const right = await boxed(other, Math.round((other.width / other.height) * height), height)
  const gap = 8
  const data = new Uint8ClampedArray((left.width + gap + right.width) * height * 4)
  const width = left.width + gap + right.width
  for (let y = 0; y < height; y++) {
    data.set(left.data.subarray(y * left.width * 4, (y + 1) * left.width * 4), y * width * 4)
    data.set(right.data.subarray(y * right.width * 4, (y + 1) * right.width * 4), (y * width + left.width + gap) * 4)
  }
  const colors = (image: Rgba8Image): unknown => measureFrame(image).dominantColors
  const facts = { left: { what: `${target.nodeId}.${target.output}, frame ${frame}`, dominantColors: colors(mine) }, right: { what: found.label, note: found.note, dominantColors: colors(other) } }
  return { content: [{ type: "text", text: `Left: your render. Right: ${found.label}.\n${JSON.stringify(facts, null, 1)}` }, picture(flatten({ width, height, data }, args.background))] }
}

function listComments(args: Args): ToolResult {
  const { project } = session.getState()
  const graphs = typeof args.graphId === "string" ? [graphOf(args)] : project.graphs
  const lines: string[] = []
  for (const graph of graphs) {
    for (const thread of threadsOf(project, graph.id)) {
      if (thread.resolved && args.includeResolved !== true) continue
      const node = thread.nodeId ? graph.nodes.find((n) => n.id === thread.nodeId) : undefined
      const last = thread.messages[thread.messages.length - 1]
      lines.push(`${thread.id}  graph ${graph.id}${node ? `, node ${node.id} (${node.type})` : ", the whole graph"}${thread.resolved ? "  resolved" : last.agent ? "  answered" : "  WAITING FOR AN ANSWER"}`)
      for (const m of thread.messages) lines.push(`   ${m.author}: ${m.text.replace(/\n/g, "\n      ")}`)
    }
  }
  if (lines.length === 0) return text(args.includeResolved === true ? "There are no comments." : "There are no open comments.")
  return text(`${lines.join("\n")}\n\nAnswer with reply (threadId, text). Fix what a comment asks for, then reply saying what you changed; add resolve: true when it is done.`)
}

function commentTool(agent: AgentIdentity, args: Args): ToolResult {
  const graph = graphOf(args)
  const nodeId = typeof args.nodeId === "string" && args.nodeId !== "" ? args.nodeId : undefined
  const { op, id } = board(() => addComment(session.getState().project, { graphId: graph.id, nodeId }, String(args.text ?? ""), speaker(agent)))
  board(() => session.agentApply(agent, graph.id, [op], nodeId ? `Comment on ${nodeId}` : "Comment on the graph", nodeId ? [nodeId] : []))
  return text(`Posted as thread ${id}. The artist sees it on ${nodeId ? `node ${nodeId}` : "the graph"}.`)
}

function replyTool(agent: AgentIdentity, args: Args): ToolResult {
  const { project } = session.getState()
  const thread = project.comments.find((c) => c.id === args.threadId)
  const op = board(() => replyToComment(project, String(args.threadId ?? ""), String(args.text ?? ""), speaker(agent), args.resolve === true))
  board(() => session.agentApply(agent, thread?.graphId ?? session.getState().activeGraphId ?? "", [op], args.resolve === true ? "Answer and resolve a comment" : "Answer a comment", thread?.nodeId ? [thread.nodeId] : []))
  return text(args.resolve === true ? "Answered, and the thread is resolved." : "Answered.")
}

async function snapshotTool(agent: AgentIdentity, args: Args): Promise<ToolResult> {
  const graph = graphOf(args)
  const target = targetOf(graph, args)
  const frame = typeof args.frame === "number" ? args.frame : 0
  const { image } = await frameOf(graph, target, frame)
  const { op, id } = await snapshotOp(image, { graphId: graph.id, target: `${target.nodeId}.${target.output}`, frame, name: typeof args.name === "string" ? args.name : undefined, by: agent.name }).catch((error: unknown) => {
    throw new ToolError(error instanceof Error ? error.message : "The snapshot could not be stored.")
  })
  board(() => session.agentApply(agent, graph.id, [op], "Take a snapshot", []))
  return text(`Saved snapshot ${id} of ${target.nodeId}.${target.output}, frame ${frame}. Compare a later render with it using render_compare (referenceId: "${id}"). The artist finds it under Compare in the Preview.`)
}

async function variationsTool(agent: AgentIdentity, args: Args): Promise<ToolResult> {
  const graph = graphOf(args)
  const target = targetOf(graph, args)
  const frame = typeof args.frame === "number" ? args.frame : 0
  const { project } = session.getState()
  let variations: Variation[]
  if (Array.isArray(args.variations) && args.variations.length > 0) {
    variations = (args.variations as Record<string, unknown>[]).map((raw, i) => ({
      label: typeof raw?.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 40) : `variation ${i + 1}`,
      ...(typeof raw?.seed === "number" ? { seed: raw.seed } : {}),
      ...(raw?.params && typeof raw.params === "object" ? { params: raw.params as Variation["params"] } : {})
    }))
  } else if (typeof args.seeds === "number") variations = seedVariations(project.seed, args.seeds)
  else throw new ToolError('render_variations needs "variations" (a list of { label, params?, seed? }) or "seeds" (how many other seeds to try).')
  if (variations.length < 2 || variations.length > MAX_VARIATIONS) throw new ToolError(`Give 2 to ${MAX_VARIATIONS} variations.`)
  const items: { variation: Variation; image: Rgba8Image }[] = []
  for (const variation of variations) {
    let variant: Graph
    try {
      variant = variantGraph(graph, variation, registry)
    } catch (error) {
      throw new ToolError(`"${variation.label}": ${error instanceof Error ? error.message : String(error)}`)
    }
    items.push({ variation, image: (await frameOf(variant, target, frame, variation.seed ?? project.seed)).image })
  }
  const cols = gridColumns(items.length)
  const sheet = contactSheet(items.map((item) => item.image), cols, 4)
  const list = items.map((item, i) => `${i + 1}. ${item.variation.label}`).join("\n")
  let note = `${target.nodeId}.${target.output}, frame ${frame}. ${items.length} variations in a grid of ${cols} columns, left to right then top to bottom:\n${list}\nNothing in the graph was changed.`
  if (args.offer === true) {
    offerVariations({ from: agent.name, graphId: graph.id, target: `${target.nodeId}.${target.output}`, note: typeof args.note === "string" ? args.note.slice(0, 300) : undefined, items })
    session.agentLog(agent.name, `Offered ${items.length} variations`)
    note += "\nThe artist now sees these in a grid and can click one; their pick is applied as their own step. Ask them which they chose, or read get_history."
  } else note += "\nTo use one yourself, apply its values with set_params. To let the artist choose, call again with offer: true."
  return { content: [{ type: "text", text: note }, picture(flatten(sheet, args.background))] }
}

function applyText(agent: AgentIdentity, args: Args): ToolResult {
  const graph = graphOf(args)
  if (typeof args.text !== "string" || args.text.trim() === "") throw new ToolError('apply_text needs "text": the whole graph in the form get_graph returns.')
  let ops: Record<string, unknown>[]
  try {
    ops = graphTextOps(graph, parseGraphText(args.text, registry), registry)
  } catch (error) {
    if (error instanceof GraphTextError) throw new ToolError(`Nothing was changed. ${error.message}`)
    throw error
  }
  if (ops.length === 0) return text("The graph already is what the text says. Nothing was changed.")
  return apply(agent, { graphId: graph.id, label: args.label, ops })
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
        const asFunction = args.function === true
        const description = typeof args.description === "string" && args.description.trim() ? args.description.trim() : undefined
        session.agentApply(agent, id, [{ op: "add_graph", id, name, settings, ...(asFunction ? { function: true } : {}), ...(description ? { description } : {}) }], `Create ${asFunction ? "function" : "graph"} "${name}"`, [])
        if (args.open === true) session.setActiveGraph(id)
        return text(
          `Created ${asFunction ? "function" : "graph"} ${id} "${name}".${args.open === true ? " It is now open in the editor." : ""}${
            asFunction ? ` Once it has an output node, other graphs can use it as node type ${functionType(id)}.` : ""
          }`
        )
      }
      case "list_references":
        return listReferences()
      case "get_reference":
        return await getReference(args)
      case "add_reference":
        return await addReferenceTool(agent, args)
      case "render_compare":
        return await renderCompare(args)
      case "list_comments":
        return listComments(args)
      case "comment":
        return commentTool(agent, args)
      case "reply":
        return replyTool(agent, args)
      case "snapshot":
        return await snapshotTool(agent, args)
      case "render_variations":
        return await variationsTool(agent, args)
      case "apply_text":
        return applyText(agent, args)
      case "list_functions":
        return listFunctions()
      case "create_function": {
        const graph = graphOf(args)
        const ids = Array.isArray(args.nodeIds) ? (args.nodeIds as unknown[]).map(String) : []
        const missing = ids.filter((id) => !graph.nodes.some((n) => n.id === id))
        if (missing.length > 0) throw new ToolError(`Graph ${graph.id} has no node ${missing.join(", ")}.`)
        const locked = ids.filter((id) => graph.nodes.find((n) => n.id === id)?.locked)
        if (locked.length > 0) throw new ToolError(`${locked.join(", ")} ${locked.length === 1 ? "is" : "are"} locked by the artist, so they cannot be moved into a function.`)
        const plan = planFunctionFromNodes(session.getState().project.graphs, graph, ids, typeof args.name === "string" ? args.name : undefined)
        if ("error" in plan) throw new ToolError(plan.error)
        try {
          session.agentApply(agent, graph.id, plan.ops, `Make a function from ${ids.length} node${ids.length === 1 ? "" : "s"}`, [plan.nodeId])
        } catch (error) {
          if (error instanceof BatchError) throw new ToolError(`Nothing was changed. ${error.message}`)
          throw error
        }
        const def = registry.get(functionType(plan.functionId))
        return text(`Moved ${ids.join(", ")} into function ${plan.functionId}; node ${plan.nodeId} (${functionType(plan.functionId)}) stands in their place.${def ? `\n${describeFunction(def)}` : ""}`)
      }
      case "add_function": {
        const found = recipe(typeof args.recipe === "string" ? args.recipe : "")
        if (!found) throw new ToolError(`There is no recipe "${String(args.recipe)}". Recipes: ${recipes.map((r) => r.id).join(", ")}.`)
        const { project } = session.getState()
        const { ops, mainId } = importFunctionOps(project, found.graphs)
        if (ops.length > 0) session.agentApply(agent, session.getState().activeGraphId ?? mainId, ops, `Add the ${found.name} function`, [])
        const def = registry.get(functionType(mainId))
        return text(`${ops.length > 0 ? "Copied" : "The project already has"} ${found.name}. Add it with { "op": "add_node", "type": "${functionType(mainId)}" }.${def ? `\n${describeFunction(def)}` : ""}`)
      }
      case "export": {
        const last = loadExportSettings()
        const settings = cleanSettings({
          format: typeof args.format === "string" ? (args.format as never) : last.format,
          bitDepth: args.bitDepth === 16 ? 16 : args.bitDepth === 8 ? 8 : last.bitDepth,
          template: typeof args.fileName === "string" ? args.fileName : last.template
        })
        const only = Array.isArray(args.outputs) ? (args.outputs as unknown[]).map(String) : undefined
        const result = await exportFromApp({ folder: typeof args.folder === "string" && args.folder.trim() ? args.folder : null, settings, only, byAgent: true })
        if (!result.ok) throw new ToolError(result.error)
        session.agentLog(agent.name, `Exported ${result.files.length} ${result.files.length === 1 ? "texture" : "textures"}`)
        return text(`Wrote ${result.files.length} texture(s), each with a .vfxforge.json sidecar:\n${result.files.join("\n")}`)
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
