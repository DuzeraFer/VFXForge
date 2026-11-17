/** Auto-layout: columns by depth from the sources, so wires run left to right. */

import type { Op } from "./ops"
import { parseSocketRef, type Graph } from "./types"

export const LAYOUT = { columnGap: 176, rowGap: 176 } as const

/** Depth of each node: 0 for sources, otherwise one more than its deepest input. */
export function nodeDepths(graph: Graph): Map<string, number> {
  const sources = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]))
  for (const link of graph.links) {
    const from = parseSocketRef(link.from)
    const to = parseSocketRef(link.to)
    if (from && to) sources.get(to.nodeId)?.push(from.nodeId)
  }
  for (const node of graph.nodes) {
    for (const ref of Object.values(node.driven)) {
      const from = parseSocketRef(ref)
      if (from) sources.get(node.id)?.push(from.nodeId)
    }
  }
  const depths = new Map<string, number>()
  const depthOf = (id: string): number => {
    const known = depths.get(id)
    if (known !== undefined) return known
    depths.set(id, 0) // guards against loops in damaged data
    const depth = Math.max(-1, ...(sources.get(id) ?? []).map(depthOf)) + 1
    depths.set(id, depth)
    return depth
  }
  for (const node of graph.nodes) depthOf(node.id)
  return depths
}

/** Ops that move the given nodes (default: all) into tidy columns. Order within a column follows the current vertical order. */
export function autoLayoutOps(graph: Graph, nodeIds?: readonly string[]): Op[] {
  const chosen = new Set(nodeIds ?? graph.nodes.map((n) => n.id))
  const depths = nodeDepths(graph)
  const nodes = graph.nodes.filter((n) => chosen.has(n.id))
  if (nodes.length === 0) return []
  const originX = Math.min(...nodes.map((n) => n.position[0]))
  const originY = Math.min(...nodes.map((n) => n.position[1]))
  const minDepth = Math.min(...nodes.map((n) => depths.get(n.id) ?? 0))

  const columns = new Map<number, typeof nodes>()
  for (const node of nodes) {
    const depth = (depths.get(node.id) ?? 0) - minDepth
    const column = columns.get(depth)
    if (column) column.push(node)
    else columns.set(depth, [node])
  }

  const ops: Op[] = []
  for (const [depth, column] of columns) {
    column.sort((a, b) => a.position[1] - b.position[1])
    column.forEach((node, row) => {
      const position: [number, number] = [originX + depth * LAYOUT.columnGap, originY + row * LAYOUT.rowGap]
      if (position[0] !== node.position[0] || position[1] !== node.position[1]) {
        ops.push({ op: "move_node", graphId: graph.id, id: node.id, position })
      }
    })
  }
  return ops
}
