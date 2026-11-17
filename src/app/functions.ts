/** Editor commands for functions: make one from selected nodes, save one to a file, bring one in. */

import { functionFileText, importFunctionOps, nextId, parseFunctionFile, parseSocketRef, ParseError, type Graph, type Node, type Op } from "../doc"
import { functionType } from "../engine/functions"
import { isResultNode } from "../engine/render"
import { resolveGraph } from "../engine/validate"
import { registry } from "../nodes"
import { recipe } from "../library/recipes"
import { addNodeAtCenter, nodeTitle } from "./commands"
import { session } from "./session"

function snake(text: string, fallback: string, taken: Set<string>): string {
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

export type FunctionPlan = { ops: Op[]; functionId: string; nodeId: string } | { error: string }

/**
 * Moves `ids` out of `graph` into a new function and puts one node in their
 * place. Wires that crossed the selection become the function's inputs and
 * outputs; a parameter driven from outside becomes a parameter of the function.
 */
export function planFunctionFromNodes(graphs: readonly Graph[], graph: Graph, ids: readonly string[], name?: string): FunctionPlan {
  const chosen = new Set(ids.filter((id) => graph.nodes.some((n) => n.id === id)))
  const nodes = graph.nodes.filter((n) => chosen.has(n.id))
  if (nodes.length === 0) return { error: "Select the nodes that should become a function first." }
  if (nodes.some((n) => isResultNode(n.type))) return { error: "Leave Output nodes out of the selection: they stay in this graph." }
  const inside = (ref: string): boolean => chosen.has(parseSocketRef(ref)!.nodeId)
  for (const other of graph.nodes) {
    if (chosen.has(other.id)) continue
    if (Object.values(other.driven).some(inside)) return { error: `"${nodeTitle(other)}" has a parameter driven by one of the selected nodes. Select it too, or stop driving it first.` }
  }

  const { outputTypes } = resolveGraph(graph, registry)
  const functionId = nextId(graphs.map((g) => g.id), "f")
  const takenIds = nodes.map((n) => n.id)
  const inner: Node[] = nodes.map((n) => ({ ...n, version: 1, driven: { ...n.driven } }))
  const innerLinks = graph.links.filter((l) => inside(l.from) && inside(l.to)).map((l) => ({ ...l }))
  const left = Math.min(...nodes.map((n) => n.position[0]))
  const right = Math.max(...nodes.map((n) => n.position[0]))
  const top = Math.min(...nodes.map((n) => n.position[1]))

  // Wires coming in: one input per source socket.
  const inputNames = new Set<string>()
  const inputOf = new Map<string, string>()
  const outer: Op[] = []
  let row = 0
  for (const link of graph.links) {
    if (!inside(link.to) || inside(link.from)) continue
    let input = inputOf.get(link.from)
    if (input === undefined) {
      const to = parseSocketRef(link.to)!
      input = snake(to.socket === "in" ? nodeTitle(graph.nodes.find((n) => n.id === parseSocketRef(link.from)!.nodeId)!) : to.socket, "in", inputNames)
      inputOf.set(link.from, input)
      const id = nextId(takenIds, "in")
      takenIds.push(id)
      inner.push({ id, type: "graph_input", position: [left - 200, top + row++ * 160], params: { name: input, ...(outputTypes.get(link.from) === "color" ? { kind: "color" } : {}) }, driven: {}, version: 1 })
      innerLinks.push({ from: `${id}.out`, to: link.to })
      inputOf.set(`#${link.from}`, id)
    } else {
      innerLinks.push({ from: `${inputOf.get(`#${link.from}`)!}.out`, to: link.to })
    }
  }

  // Wires going out: one output per source socket. Without any, every node nothing else reads becomes an output.
  const leaving = graph.links.filter((l) => inside(l.from) && !inside(l.to))
  const sources = [...new Set(leaving.map((l) => l.from))]
  if (sources.length === 0) {
    for (const node of nodes) {
      const def = registry.get(node.type)
      const first = def && Object.keys(def.outputs)[0]
      if (!first || outputTypes.get(`${node.id}.${first}`) === "value" || outputTypes.get(`${node.id}.${first}`) === undefined) continue
      if (!innerLinks.some((l) => parseSocketRef(l.from)!.nodeId === node.id)) sources.push(`${node.id}.${first}`)
    }
  }
  if (sources.length === 0) return { error: "The selected nodes make no image, so the function would have no output." }
  const outputNames = new Set<string>()
  const outputOf = new Map<string, string>()
  row = 0
  for (const from of sources) {
    const source = parseSocketRef(from)!
    if (outputTypes.get(from) === "value") return { error: "A value leaves the selection through a wire. Functions pass images only; select the node it goes to as well." }
    const title = nodeTitle(graph.nodes.find((n) => n.id === source.nodeId)!)
    const output = snake(sources.length === 1 ? "out" : source.socket === "out" ? title : `${title} ${source.socket}`, "out", outputNames)
    outputOf.set(from, output)
    const id = nextId(takenIds, "out")
    takenIds.push(id)
    inner.push({ id, type: "output", position: [right + 200, top + row++ * 160], params: { name: output }, driven: {}, version: 1 })
    innerLinks.push({ from, to: `${id}.in` })
  }

  // Parameters driven from outside: exposed on the function, and driven there instead.
  const exposed: Graph["exposed"] = []
  const exposedNames = new Set<string>([...inputNames])
  const drivers: [string, string][] = []
  for (const node of inner) {
    for (const [param, ref] of Object.entries(node.driven)) {
      if (inside(ref)) continue
      const as = snake(`${node.id} ${param}`, "p", exposedNames)
      exposed.push({ nodeId: node.id, param, as })
      drivers.push([as, ref])
      delete node.driven[param]
    }
  }

  const fn: Graph = {
    id: functionId,
    name: name?.trim() || `Function ${graphs.filter((g) => g.function).length + 1}`,
    function: true,
    settings: { ...graph.settings },
    nodes: inner,
    links: innerLinks.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0)),
    frames: [],
    exposed
  }

  const nodeId = nextId(graph.nodes.map((n) => n.id), "n")
  const middle: [number, number] = [Math.round((left + right) / 16) * 8, Math.round(nodes.reduce((sum, n) => sum + n.position[1], 0) / nodes.length / 8) * 8]
  const ops: Op[] = [{ op: "restore_graph", graph: fn, index: graphs.length }]
  for (const node of nodes) ops.push({ op: "remove_node", graphId: graph.id, id: node.id })
  ops.push({ op: "add_node", graphId: graph.id, type: functionType(functionId), id: nodeId, position: middle })
  for (const [from, input] of inputOf) if (!from.startsWith("#")) ops.push({ op: "connect", graphId: graph.id, from, to: `${nodeId}.${input}` })
  for (const link of leaving) ops.push({ op: "connect", graphId: graph.id, from: `${nodeId}.${outputOf.get(link.from)!}`, to: link.to })
  for (const [as, ref] of drivers) ops.push({ op: "drive_param", graphId: graph.id, id: nodeId, param: as, from: ref })
  return { ops: [...ops, ...outer], functionId, nodeId }
}

export function makeFunctionFromSelection(): void {
  const { activeGraph, selection, project } = session.getState()
  if (!activeGraph) return
  const plan = planFunctionFromNodes(project.graphs, activeGraph, selection)
  if ("error" in plan) {
    session.say(plan.error, true)
    return
  }
  if (session.apply(plan.ops, "Make a function")) {
    session.select([plan.nodeId])
    session.say("Made a function. Open it from the Graphs list to change what is inside.")
  }
}

/** Saves a function, with the functions it uses, as a file the artist picks. */
export async function exportFunction(graphId: string): Promise<void> {
  const { project } = session.getState()
  const graph = project.graphs.find((g) => g.id === graphId)
  if (!graph || !window.vfxforge) return
  const path = await window.vfxforge.saveFunctionFile(functionFileText(project, graphId), graph.name)
  if (path) session.say(`Saved the function to ${path}.`)
}

/** Adds the graphs of a function file to the project. Returns the function's node type, or null with a message shown. */
export function importFunctionText(text: string, label: string): string | null {
  let graphs: Graph[]
  try {
    graphs = parseFunctionFile(text)
  } catch (error) {
    session.say(error instanceof ParseError ? `This is not a function file: ${error.message}` : "This file cannot be read as a function.", true)
    return null
  }
  const { ops, mainId } = importFunctionOps(session.getState().project, graphs)
  if (ops.length > 0 && !session.apply(ops, label)) return null
  return functionType(mainId)
}

export async function importFunctionFromFile(): Promise<void> {
  const text = await window.vfxforge?.openFunctionFile()
  if (typeof text !== "string") return
  const type = importFunctionText(text, "Import function")
  if (type) session.say("The function is in the project. Find it under Functions in the Library.")
}

/** Puts a shipped recipe on the canvas. The first use copies the function into the project. */
export function addRecipe(id: string): void {
  const found = recipe(id)
  if (!found) return
  const type = importFunctionText(found.text, `Add the ${found.name} function`)
  if (type) addNodeAtCenter(type)
}
