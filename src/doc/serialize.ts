/**
 * `.vfxf` text format (docs/06 §6.3): pretty JSON with a fixed key order and
 * one line per node and link, so diffs of agent edits stay readable.
 */

import { hasCycle } from "./ops"
import {
  DEFAULT_GRAPH_SETTINGS,
  parseSocketRef,
  type Graph,
  type Link,
  type Node,
  type ParamValue,
  type Project
} from "./types"

export const FILE_VERSION = 1

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ParseError"
  }
}

function sortKeys(value: ParamValue): ParamValue {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === "object") {
    const out: Record<string, ParamValue> = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key])
    return out
  }
  return value
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const key of Object.keys(record).sort()) out[key] = record[key]
  return out
}

/** One node, fixed key order, empty and default fields left out. */
function nodeLine(node: Node): string {
  const out: Record<string, unknown> = { id: node.id, type: node.type }
  if (node.name) out.name = node.name
  out.position = node.position
  if (Object.keys(node.params).length > 0) out.params = sortKeys(node.params)
  if (Object.keys(node.driven).length > 0) out.driven = sortedRecord(node.driven)
  if (node.locked) out.locked = true
  if (node.bypass) out.bypass = true
  return JSON.stringify(out)
}

function linkLine(link: Link): string {
  return JSON.stringify({ from: link.from, to: link.to })
}

function lines(items: string[], indent: string): string {
  if (items.length === 0) return "[]"
  return `[\n${items.map((item) => `${indent}  ${item}`).join(",\n")}\n${indent}]`
}

function block(value: unknown, indent: string): string {
  return JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`)
}

function graphBlock(graph: Graph, indent: string): string {
  const inner = `${indent}  `
  const s = graph.settings
  const settings = { width: s.width, height: s.height, frames: s.frames, fps: s.fps, loop: s.loop, bitDepth: s.bitDepth }
  return [
    "{",
    `${inner}"id": ${JSON.stringify(graph.id)},`,
    `${inner}"name": ${JSON.stringify(graph.name)},`,
    `${inner}"settings": ${JSON.stringify(settings)},`,
    `${inner}"nodes": ${lines(graph.nodes.map(nodeLine), inner)},`,
    `${inner}"links": ${lines(graph.links.map(linkLine), inner)},`,
    `${inner}"frames": ${lines(graph.frames.map((f) => JSON.stringify(f)), inner)},`,
    `${inner}"exposed": ${lines(graph.exposed.map((e) => JSON.stringify(e)), inner)}`,
    `${indent}}`
  ].join("\n")
}

function graphList(graphs: Graph[], indent: string): string {
  if (graphs.length === 0) return "[]"
  return `[\n${graphs.map((g) => `${indent}  ${graphBlock(g, `${indent}  `)}`).join(",\n")}\n${indent}]`
}

/** Same project in, same bytes out. Node versions are runtime state and are not saved. */
export function serializeProject(project: Project): string {
  return [
    "{",
    `  "version": ${FILE_VERSION},`,
    `  "name": ${JSON.stringify(project.name)},`,
    `  "seed": ${project.seed},`,
    `  "graphs": ${graphList(project.graphs, "  ")},`,
    `  "functions": ${graphList(project.functions, "  ")},`,
    `  "gradients": ${block(project.gradients, "  ")},`,
    `  "references": ${block(project.references, "  ")},`,
    `  "comments": ${block(project.comments, "  ")}`,
    "}",
    ""
  ].join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function fail(path: string, message: string): never {
  throw new ParseError(`${path}: ${message}`)
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string" || value === "") fail(path, "expected a non-empty string")
  return value
}

function arr(value: unknown, path: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(path, "expected a list")
  return value
}

function parseNode(raw: unknown, path: string): Node {
  if (!isRecord(raw)) fail(path, "expected a node object")
  const position = raw.position
  if (!Array.isArray(position) || position.length !== 2 || !position.every((v) => typeof v === "number" && Number.isFinite(v))) {
    fail(`${path}.position`, "expected [x, y]")
  }
  if (raw.params !== undefined && !isRecord(raw.params)) fail(`${path}.params`, "expected an object")
  if (raw.driven !== undefined && !isRecord(raw.driven)) fail(`${path}.driven`, "expected an object")
  const driven: Record<string, string> = {}
  for (const [param, ref] of Object.entries(raw.driven ?? {})) {
    if (typeof ref !== "string" || !parseSocketRef(ref)) fail(`${path}.driven.${param}`, 'expected "nodeId.output"')
    driven[param] = ref
  }
  const node: Node = {
    id: str(raw.id, `${path}.id`),
    type: str(raw.type, `${path}.type`),
    position: [position[0], position[1]],
    params: { ...(raw.params as Record<string, ParamValue> | undefined) },
    driven,
    version: 1
  }
  if (typeof raw.name === "string" && raw.name) node.name = raw.name
  if (raw.locked === true) node.locked = true
  if (raw.bypass === true) node.bypass = true
  return node
}

function parseGraph(raw: unknown, path: string): Graph {
  if (!isRecord(raw)) fail(path, "expected a graph object")
  const settingsRaw = raw.settings === undefined ? {} : raw.settings
  if (!isRecord(settingsRaw)) fail(`${path}.settings`, "expected an object")
  const settings = { ...DEFAULT_GRAPH_SETTINGS, ...settingsRaw } as Graph["settings"]
  for (const key of ["width", "height", "frames"] as const) {
    if (!Number.isInteger(settings[key]) || settings[key] < 1) fail(`${path}.settings.${key}`, "expected a whole number of at least 1")
  }
  if (!(typeof settings.fps === "number" && settings.fps > 0)) fail(`${path}.settings.fps`, "expected a number above 0")

  const nodes = arr(raw.nodes, `${path}.nodes`).map((n, i) => parseNode(n, `${path}.nodes[${i}]`))
  const ids = new Set<string>()
  for (const node of nodes) {
    if (ids.has(node.id)) fail(`${path}.nodes`, `duplicate node id "${node.id}"`)
    ids.add(node.id)
  }

  const targets = new Set<string>()
  const links = arr(raw.links, `${path}.links`).map((l, i): Link => {
    const at = `${path}.links[${i}]`
    if (!isRecord(l)) fail(at, "expected a link object")
    const link = { from: str(l.from, `${at}.from`), to: str(l.to, `${at}.to`) }
    for (const end of ["from", "to"] as const) {
      const ref = parseSocketRef(link[end])
      if (!ref) fail(`${at}.${end}`, 'expected "nodeId.socket"')
      if (!ids.has(ref.nodeId)) fail(`${at}.${end}`, `unknown node "${ref.nodeId}"`)
    }
    if (targets.has(link.to)) fail(at, `input "${link.to}" already has a link`)
    targets.add(link.to)
    return link
  })
  links.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0))
  for (const node of nodes) {
    for (const [param, ref] of Object.entries(node.driven)) {
      if (!ids.has(parseSocketRef(ref)!.nodeId)) fail(`${path}.nodes.${node.id}.driven.${param}`, `unknown node in "${ref}"`)
    }
  }

  const graph: Graph = {
    id: str(raw.id, `${path}.id`),
    name: str(raw.name, `${path}.name`),
    settings,
    nodes,
    links,
    frames: arr(raw.frames, `${path}.frames`) as Graph["frames"],
    exposed: arr(raw.exposed, `${path}.exposed`) as Graph["exposed"]
  }
  if (hasCycle(graph)) fail(`${path}.links`, "the links form a loop")
  return graph
}

/** Reads `.vfxf` text. Throws `ParseError` naming the path of the first problem. */
export function parseProject(text: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new ParseError(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(raw)) fail("project", "expected an object")
  if (raw.version !== FILE_VERSION) {
    fail("project.version", `this build reads version ${FILE_VERSION}, the file says ${JSON.stringify(raw.version)}`)
  }
  const seed = raw.seed ?? 0
  if (typeof seed !== "number" || !Number.isInteger(seed)) fail("project.seed", "expected a whole number")

  const graphs = arr(raw.graphs, "project.graphs").map((g, i) => parseGraph(g, `project.graphs[${i}]`))
  const graphIds = new Set<string>()
  for (const graph of graphs) {
    if (graphIds.has(graph.id)) fail("project.graphs", `duplicate graph id "${graph.id}"`)
    graphIds.add(graph.id)
  }

  return {
    version: 1,
    name: str(raw.name, "project.name"),
    seed,
    graphs,
    functions: arr(raw.functions, "project.functions").map((g, i) => parseGraph(g, `project.functions[${i}]`)),
    gradients: arr(raw.gradients, "project.gradients") as Project["gradients"],
    references: arr(raw.references, "project.references") as Project["references"],
    comments: arr(raw.comments, "project.comments") as Project["comments"]
  }
}
