/** Where nodes added without a position go: next to what they connect to, never on top of another card. */

import { LAYOUT, parseSocketRef, type Graph } from "../doc"

const CARD = { width: 136, height: 152 }

export function placeNewNodes(graph: Graph, newIds: readonly string[]): Map<string, [number, number]> {
  const position = new Map<string, [number, number]>()
  const pending = new Set(newIds)
  for (const node of graph.nodes) if (!pending.has(node.id)) position.set(node.id, node.position)

  const sources = new Map<string, string[]>()
  const consumers = new Map<string, string[]>()
  const edge = (from: string, to: string): void => {
    sources.set(to, [...(sources.get(to) ?? []), from])
    consumers.set(from, [...(consumers.get(from) ?? []), to])
  }
  for (const link of graph.links) {
    const from = parseSocketRef(link.from)
    const to = parseSocketRef(link.to)
    if (from && to) edge(from.nodeId, to.nodeId)
  }
  for (const node of graph.nodes) {
    for (const ref of Object.values(node.driven)) {
      const from = parseSocketRef(ref)
      if (from) edge(from.nodeId, node.id)
    }
  }

  const free = (x: number, y: number): [number, number] => {
    const taken = [...position.values()]
    while (taken.some(([px, py]) => Math.abs(px - x) < CARD.width && Math.abs(py - y) < CARD.height)) y += LAYOUT.rowGap
    return [Math.round(x / 8) * 8, Math.round(y / 8) * 8]
  }
  const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length

  const result = new Map<string, [number, number]>()
  const place = (id: string): void => {
    const placedSources = (sources.get(id) ?? []).filter((s) => position.has(s)).map((s) => position.get(s)!)
    const placedConsumers = (consumers.get(id) ?? []).filter((c) => position.has(c)).map((c) => position.get(c)!)
    let spot: [number, number]
    if (placedSources.length > 0) {
      spot = free(Math.max(...placedSources.map((p) => p[0])) + LAYOUT.columnGap, mean(placedSources.map((p) => p[1])))
    } else if (placedConsumers.length > 0) {
      spot = free(Math.min(...placedConsumers.map((p) => p[0])) - LAYOUT.columnGap, mean(placedConsumers.map((p) => p[1])))
    } else {
      const all = [...position.values()]
      spot = all.length === 0 ? [0, 0] : free(Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1])) + LAYOUT.rowGap)
    }
    position.set(id, spot)
    result.set(id, spot)
    pending.delete(id)
  }

  // Sources first, so each node lands to the right of what feeds it.
  while (pending.size > 0) {
    const ready = [...pending].find((id) => (sources.get(id) ?? []).every((s) => !pending.has(s)))
    place(ready ?? [...pending][0])
  }
  return result
}
