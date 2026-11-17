/**
 * Schema validation of a graph against the node registry. The document layer
 * only checks structure; this adds meaning: known types, real sockets,
 * compatible data types, parameter values in range.
 */

import { parseSocketRef, type Graph, type Node, type ParamValue } from "../doc/types"
import { checkParam, isDrivable, type DataType, type NodeRegistry, type ResolvedNodeDef } from "./nodeDef"

export type Problem = {
  nodeId: string
  /** Stable code for tools; `message` is for people. */
  code: "unknown_type" | "unknown_param" | "bad_param" | "unknown_socket" | "type_mismatch" | "missing_input" | "bad_driver" | "bad_function"
  message: string
}

export type ResolvedGraph = {
  problems: Problem[]
  /** Data type of each output socket, by "nodeId.output". Absent for nodes with errors upstream of the type. */
  outputTypes: Map<string, DataType>
  /** Nodes in evaluation order (sources first). */
  order: Node[]
}

export function topologicalOrder(graph: Graph): Node[] {
  const sources = new Map<string, Set<string>>(graph.nodes.map((n) => [n.id, new Set<string>()]))
  for (const link of graph.links) {
    const from = parseSocketRef(link.from)
    const to = parseSocketRef(link.to)
    if (from && to) sources.get(to.nodeId)?.add(from.nodeId)
  }
  for (const node of graph.nodes) {
    for (const ref of Object.values(node.driven)) {
      const from = parseSocketRef(ref)
      if (from) sources.get(node.id)?.add(from.nodeId)
    }
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const order: Node[] = []
  const state = new Map<string, 1 | 2>()
  const visit = (node: Node): void => {
    if (state.has(node.id)) return
    state.set(node.id, 1)
    for (const id of sources.get(node.id) ?? []) {
      const source = byId.get(id)
      if (source && state.get(id) !== 1) visit(source)
    }
    state.set(node.id, 2)
    order.push(node)
  }
  for (const node of graph.nodes) visit(node)
  return order
}

function accepts(input: string, actual: DataType): boolean {
  if (input === "image") return actual !== "value"
  // A gray image fits a color input (it is read as r = g = b).
  if (input === "color") return actual !== "value"
  return input === actual
}

const checking = new Set<Graph>()

/** What stops a function graph from being used, or null. Looks inside nested functions; a function that uses itself is caught here. */
function functionProblems(graph: Graph, registry: NodeRegistry): string | null {
  if (checking.has(graph)) return `Function "${graph.name}" uses itself.`
  checking.add(graph)
  try {
    const first = resolveGraph(graph, registry).problems[0]
    return first ? `Function "${graph.name}" has a problem at node ${first.nodeId}: ${first.message}` : null
  } finally {
    checking.delete(graph)
  }
}

export function resolveGraph(graph: Graph, registry: NodeRegistry): ResolvedGraph {
  const problems: Problem[] = []
  const outputTypes = new Map<string, DataType>()
  const order = topologicalOrder(graph)
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const linkByTarget = new Map(graph.links.map((l) => [l.to, l.from]))
  const defOf = (id: string): ResolvedNodeDef | undefined => {
    const node = byId.get(id)
    return node ? registry.get(node.type) : undefined
  }

  for (const node of order) {
    const def = registry.get(node.type)
    if (!def) {
      problems.push({ nodeId: node.id, code: "unknown_type", message: `Unknown node type "${node.type}".` })
      continue
    }

    for (const [name, value] of Object.entries(node.params)) {
      const schema = def.params[name]
      if (!schema) {
        problems.push({ nodeId: node.id, code: "unknown_param", message: `"${node.type}" has no parameter "${name}".` })
        continue
      }
      const problem = checkParam(schema, value)
      if (problem) problems.push({ nodeId: node.id, code: "bad_param", message: `Parameter "${name}" ${problem}.` })
    }

    if (def.fn) {
      const inside = functionProblems(def.fn.graph, registry)
      if (inside) problems.push({ nodeId: node.id, code: "bad_function", message: inside })
    }

    if (def.check) {
      const merged: Record<string, ParamValue> = {}
      for (const [name, schema] of Object.entries(def.params)) merged[name] = node.params[name] ?? (schema.default as ParamValue)
      const problem = def.check(merged)
      if (problem) problems.push({ nodeId: node.id, code: "bad_param", message: problem })
    }

    for (const [param, ref] of Object.entries(node.driven)) {
      const schema = def.params[param]
      const from = parseSocketRef(ref)!
      const fromDef = defOf(from.nodeId)
      if (!schema) {
        problems.push({ nodeId: node.id, code: "unknown_param", message: `"${node.type}" has no parameter "${param}".` })
      } else if (!isDrivable(schema)) {
        problems.push({ nodeId: node.id, code: "bad_driver", message: `Parameter "${param}" cannot be driven by an input.` })
      } else if (fromDef && !(from.socket in fromDef.outputs)) {
        problems.push({ nodeId: node.id, code: "unknown_socket", message: `"${ref}" is not an output.` })
      } else if (fromDef && fromDef.outputs[from.socket] !== "value") {
        problems.push({ nodeId: node.id, code: "bad_driver", message: `Parameter "${param}" needs a value, "${ref}" is an image.` })
      }
    }

    const inputTypes: Record<string, DataType | undefined> = {}
    for (const [target, source] of linkByTarget) {
      const to = parseSocketRef(target)!
      if (to.nodeId !== node.id) continue
      const input = def.inputs[to.socket]
      if (!input) {
        problems.push({ nodeId: node.id, code: "unknown_socket", message: `"${node.type}" has no input "${to.socket}".` })
        continue
      }
      const from = parseSocketRef(source)!
      const fromDef = defOf(from.nodeId)
      if (fromDef && !(from.socket in fromDef.outputs)) {
        problems.push({ nodeId: node.id, code: "unknown_socket", message: `"${source}" is not an output.` })
        continue
      }
      const actual = outputTypes.get(source)
      if (!actual) continue
      if (!accepts(input.type, actual)) {
        problems.push({
          nodeId: node.id,
          code: "type_mismatch",
          message: `Input "${to.socket}" needs ${input.type === "value" ? "a value" : "an image"}, "${source}" is ${actual === "value" ? "a value" : "an image"}.`
        })
        continue
      }
      inputTypes[to.socket] = actual
    }

    for (const [name, input] of Object.entries(def.inputs)) {
      if (!input.optional && !linkByTarget.has(`${node.id}.${name}`)) {
        problems.push({ nodeId: node.id, code: "missing_input", message: `Input "${name}" is not connected.` })
      }
    }

    for (const [name, type] of Object.entries(def.outputs)) {
      const resolved: DataType = type.startsWith("same:")
        ? (inputTypes[type.slice(5)] ?? "color")
        : type.startsWith("param:")
          ? ((node.params[type.slice(6)] ?? def.params[type.slice(6)].default) === "gray" ? "gray" : "color")
          : (type as DataType)
      outputTypes.set(`${node.id}.${name}`, resolved)
    }
  }

  return { problems, outputTypes, order }
}
