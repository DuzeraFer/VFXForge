/**
 * Rendering a graph target to 8-bit pixels: one frame, or all frames laid out
 * as a sheet. Shared by the headless CLI, golden tests and, later, the MCP
 * `render` tool, so they all produce the same pixels.
 */

import type { Graph } from "../doc/types"
import { EvalError, toRgba8, type Engine } from "./evaluator"
import type { NodeRegistry } from "./nodeDef"

export type Rgba8Image = { width: number; height: number; data: Uint8ClampedArray }

export type Target = { nodeId: string; output: string }

/**
 * Accepts "nodeId.output", "nodeId" (its first output), the name of an Output
 * node, or nothing (the graph's first Output node).
 */
export function resolveTarget(graph: Graph, registry: NodeRegistry, target?: string): Target {
  const firstOutput = (nodeId: string): Target => {
    const node = graph.nodes.find((n) => n.id === nodeId)!
    const def = registry.get(node.type)
    if (!def) throw new EvalError(nodeId, `Unknown node type "${node.type}".`)
    return { nodeId, output: Object.keys(def.outputs)[0] }
  }
  const outputs = graph.nodes.filter((n) => n.type === "output")
  if (!target) {
    if (outputs.length === 0) throw new Error(`Graph "${graph.id}" has no Output node. Name a node to render.`)
    return firstOutput(outputs[0].id)
  }
  const dot = target.indexOf(".")
  if (dot > 0) {
    const nodeId = target.slice(0, dot)
    if (graph.nodes.some((n) => n.id === nodeId)) return { nodeId, output: target.slice(dot + 1) }
  }
  if (graph.nodes.some((n) => n.id === target)) return firstOutput(target)
  const named = outputs.find((n) => (n.params.name ?? "output") === target)
  if (named) return firstOutput(named.id)
  throw new Error(`Graph "${graph.id}" has no node or output called "${target}".`)
}

export async function renderFrame(engine: Engine, target: Target, frame: number): Promise<Rgba8Image> {
  const image = engine.evaluate(target.nodeId, target.output, frame)
  return { width: image.width, height: image.height, data: toRgba8(await engine.readPixels(image)) }
}

export type SheetLayout = { cols: number; rows: number; frames: number }

export function sheetLayout(frames: number, cols?: number): SheetLayout {
  const c = Math.max(1, Math.min(frames, cols ?? Math.ceil(Math.sqrt(frames))))
  return { cols: c, rows: Math.ceil(frames / c), frames }
}

/** All frames, left to right then top to bottom. */
export async function renderSheet(engine: Engine, target: Target, frames: number, cols?: number): Promise<Rgba8Image & SheetLayout> {
  const layout = sheetLayout(frames, cols)
  let sheet: Rgba8Image | null = null
  for (let f = 0; f < frames; f++) {
    const frame = await renderFrame(engine, target, f)
    sheet ??= {
      width: frame.width * layout.cols,
      height: frame.height * layout.rows,
      data: new Uint8ClampedArray(frame.width * layout.cols * frame.height * layout.rows * 4)
    }
    const left = (f % layout.cols) * frame.width
    const top = Math.floor(f / layout.cols) * frame.height
    for (let y = 0; y < frame.height; y++) {
      const row = frame.data.subarray(y * frame.width * 4, (y + 1) * frame.width * 4)
      sheet.data.set(row, ((top + y) * sheet.width + left) * 4)
    }
  }
  return { ...sheet!, ...layout }
}

/** Flattens straight-alpha pixels onto an opaque color (0–255 per channel). */
export function compositeOver(image: Rgba8Image, background: [number, number, number]): Rgba8Image {
  const data = new Uint8ClampedArray(image.data.length)
  for (let i = 0; i < data.length; i += 4) {
    const a = image.data[i + 3] / 255
    data[i] = Math.round(image.data[i] * a + background[0] * (1 - a))
    data[i + 1] = Math.round(image.data[i + 1] * a + background[1] * (1 - a))
    data[i + 2] = Math.round(image.data[i + 2] * a + background[2] * (1 - a))
    data[i + 3] = 255
  }
  return { width: image.width, height: image.height, data }
}
