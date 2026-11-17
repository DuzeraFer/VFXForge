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
  const head = [graph.function ? `${header}  function${graph.description ? `: ${graph.description}` : ""}` : header]
  if (graph.exposed.length > 0) head.push(`exposed: ${graph.exposed.map((e) => (e.as === e.param ? `${e.nodeId}.${e.param}` : `${e.as}=${e.nodeId}.${e.param}`)).join(", ")}`)
  if (graph.presets && graph.presets.length > 0) head.push(`presets: ${graph.presets.map((p) => p.name).join(", ")}`)
  if (graph.nodes.length === 0) return `${head.join("\n")}\n(empty)`
  const idWidth = Math.max(...graph.nodes.map((n) => n.id.length))
  const typeWidth = Math.max(...graph.nodes.map((n) => n.type.length))
  return [...head, ...graph.nodes.map((node) => nodeLine(graph, node, registry, detail === "full", idWidth, typeWidth))].join("\n")
}

// ── Reading the same text back (the `apply_text` tool) ────

export type TextNode = {
  id: string
  type: string
  name?: string
  bypass: boolean
  params: Record<string, ParamValue>
  /** Parameter → "node.output". */
  driven: Record<string, string>
  /** Input → "node.output". */
  inputs: Record<string, string>
}

export class GraphTextError extends Error {}

/** Splits a line at spaces that are outside quotes and brackets. */
function tokens(line: string, where: string): string[] {
  const out: string[] = []
  let current = ""
  let depth = 0
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      current += c
      if (c === "\\") current += line[++i] ?? ""
      else if (c === '"') quoted = false
      continue
    }
    if (c === '"') quoted = true
    else if (c === "[" || c === "{") depth++
    else if (c === "]" || c === "}") depth--
    if (/\s/.test(c) && depth === 0) {
      if (current) out.push(current)
      current = ""
    } else current += c
  }
  if (quoted || depth !== 0) throw new GraphTextError(`${where}: a quote or bracket is not closed.`)
  if (current) out.push(current)
  return out
}

function value(text: string): ParamValue {
  try {
    return JSON.parse(text) as ParamValue
  } catch {
    return text
  }
}

/**
 * Parses the text `graphText` writes. The header line and the "exposed:",
 * "presets:" and "problems:" lines are skipped, so text from `get_graph` can
 * be edited and sent back as it is.
 */
export function parseGraphText(text: string, registry: NodeRegistry): TextNode[] {
  const nodes: TextNode[] = []
  const seen = new Set<string>()
  const lines = text.split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim()
    const where = `Line ${n + 1}`
    if (line === "" || line === "(empty)" || line.startsWith("#") || /^(graph\s|exposed:|presets:)/.test(line)) continue
    if (line === "problems:") break
    const [id, type, ...rest] = tokens(line, where)
    if (!type) throw new GraphTextError(`${where}: expected "id type params…", got "${line}".`)
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) throw new GraphTextError(`${where}: "${id}" is not a node id. Use letters, digits and "_", starting with a letter.`)
    if (seen.has(id)) throw new GraphTextError(`${where}: the id "${id}" is used twice.`)
    seen.add(id)
    const def = registry.get(type)
    if (!def) throw new GraphTextError(`${where}: there is no node type "${type}". Call list_node_types.`)
    const node: TextNode = { id, type, bypass: false, params: {}, driven: {}, inputs: {} }
    for (const token of rest) {
      if (token === "bypass") node.bypass = true
      else if (token === "locked") continue
      else if (token.startsWith('"')) node.name = String(value(token))
      else if (/^[a-z_][a-z0-9_]*<-/i.test(token)) {
        const [name, from] = [token.slice(0, token.indexOf("<-")), token.slice(token.indexOf("<-") + 2)]
        if (!from) throw new GraphTextError(`${where}: "${token}" names nothing after the arrow.`)
        const ref = from.includes(".") ? from : `${from}.out`
        if (name in def.inputs) node.inputs[name] = ref
        else if (name in def.params) node.driven[name] = ref
        else throw new GraphTextError(`${where}: ${type} has no input or parameter "${name}". Inputs: ${Object.keys(def.inputs).join(", ") || "none"}. Parameters: ${Object.keys(def.params).join(", ") || "none"}.`)
      } else if (token.includes("=")) {
        const name = token.slice(0, token.indexOf("="))
        if (!(name in def.params)) throw new GraphTextError(`${where}: ${type} has no parameter "${name}". It has: ${Object.keys(def.params).join(", ") || "none"}.`)
        const raw = token.slice(token.indexOf("=") + 1)
        const parsed = value(raw)
        // Text parameters keep what was written: a name like 12 or true is still a name.
        const textual = def.params[name].type === "string" || def.params[name].type === "enum"
        node.params[name] = textual && typeof parsed !== "string" ? raw : parsed
      } else throw new GraphTextError(`${where}: cannot read "${token}". Write param=value, input<-node, or a "name" in quotes.`)
    }
    nodes.push(node)
  }
  return nodes
}

/** Equal at the precision the text is written in, so reading a graph and sending it back changes nothing. */
const rounded = (v: unknown): string => JSON.stringify(v, (_key, x: unknown) => (typeof x === "number" ? Math.round(x * 10000) / 10000 : x))
const same = (a: unknown, b: unknown): boolean => rounded(a) === rounded(b)

/**
 * The `apply` operations that turn `graph` into what the text says. The text
 * is the whole graph: nodes it leaves out are removed. Nodes that keep their
 * id and type keep their place on the canvas.
 */
export function graphTextOps(graph: Graph, wanted: readonly TextNode[], registry: NodeRegistry): Record<string, unknown>[] {
  const ops: Record<string, unknown>[] = []
  const wantedIds = new Map(wanted.map((n) => [n.id, n]))
  const kept = new Set<string>()
  for (const node of graph.nodes) {
    const next = wantedIds.get(node.id)
    if (next && next.type === node.type) kept.add(node.id)
    else {
      if (node.locked) throw new GraphTextError(`${node.id} is locked by the artist, so it cannot be ${next ? "replaced" : "removed"}. Keep its line as it is.`)
      ops.push({ op: "remove_node", id: node.id })
    }
  }
  const later: Record<string, unknown>[] = []
  const fromKept = (ref: string): boolean => kept.has(ref.slice(0, ref.indexOf(".")))
  for (const next of wanted) {
    const node = kept.has(next.id) ? graph.nodes.find((n) => n.id === next.id)! : undefined
    const def = registry.get(next.type)
    // A value equal to the default is the same as leaving it out.
    const params = Object.fromEntries(Object.entries(next.params).filter(([name, v]) => !same(v, def?.params[name]?.default)))
    if (!node) {
      ops.push({ op: "add_node", type: next.type, id: next.id, ...(next.name ? { name: next.name } : {}), ...(Object.keys(params).length > 0 ? { params } : {}) })
      if (next.bypass) later.push({ op: "set_node_flags", id: next.id, bypass: true })
    } else {
      const changes: Record<string, ParamValue | null> = {}
      for (const [name, v] of Object.entries(params)) if (!same(node.params[name], v)) changes[name] = v
      for (const name of Object.keys(node.params)) if (!(name in params)) changes[name] = null
      if (Object.keys(changes).length > 0) ops.push({ op: "set_params", id: node.id, params: changes })
      if ((node.name ?? null) !== (next.name ?? null)) ops.push({ op: "rename", id: node.id, name: next.name ?? null })
      if (!!node.bypass !== next.bypass) ops.push({ op: "set_node_flags", id: node.id, bypass: next.bypass })
      for (const param of Object.keys(node.driven)) if (!(param in next.driven)) later.push({ op: "drive_param", id: node.id, param, from: null })
      for (const link of graph.links) {
        const [to, input] = [link.to.slice(0, link.to.indexOf(".")), link.to.slice(link.to.indexOf(".") + 1)]
        if (to === node.id && !(input in next.inputs)) later.push({ op: "disconnect", to: link.to })
      }
    }
    for (const [param, from] of Object.entries(next.driven)) {
      if (!(node && node.driven[param] === from && fromKept(from))) later.push({ op: "drive_param", id: next.id, param, from })
    }
    for (const [input, from] of Object.entries(next.inputs)) {
      const to = `${next.id}.${input}`
      if (!(node && fromKept(from) && graph.links.some((l) => l.to === to && l.from === from))) later.push({ op: "connect", from, to })
    }
  }
  return [...ops, ...later]
}
