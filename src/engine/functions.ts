/**
 * Functions (docs/07 Phase 7): a graph used as a node in another graph.
 *
 * A function has no shader of its own. `functionDef` describes its node (the
 * sockets come from its Graph Input and Output nodes, the parameters from what
 * it exposes), and `expandFunctions` replaces every such node by a copy of the
 * function's nodes before the engine evaluates the graph, so the engine only
 * ever sees ordinary nodes.
 */

import { parseSocketRef, type Graph, type Link, type Node, type ParamValue } from "../doc/types"
import type { DataType, FunctionBinding, InputDef, NodeRegistry, OutputType, ParamSchema, ResolvedNodeDef } from "./nodeDef"
import { resolveGraph } from "./validate"

const PREFIX = "fn_"
/** Between a function node's id and the id of a node inside it. Ids typed by people cannot contain it. */
export const INNER = "~"
/** Marks a driver that comes from the graph around a function, one mark per level of nesting. */
const OUTSIDE = "^"
const MAX_DEPTH = 8

export function functionType(graphId: string): string {
  return `${PREFIX}${graphId}`
}

/** The graph id inside a function node type, or null for an ordinary type. */
export function functionIdOf(type: string): string | null {
  return type.startsWith(PREFIX) ? type.slice(PREFIX.length) : null
}

/** The node on the canvas that an id inside an expanded graph belongs to. */
export function outerNodeId(id: string): string {
  const at = id.indexOf(INNER)
  return at < 0 ? id : id.slice(0, at)
}

/** Whether a node of this type would put `graphId` inside itself: the type is that graph as a function, or a function that uses it. */
export function usesGraph(def: ResolvedNodeDef, graphId: string, registry: NodeRegistry): boolean {
  const seen = new Set<string>()
  const reaches = (graph: Graph): boolean => {
    if (graph.id === graphId) return true
    if (seen.has(graph.id)) return false
    seen.add(graph.id)
    return graph.nodes.some((n) => {
      const inner = registry.get(n.type)?.fn
      return inner ? reaches(inner.graph) : false
    })
  }
  return def.fn ? reaches(def.fn.graph) : false
}

/** A socket or parameter name from free text: lower case, digits and "_", starting with a letter, unique in `taken`. */
function socketName(text: string, fallback: string, taken: Set<string>): string {
  let name = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  if (!/^[a-z]/.test(name)) name = name ? `${fallback}_${name}` : fallback
  let unique = name
  for (let i = 2; taken.has(unique); i++) unique = `${name}_${i}`
  taken.add(unique)
  return unique
}

/**
 * The node type a function graph stands for, or null if it cannot be used as
 * a node (no Output inside). `registry` must know the node types used inside.
 */
export function functionDef(graph: Graph, registry: NodeRegistry): ResolvedNodeDef | null {
  const binding: FunctionBinding = { graph, inputs: {}, outputs: {}, params: {} }
  const inputs: Record<string, InputDef> = {}
  const outputs: Record<string, OutputType> = {}
  const params: Record<string, ParamSchema> = {}
  const resolved = resolveGraph(graph, registry)

  const inputNames = new Set<string>()
  const outputNames = new Set<string>()
  for (const node of graph.nodes) {
    if (node.type === "graph_input") {
      const name = socketName(String(node.params.name ?? "in"), "in", inputNames)
      binding.inputs[name] = node.id
      inputs[name] = { type: node.params.kind === "color" ? "color" : "gray", optional: true }
    } else if (node.type === "output") {
      const name = socketName(String(node.params.name ?? "output"), "out", outputNames)
      binding.outputs[name] = node.id
      const type: DataType | undefined = resolved.outputTypes.get(`${node.id}.out`)
      outputs[name] = type === "gray" ? "gray" : "color"
    }
  }
  if (Object.keys(outputs).length === 0) return null

  for (const exposed of graph.exposed) {
    const node = graph.nodes.find((n) => n.id === exposed.nodeId)
    const schema = node && registry.get(node.type)?.params[exposed.param]
    if (!node || !schema || exposed.as in inputs || exposed.as in params) continue
    const doc = [exposed.label, schema.doc].filter(Boolean).join(". ")
    params[exposed.as] = { ...schema, default: (node.params[exposed.param] ?? schema.default) as never, ...(doc ? { doc } : {}) }
    binding.params[exposed.as] = { nodeId: node.id, param: exposed.param }
  }

  return {
    type: functionType(graph.id),
    category: "Functions",
    doc: graph.description ?? `The graph "${graph.name}" used as a node.`,
    inputs,
    outputs,
    params,
    fn: binding
  }
}

export type Expanded = {
  graph: Graph
  /** "functionNode.output" -> the socket inside that produces it, or null when nothing does. */
  aliases: Map<string, string | null>
}

/**
 * Replaces every function node by the nodes of its function. Ids of the
 * copies are `<function node id>~<inner id>`. A graph without function nodes
 * comes back as it is.
 */
export function expandFunctions(graph: Graph, registry: NodeRegistry, depth = 0): Expanded {
  const aliases = new Map<string, string | null>()
  if (!graph.nodes.some((n) => registry.get(n.type)?.fn)) return { graph, aliases }
  if (depth >= MAX_DEPTH) throw new Error(`Functions are nested more than ${MAX_DEPTH} deep. A function probably uses itself.`)

  const feeds = new Map(graph.links.map((l) => [l.to, l.from]))
  const nodes: Node[] = []
  const links: Link[] = []

  for (const node of graph.nodes) {
    const fn = registry.get(node.type)?.fn
    if (!fn) {
      nodes.push(node)
      continue
    }
    // Values set on the function node go into a copy of the function before it is expanded,
    // so they also reach a parameter that the function exposes from a function of its own.
    const overrides = new Map<string, Record<string, ParamValue>>()
    const drivers = new Map<string, Record<string, string>>()
    for (const [name, target] of Object.entries(fn.params)) {
      if (name in node.params) overrides.set(target.nodeId, { ...overrides.get(target.nodeId), [target.param]: node.params[name] })
      if (name in node.driven) drivers.set(target.nodeId, { ...drivers.get(target.nodeId), [target.param]: node.driven[name] })
    }
    const patched: Graph =
      overrides.size === 0 && drivers.size === 0
        ? fn.graph
        : {
            ...fn.graph,
            nodes: fn.graph.nodes.map((n) => {
              const values = overrides.get(n.id)
              const driving = drivers.get(n.id)
              if (!values && !driving) return n
              // What is set or driven from outside wins over a driver inside the function.
              const driven = { ...n.driven }
              for (const param of Object.keys(values ?? {})) delete driven[param]
              // A driver from outside is marked, so that it is not taken for a node of the function.
              for (const [param, ref] of Object.entries(driving ?? {})) driven[param] = `${OUTSIDE}${ref}`
              return { ...n, params: { ...n.params, ...values }, driven }
            })
          }
    const inner = expandFunctions(patched, registry, depth + 1)
    const inside = (id: string): string => `${node.id}${INNER}${id}`
    const insideRef = (ref: string): string => {
      const parsed = parseSocketRef(ref)!
      return `${inside(parsed.nodeId)}.${parsed.socket}`
    }
    // An inner reference, after following the inner graph's own aliases, as a reference in this graph (or null).
    const resolveInner = (ref: string): string | null => {
      const alias = inner.aliases.has(ref) ? inner.aliases.get(ref)! : ref
      return alias === null ? null : insideRef(alias)
    }

    // Graph Input nodes that have something plugged in from outside are replaced by that wire.
    const plugged = new Map<string, string>()
    for (const [name, inputId] of Object.entries(fn.inputs)) {
      const from = feeds.get(`${node.id}.${name}`)
      if (from !== undefined) plugged.set(`${inside(inputId)}.out`, from)
    }
    const outputIds = new Set(Object.values(fn.outputs))

    for (const original of inner.graph.nodes) {
      const id = inside(original.id)
      if (plugged.has(`${id}.out`) || outputIds.has(original.id)) continue
      const driven: Record<string, string> = {}
      for (const [param, ref] of Object.entries(original.driven)) {
        const to = ref.startsWith(OUTSIDE) ? ref.slice(OUTSIDE.length) : resolveInner(ref)
        if (to !== null) driven[param] = to
      }
      nodes.push({ ...original, id, driven })
    }
    for (const link of inner.graph.links) {
      const to = parseSocketRef(link.to)!
      if (outputIds.has(to.nodeId)) continue
      const from = resolveInner(link.from)
      if (from !== null) links.push({ from, to: insideRef(link.to) })
    }
    const innerFeeds = new Map(inner.graph.links.map((l) => [l.to, l.from]))
    for (const [name, outputId] of Object.entries(fn.outputs)) {
      const from = innerFeeds.get(`${outputId}.in`)
      aliases.set(`${node.id}.${name}`, from === undefined ? null : resolveInner(from))
    }
    for (const [from, to] of plugged) aliases.set(from, to)
  }

  // Wires and drivers that pointed at a function node, or came out of a replaced Graph Input, now point at what stands there.
  const follow = (ref: string): string | null => {
    let current: string | null = ref
    for (let hops = 0; current !== null && aliases.has(current) && hops < 64; hops++) current = aliases.get(current)!
    return current
  }
  const isFunctionNode = (id: string): boolean => !!registry.get(graph.nodes.find((n) => n.id === id)?.type ?? "")?.fn
  for (const link of graph.links) {
    if (isFunctionNode(parseSocketRef(link.to)!.nodeId)) continue
    const from = follow(link.from)
    if (from !== null) links.push({ from, to: link.to })
  }
  const settled = nodes.map((n) => {
    let changed = false
    const driven: Record<string, string> = {}
    for (const [param, ref] of Object.entries(n.driven)) {
      const to = follow(ref)
      if (to !== ref) changed = true
      if (to !== null) driven[param] = to
    }
    return changed ? { ...n, driven } : n
  })
  const settledLinks = links.map((l) => {
    const from = follow(l.from)
    return from === l.from ? l : from === null ? null : { from, to: l.to }
  })
  for (const [key] of aliases) aliases.set(key, follow(key))

  return { graph: { ...graph, nodes: settled, links: settledLinks.filter((l): l is Link => l !== null) }, aliases }
}
