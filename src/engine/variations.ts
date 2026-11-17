/**
 * Variations of a graph (docs/05 §5.7): the same graph with another seed or
 * other parameter values, rendered side by side so the artist or an agent can
 * pick one. Nothing here changes the document.
 */

import type { Graph, ParamValue } from "../doc/types"
import type { NodeRegistry } from "./nodeDef"
import { checkParam } from "./nodeDef"
import type { Rgba8Image } from "./render"
import type { Variation } from "./sweep"

export { parseSweep, sweepValues, type Variation } from "./sweep"

export const MAX_VARIATIONS = 16

/** The graph with a variation's parameter values set. Throws with a plain message when a node or parameter does not exist or a value does not fit. */
export function variantGraph(graph: Graph, variation: Variation, registry: NodeRegistry): Graph {
  const changes = variation.params ?? {}
  for (const [nodeId, values] of Object.entries(changes)) {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Graph "${graph.id}" has no node "${nodeId}".`)
    const def = registry.get(node.type)
    for (const [param, value] of Object.entries(values ?? {})) {
      const schema = def?.params[param]
      if (!schema) throw new Error(`${node.type} has no parameter "${param}".${def ? ` It has: ${Object.keys(def.params).join(", ")}.` : ""}`)
      const problem = checkParam(schema, value)
      if (problem) throw new Error(`${nodeId}.${param}: ${problem}`)
    }
  }
  if (Object.keys(changes).length === 0) return graph
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const values = changes[n.id]
      if (!values) return n
      // A value set here wins over whatever drives the parameter, or the variation would show nothing.
      const driven = { ...n.driven }
      for (const param of Object.keys(values)) delete driven[param]
      return { ...n, params: { ...n.params, ...values }, driven }
    })
  }
}

/** `count` seeds, starting after `base`. */
export function seedVariations(base: number, count: number): Variation[] {
  return Array.from({ length: count }, (_, i) => ({ label: `seed ${base + i + 1}`, seed: base + i + 1 }))
}

/** Images of one size in a grid, left to right then top to bottom, with `gap` transparent pixels between them. */
export function contactSheet(images: readonly Rgba8Image[], cols: number, gap = 0): Rgba8Image {
  const { width, height } = images[0]
  const rows = Math.ceil(images.length / cols)
  const sheetWidth = width * cols + gap * (cols - 1)
  const data = new Uint8ClampedArray(sheetWidth * (height * rows + gap * (rows - 1)) * 4)
  images.forEach((image, i) => {
    const left = (i % cols) * (width + gap)
    const top = Math.floor(i / cols) * (height + gap)
    for (let y = 0; y < height; y++) data.set(image.data.subarray(y * width * 4, (y + 1) * width * 4), ((top + y) * sheetWidth + left) * 4)
  })
  return { width: sheetWidth, height: height * rows + gap * (rows - 1), data }
}

/** Columns for a grid that is as square as it can be, wider than tall. */
export function gridColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)))
}
