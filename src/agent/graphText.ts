/**
 * Compact graph text (docs/05 §5.4): one node per line, only non-default
 * parameters, links inline. This is what `get_graph` returns to an agent.
 */

import type { Graph, Node, ParamValue } from "../doc/types"
import type { NodeRegistry } from "../engine/nodeDef"

function number(value: number): string {
  return String(Math.round(value * 10000) / 10000)
}

export function formatValue(value: ParamValue): string {
  if (typeof value === "number") return number(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "string") return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value)
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) return `[${(value as number[]).map(number).join(",")}]`
  // Gradients and other structured values: compact JSON with short numbers.
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "number" ? Math.round(v * 10000) / 10000 : v))
}

function nodeLine(graph: Graph, node: Node, registry: NodeRegistry, full: boolean, idWidth: number, typeWidth: number): string {
  const def = registry.get(node.type)
  const parts: string[] = []
  const names = full && def ? Object.keys(def.params) : Object.keys(node.params)
  for (const name of names) {
    if (name in node.driven) continue
    const value = name in node.params ? node.params[name] : (def?.params[name]?.default as ParamValue | undefined)
    if (value !== undefined) parts.push(`${name}=${formatValue(value)}`)
  }
  for (const [param, from] of Object.entries(node.driven)) parts.push(`${param}<-${from}`)
  const links = graph.links.filter((l) => l.to.startsWith(`${node.id}.`))
  for (const link of links) {
    const input = link.to.slice(node.id.length + 1)
    // ".out" is the usual single output; leave it off to keep lines short.
    parts.push(`${input}<-${link.from.endsWith(".out") ? link.from.slice(0, -4) : link.from}`)
  }
  const flags = [node.name ? `"${node.name}"` : "", node.bypass ? "bypass" : "", node.locked ? "locked" : ""].filter(Boolean)
  return `${node.id.padEnd(idWidth)}  ${node.type.padEnd(typeWidth)}  ${[...parts, ...flags].join(" ")}`.trimEnd()
}

export function graphText(graph: Graph, registry: NodeRegistry, projectSeed: number, detail: "compact" | "full" = "compact"): string {
  const s = graph.settings
  const header = `graph ${graph.id} "${graph.name}"  ${s.width}x${s.height}  frames=${s.frames} fps=${s.fps}${s.loop ? " loop" : ""}  seed=${projectSeed}`
  if (graph.nodes.length === 0) return `${header}\n(empty)`
  const idWidth = Math.max(...graph.nodes.map((n) => n.id.length))
  const typeWidth = Math.max(...graph.nodes.map((n) => n.type.length))
  return [header, ...graph.nodes.map((node) => nodeLine(graph, node, registry, detail === "full", idWidth, typeWidth))].join("\n")
}
