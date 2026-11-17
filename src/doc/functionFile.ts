/**
 * Function files (`.vfxfn`): one function and the functions it uses, in the
 * same text format as a project, so they are read by the same checked parser.
 * The first graph is the function itself.
 */

import type { Op } from "./ops"
import { parseProject, ParseError, serializeProject } from "./serialize"
import { createProject, type Graph, type Project } from "./types"

const PREFIX = "fn_"

function usedFunctionIds(graph: Graph): string[] {
  return graph.nodes.filter((n) => n.type.startsWith(PREFIX)).map((n) => n.type.slice(PREFIX.length))
}

/** The function `graphId` with every function it needs, itself first. */
export function functionClosure(project: Project, graphId: string): Graph[] {
  const found: Graph[] = []
  const visit = (id: string): void => {
    const graph = project.graphs.find((g) => g.id === id && (g.function || id === graphId))
    if (!graph || found.includes(graph)) return
    found.push(graph)
    for (const inner of usedFunctionIds(graph)) visit(inner)
  }
  visit(graphId)
  return found
}

export function functionFileText(project: Project, graphId: string): string {
  const graphs = functionClosure(project, graphId).map((g) => ({ ...g, function: true }))
  if (graphs.length === 0) throw new Error(`There is no graph "${graphId}".`)
  return serializeProject({ ...createProject(graphs[0].name), graphs })
}

/** The graphs of a function file, the function itself first. Throws ParseError. */
export function parseFunctionFile(text: string): Graph[] {
  const graphs = parseProject(text).graphs
  if (graphs.length === 0) throw new ParseError("The file holds no function.")
  return graphs.map((g) => ({ ...g, function: true as const }))
}

function sameGraph(a: Graph, b: Graph): boolean {
  const strip = (g: Graph): string => serializeProject({ ...createProject("x"), graphs: [{ ...g, nodes: g.nodes.map((n) => ({ ...n, version: 1 })) }] })
  return strip(a) === strip(b)
}

/**
 * Ops that add a function file's graphs to a project. A graph the project
 * already holds unchanged is used as it is; one whose id is taken by something
 * else gets a new id, and the nodes that use it are pointed at that.
 */
export function importFunctionOps(project: Project, graphs: readonly Graph[]): { ops: Op[]; mainId: string } {
  const taken = new Set(project.graphs.map((g) => g.id))
  // Graphs the project cannot use as they stand: their id is taken by something else,
  // or they use a function that is. Repeated until nothing more changes, since one leads to the other.
  const clash = new Set<string>()
  for (let changed = true; changed; ) {
    changed = false
    for (const graph of graphs) {
      if (clash.has(graph.id)) continue
      const existing = project.graphs.find((g) => g.id === graph.id)
      if (!existing) continue
      if (!existing.function || !sameGraph(existing, graph) || usedFunctionIds(graph).some((id) => clash.has(id))) {
        clash.add(graph.id)
        changed = true
      }
    }
  }
  const renamed = new Map<string, string>()
  const fresh: Graph[] = []
  for (const graph of graphs) {
    if (!taken.has(graph.id)) {
      taken.add(graph.id)
      fresh.push(graph)
      continue
    }
    if (!clash.has(graph.id)) continue
    let id = `${graph.id}_2`
    for (let i = 3; taken.has(id); i++) id = `${graph.id}_${i}`
    taken.add(id)
    renamed.set(graph.id, id)
    fresh.push(graph)
  }
  const retarget = (graph: Graph): Graph => ({
    ...graph,
    id: renamed.get(graph.id) ?? graph.id,
    nodes: graph.nodes.map((n) => {
      const inner = n.type.startsWith(PREFIX) ? renamed.get(n.type.slice(PREFIX.length)) : undefined
      return inner ? { ...n, type: `${PREFIX}${inner}` } : n
    })
  })
  const ops: Op[] = fresh.map((graph, i) => ({ op: "restore_graph", graph: retarget(graph), index: project.graphs.length + i }))
  return { ops, mainId: renamed.get(graphs[0].id) ?? graphs[0].id }
}
