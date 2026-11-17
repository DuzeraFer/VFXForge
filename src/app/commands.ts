/** Editor commands: each builds ops and applies them through the session as one undoable step. */

import { autoLayoutOps, nextId, parseSocketRef, type Graph, type Node, type Op } from "../doc"
import type { DataType, InputType, ResolvedNodeDef } from "../engine/nodeDef"
import { registry } from "../nodes"
import { session } from "./session"

export function prettyName(type: string): string {
  return type
    .split("_")
    .map((word) => (word === "2d" ? "2D" : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ")
}

export function nodeTitle(node: Node): string {
  return node.name ?? prettyName(node.type)
}

export function accepts(input: InputType, actual: DataType): boolean {
  if (input === "value") return actual === "value"
  return actual !== "value" && (input !== "gray" || actual === "gray")
}

/** A wire being dragged from a socket, used to pre-filter node search and auto-connect the new node. */
export type PendingWire = { nodeId: string; socket: string; side: "output" | "input"; type: DataType | InputType }

/** First socket of `def` that can take the pending wire, or null. */
export function matchingSocket(def: ResolvedNodeDef, wire: PendingWire): string | null {
  if (wire.side === "output") {
    for (const [name, input] of Object.entries(def.inputs)) {
      if (accepts(input.type, wire.type as DataType)) return name
    }
    return null
  }
  for (const [name, type] of Object.entries(def.outputs)) {
    const produces: DataType | "image" = type.startsWith("same:") ? "image" : (type as DataType)
    if (wire.type === "value" ? produces === "value" : produces !== "value") return name
  }
  return null
}

function active(): Graph | null {
  return session.getState().activeGraph
}

export function addNode(type: string, position: [number, number], wire?: PendingWire | null): string | null {
  const graph = active()
  const def = registry.get(type)
  if (!graph || !def) return null
  const id = nextId(graph.nodes.map((n) => n.id), "n")
  const snapped: [number, number] = [Math.round(position[0] / 8) * 8, Math.round(position[1] / 8) * 8]
  const ops: Op[] = [{ op: "add_node", graphId: graph.id, type, id, position: snapped }]
  if (wire) {
    const socket = matchingSocket(def, wire)
    if (socket && wire.side === "output") ops.push({ op: "connect", graphId: graph.id, from: `${wire.nodeId}.${wire.socket}`, to: `${id}.${socket}` })
    if (socket && wire.side === "input") ops.push({ op: "connect", graphId: graph.id, from: `${id}.${socket}`, to: `${wire.nodeId}.${wire.socket}` })
  }
  if (!session.apply(ops, `Add ${prettyName(type)}`)) return null
  session.select([id])
  return id
}

export function deleteNodes(ids: readonly string[]): void {
  const graph = active()
  if (!graph || ids.length === 0) return
  session.apply(
    ids.map((id) => ({ op: "remove_node", graphId: graph.id, id })),
    ids.length === 1 ? `Delete ${nodeTitle(graph.nodes.find((n) => n.id === ids[0])!)}` : `Delete ${ids.length} nodes`
  )
}

type Clip = { nodes: Node[]; links: { from: string; to: string }[] }

let clipboard: Clip | null = null

/** Copies nodes with the links and drivers that stay inside the selection. */
function clipOf(graph: Graph, ids: readonly string[]): Clip {
  const chosen = new Set(ids)
  return {
    nodes: graph.nodes.filter((n) => chosen.has(n.id)),
    links: graph.links.filter((l) => chosen.has(parseSocketRef(l.from)!.nodeId) && chosen.has(parseSocketRef(l.to)!.nodeId))
  }
}

function pasteClip(clip: Clip, offset: [number, number], label: string): void {
  const graph = active()
  if (!graph || clip.nodes.length === 0) return
  const taken = graph.nodes.map((n) => n.id)
  const renamed = new Map<string, string>()
  for (const node of clip.nodes) {
    const id = nextId(taken, "n")
    taken.push(id)
    renamed.set(node.id, id)
  }
  const remap = (ref: string): string | null => {
    const { nodeId, socket } = parseSocketRef(ref)!
    const id = renamed.get(nodeId)
    return id ? `${id}.${socket}` : null
  }
  const ops: Op[] = []
  for (const node of clip.nodes) {
    ops.push({
      op: "add_node",
      graphId: graph.id,
      type: node.type,
      id: renamed.get(node.id)!,
      name: node.name,
      params: node.params,
      position: [node.position[0] + offset[0], node.position[1] + offset[1]]
    })
  }
  for (const node of clip.nodes) {
    for (const [param, ref] of Object.entries(node.driven)) {
      // Drivers outside the copied set keep pointing at the original source.
      ops.push({ op: "drive_param", graphId: graph.id, id: renamed.get(node.id)!, param, from: remap(ref) ?? ref })
    }
  }
  for (const link of clip.links) {
    ops.push({ op: "connect", graphId: graph.id, from: remap(link.from)!, to: remap(link.to)! })
  }
  if (session.apply(ops, label)) session.select([...renamed.values()])
}

export function copySelection(): void {
  const graph = active()
  const { selection } = session.getState()
  if (graph && selection.length > 0) clipboard = clipOf(graph, selection)
}

export function paste(): void {
  if (clipboard) pasteClip(clipboard, [32, 32], clipboard.nodes.length === 1 ? "Paste node" : `Paste ${clipboard.nodes.length} nodes`)
}

export function duplicateSelection(): void {
  const graph = active()
  const { selection } = session.getState()
  if (graph && selection.length > 0) pasteClip(clipOf(graph, selection), [32, 32], selection.length === 1 ? "Duplicate node" : `Duplicate ${selection.length} nodes`)
}

export function toggleBypass(): void {
  const graph = active()
  const { selection } = session.getState()
  if (!graph || selection.length === 0) return
  const nodes = graph.nodes.filter((n) => selection.includes(n.id))
  const bypass = !nodes.every((n) => n.bypass)
  session.apply(
    nodes.map((n) => ({ op: "set_node_flags", graphId: graph.id, id: n.id, bypass })),
    bypass ? "Bypass" : "Stop bypassing"
  )
}

export function autoAlign(): void {
  const graph = active()
  if (!graph) return
  const { selection } = session.getState()
  const ops = autoLayoutOps(graph, selection.length > 1 ? selection : undefined)
  if (ops.length > 0) session.apply(ops, "Auto-align")
}

/** Where a node added from the library panel lands: the middle of what the canvas shows. */
let viewCenter: () => [number, number] = () => [0, 0]

export function setViewCenterProvider(provider: (() => [number, number]) | null): void {
  viewCenter = provider ?? (() => [0, 0])
}

export function addNodeAtCenter(type: string): void {
  const graph = active()
  if (!graph) return
  let [x, y] = viewCenter()
  x = Math.round((x - 60) / 8) * 8
  y = Math.round((y - 60) / 8) * 8
  // Move down past any card already there, so the new node never lands on top of one.
  while (graph.nodes.some((n) => Math.abs(n.position[0] - x) < 136 && Math.abs(n.position[1] - y) < 152)) y += 160
  addNode(type, [x, y])
}

export function addGraph(): void {
  const { project } = session.getState()
  const id = nextId(project.graphs.map((g) => g.id), "g")
  const created = session.apply([{ op: "add_graph", id, name: `Graph ${project.graphs.length + 1}` }], "Add graph")
  if (created) session.setActiveGraph(id)
}
