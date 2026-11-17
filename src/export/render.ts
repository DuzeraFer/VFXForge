/**
 * What a project exports and the pixels of each texture (docs/06 §6.7).
 * Used by the app, the agent tool and the command line, so all three write
 * the same files.
 */

import { parseSocketRef, type Graph, type Node, type ParamValue, type Project } from "../doc/types"
import type { Engine } from "../engine/evaluator"
import type { NodeRegistry, ResolvedNodeDef } from "../engine/nodeDef"
import { isResultNode } from "../engine/render"
import { sheetSize } from "../engine/sheet"
import { resolveGraph } from "../engine/validate"
import { DEEP_FORMATS, type ExportImage, type ExportSettings, type Sidecar } from "./types"

export type ExportTarget = {
  graphId: string
  graphName: string
  nodeId: string
  /** The Output node's name parameter. */
  name: string
  usage: string
  alpha: "straight" | "premultiplied"
  sheet: Sidecar["sheet"]
  packing: Sidecar["packing"]
}

function paramsOf(node: Node, def: ResolvedNodeDef): Record<string, ParamValue> {
  const values: Record<string, ParamValue> = {}
  for (const [name, schema] of Object.entries(def.params)) values[name] = name in node.params ? node.params[name] : (schema.default as ParamValue)
  return values
}

/** The sheet a result node writes, if it (or what an Output passes through) is a sheet node. */
function sheetOf(graph: Graph, node: Node, registry: NodeRegistry): Sidecar["sheet"] {
  let current: Node | undefined = node
  for (let hops = 0; current && hops < 8; hops++) {
    const def = registry.get(current.type)
    if (!def) return null
    if (def.assemble) {
      const id: string = current.id
      const connected = Object.keys(def.inputs).filter((name) => graph.links.some((l) => l.to === `${id}.${name}`))
      const plan = def.assemble({ params: paramsOf(current, def), connected, frame: 0, frames: graph.settings.frames })
      const size = sheetSize(plan, graph.settings.width, graph.settings.height)
      return { cols: size.cols, rows: size.rows, frames: plan.cells.length, fps: graph.settings.fps, loop: graph.settings.loop, padding: plan.padding }
    }
    if (!def.passthrough) return null
    const id: string = current.id
    const link = graph.links.find((l) => l.to.startsWith(`${id}.`))
    const from = link && parseSocketRef(link.from)
    current = from ? graph.nodes.find((n) => n.id === from.nodeId) : undefined
  }
  return null
}

/** What feeds each channel of a Packed Output. */
function packingOf(graph: Graph, node: Node): Sidecar["packing"] {
  if (node.type !== "packed_output") return null
  const source = (channel: string): string | null => {
    const link = graph.links.find((l) => l.to === `${node.id}.${channel}`)
    const from = link && parseSocketRef(link.from)
    const origin = from && graph.nodes.find((n) => n.id === from.nodeId)
    return origin ? (origin.name ?? origin.type) : null
  }
  return { r: source("r"), g: source("g"), b: source("b"), a: source("a") }
}

/** Every Output, Sheet Output and Packed Output of the project, in graph order. */
export function exportTargets(project: Project, registry: NodeRegistry): ExportTarget[] {
  const targets: ExportTarget[] = []
  for (const graph of project.graphs) {
    // A function is a building block; its outputs are sockets, not files.
    if (graph.function) continue
    for (const node of graph.nodes) {
      const def = registry.get(node.type)
      if (!def || !isResultNode(node.type)) continue
      const params = paramsOf(node, def)
      targets.push({
        graphId: graph.id,
        graphName: graph.name,
        nodeId: node.id,
        name: String(params.name),
        // A packed texture holds numbers, not a picture.
        usage: node.type === "packed_output" ? "mask" : String(params.usage),
        alpha: params.alpha === "premultiplied" ? "premultiplied" : "straight",
        sheet: sheetOf(graph, node, registry),
        packing: packingOf(graph, node)
      })
    }
  }
  return targets
}

/** File name (no extension) from the template. Unknown tokens stay as typed. */
export function exportName(template: string, target: Pick<ExportTarget, "graphName" | "name">, projectName: string): string {
  const filled = (template.trim() === "" ? "{output}" : template).replace(/\{(project|graph|output)\}/g, (_all, token: string) =>
    token === "project" ? projectName : token === "graph" ? target.graphName : target.name
  )
  return filled.trim()
}

/** Float pixels as displayed (straight alpha) to the integers that are written. */
export function quantize(pixels: Float32Array, depth: 8 | 16, premultiply: boolean): Uint8Array | Uint16Array {
  const max = depth === 16 ? 65535 : 255
  const out = depth === 16 ? new Uint16Array(pixels.length) : new Uint8Array(pixels.length)
  const unit = (v: number): number => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)))
  for (let i = 0; i < pixels.length; i += 4) {
    const a = unit(pixels[i + 3])
    const k = premultiply ? a : 1
    out[i] = Math.round(unit(pixels[i]) * k * max)
    out[i + 1] = Math.round(unit(pixels[i + 1]) * k * max)
    out[i + 2] = Math.round(unit(pixels[i + 2]) * k * max)
    out[i + 3] = Math.round(a * max)
  }
  return out
}

/** Picks targets by node id, output name or graph name. Nothing asked for means everything. */
export function pickTargets(targets: readonly ExportTarget[], only?: readonly string[]): ExportTarget[] {
  if (!only || only.length === 0) return [...targets]
  const missing = only.filter((want) => !targets.some((t) => t.name === want || t.nodeId === want || t.graphName === want))
  if (missing.length > 0) throw new Error(`No output called ${missing.map((m) => `"${m}"`).join(", ")}. Outputs: ${targets.map((t) => t.name).join(", ") || "none"}.`)
  return targets.filter((t) => only.includes(t.name) || only.includes(t.nodeId) || only.includes(t.graphName))
}

/** Renders the chosen outputs at full size, ready to be written. */
export async function renderExport(
  engine: Engine,
  project: Project,
  registry: NodeRegistry,
  settings: ExportSettings,
  projectName: string,
  only?: readonly string[]
): Promise<ExportImage[]> {
  const depth = settings.bitDepth === 16 && DEEP_FORMATS.includes(settings.format) ? 16 : 8
  const images: ExportImage[] = []
  for (const target of pickTargets(exportTargets(project, registry), only)) {
    const graph = project.graphs.find((g) => g.id === target.graphId)!
    const def = registry.get(graph.nodes.find((n) => n.id === target.nodeId)!.type)!
    const { outputTypes } = resolveGraph(graph, registry)
    const output = Object.keys(def.outputs)[0]
    // The preview shares this engine, so point it at the graph right before each evaluation.
    engine.setGraph(graph, project.seed)
    let result
    try {
      if (outputTypes.get(`${target.nodeId}.${output}`) === undefined) throw new Error("nothing is connected to it")
      result = engine.evaluate(target.nodeId, output, 0)
    } catch (error) {
      throw new Error(`Cannot export "${target.name}" (${graph.name}): ${error instanceof Error ? error.message : String(error)}`)
    }
    const pixels = await engine.readPixels(result)
    images.push({
      name: exportName(settings.template, target, projectName),
      width: result.width,
      height: result.height,
      data: quantize(pixels, depth, target.alpha === "premultiplied"),
      sidecar: {
        tool: "VFXForge",
        version: 1,
        sheet: target.sheet,
        alpha: target.alpha,
        usage: target.usage,
        packing: target.packing,
        source: { project: projectName, graph: graph.name, seed: project.seed }
      }
    })
  }
  return images
}
