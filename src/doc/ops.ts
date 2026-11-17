/**
 * Operations: the only way a document changes (docs/06 §6.4, docs/05 §5.3).
 *
 * `applyOp` never mutates. It returns the next project plus the ops that undo
 * the change. The UI, undo/redo, MCP `apply` and file loading all go through
 * this one code path.
 */

import {
  createGraph,
  parseSocketRef,
  type CommentThread,
  type Reference,
  type Snapshot,
  type ExposedParam,
  type Graph,
  type GraphSettings,
  type Node,
  type ParamValue,
  type Preset,
  type Project
} from "./types"

type NodeGuard = {
  /** Fail the op if the node changed since the caller read it (docs/05 §5.5). */
  ifVersion?: number
}

export type Op =
  | { op: "add_graph"; id?: string; name: string; settings?: Partial<GraphSettings>; function?: boolean; description?: string }
  | { op: "remove_graph"; graphId: string }
  | { op: "restore_graph"; graph: Graph; index: number }
  | { op: "set_project"; name?: string; seed?: number }
  /** The reference board, comment threads and snapshots are small lists; each is replaced as a whole. */
  | { op: "set_references"; references: Reference[] }
  | { op: "set_comments"; comments: CommentThread[] }
  | { op: "set_snapshots"; snapshots: Snapshot[] }
  /** `description: null` removes it. */
  | { op: "set_graph"; graphId: string; name?: string; settings?: Partial<GraphSettings>; function?: boolean; description?: string | null }
  /** Shows a node's parameter at graph level, under the name `as` (default: the parameter's name). On a function it becomes a parameter of the function's node. */
  | { op: "expose_param"; graphId: string; id: string; param: string; as?: string; label?: string; group?: string }
  | { op: "unexpose_param"; graphId: string; as: string }
  | { op: "set_exposed"; graphId: string; exposed: ExposedParam[] }
  /** Replaces the graph's presets. */
  | { op: "set_presets"; graphId: string; presets: Preset[] }
  | {
      op: "add_node"
      graphId: string
      type: string
      id?: string
      name?: string
      params?: Record<string, ParamValue>
      position?: [number, number]
    }
  | ({ op: "remove_node"; graphId: string; id: string } & NodeGuard)
  | { op: "restore_node"; graphId: string; node: Node; index: number }
  /** A `null` value resets that parameter to the node type's default. */
  | ({ op: "set_params"; graphId: string; id: string; params: Record<string, ParamValue | null> } & NodeGuard)
  | { op: "connect"; graphId: string; from: string; to: string }
  | { op: "disconnect"; graphId: string; to: string }
  /** `from: null` stops driving the parameter. */
  | ({ op: "drive_param"; graphId: string; id: string; param: string; from: string | null } & NodeGuard)
  | { op: "move_node"; graphId: string; id: string; position: [number, number] }
  | ({ op: "rename"; graphId: string; id: string; name: string | null } & NodeGuard)
  | ({ op: "set_node_flags"; graphId: string; id: string; locked?: boolean; bypass?: boolean } & NodeGuard)

export type OpName = Op["op"]

function uniqueIds(items: readonly { id: string }[], what: string): void {
  const seen = new Set<string>()
  for (const item of items) {
    if (!item || typeof item.id !== "string" || item.id === "") throw new OpError("invalid_value", `Every ${what} needs an id.`)
    if (seen.has(item.id)) throw new OpError("duplicate_id", `Two ${what}s have the id "${item.id}".`)
    seen.add(item.id)
  }
}

export type OpErrorCode =
  | "unknown_graph"
  | "unknown_node"
  | "duplicate_id"
  | "invalid_id"
  | "invalid_socket"
  | "invalid_value"
  | "cycle"
  | "locked"
  | "version_conflict"
  | "no_link"

export class OpError extends Error {
  constructor(
    readonly code: OpErrorCode,
    message: string,
    /** Extra facts for the caller, e.g. the node's current state on a conflict. */
    readonly info?: Record<string, unknown>
  ) {
    super(message)
    this.name = "OpError"
  }
}

export type ApplyOptions = {
  /**
   * When true, locked nodes refuse changes (agent edits). The human can always
   * edit, and undo/redo replays are never blocked.
   */
  respectLocks?: boolean
}

export type OpResult = {
  project: Project
  inverse: Op[]
  /** Ids created by this op (new node or graph). */
  created?: string
}

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

function findGraph(project: Project, graphId: string): { graph: Graph; index: number } {
  const index = project.graphs.findIndex((g) => g.id === graphId)
  if (index === -1) throw new OpError("unknown_graph", `No graph with id "${graphId}".`)
  return { graph: project.graphs[index], index }
}

function findNode(graph: Graph, id: string): { node: Node; index: number } {
  const index = graph.nodes.findIndex((n) => n.id === id)
  if (index === -1) throw new OpError("unknown_node", `No node with id "${id}" in graph "${graph.id}".`)
  return { node: graph.nodes[index], index }
}

function withGraph(project: Project, index: number, graph: Graph): Project {
  const graphs = project.graphs.slice()
  graphs[index] = graph
  return { ...project, graphs }
}

function withNode(graph: Graph, index: number, node: Node): Graph {
  const nodes = graph.nodes.slice()
  nodes[index] = node
  return { ...graph, nodes }
}

function guard(node: Node, op: NodeGuard, options: ApplyOptions): void {
  if (op.ifVersion !== undefined && op.ifVersion !== node.version) {
    throw new OpError(
      "version_conflict",
      `Node "${node.id}" changed since it was read (version ${node.version}, expected ${op.ifVersion}).`,
      { node }
    )
  }
  if (options.respectLocks && node.locked) {
    throw new OpError("locked", `Node "${node.id}" is locked.`)
  }
}

/** Next free id of the form `${prefix}${n}`, counting up from the highest in use. */
export function nextId(existing: Iterable<string>, prefix: string): string {
  let max = 0
  for (const id of existing) {
    if (!id.startsWith(prefix)) continue
    const rest = id.slice(prefix.length)
    if (/^[0-9]+$/.test(rest)) max = Math.max(max, Number(rest))
  }
  return `${prefix}${max + 1}`
}

const EXPOSED_NAME = /^[a-z][a-z0-9_]*$/

function checkId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new OpError("invalid_id", `"${id}" is not a valid id. Use letters, digits, "_" or "-", starting with a letter.`)
  }
}

function socketOf(graph: Graph, ref: string, role: string): { node: Node; index: number; socket: string } {
  const parsed = parseSocketRef(ref)
  if (!parsed) throw new OpError("invalid_socket", `${role} "${ref}" must look like "nodeId.socket".`)
  return { ...findNode(graph, parsed.nodeId), socket: parsed.socket }
}

/** Node ids that feed `nodeId`, directly or not, through links and driven params. */
function upstreamOf(graph: Graph, nodeId: string): Set<string> {
  const sources = new Map<string, string[]>()
  const add = (to: string, from: string): void => {
    const list = sources.get(to)
    if (list) list.push(from)
    else sources.set(to, [from])
  }
  for (const link of graph.links) {
    const from = parseSocketRef(link.from)
    const to = parseSocketRef(link.to)
    if (from && to) add(to.nodeId, from.nodeId)
  }
  for (const node of graph.nodes) {
    for (const ref of Object.values(node.driven)) {
      const from = parseSocketRef(ref)
      if (from) add(node.id, from.nodeId)
    }
  }
  const seen = new Set<string>()
  const stack = [nodeId]
  while (stack.length > 0) {
    for (const source of sources.get(stack.pop()!) ?? []) {
      if (!seen.has(source)) {
        seen.add(source)
        stack.push(source)
      }
    }
  }
  return seen
}

/** True if any node feeds itself. Used when reading files, where links arrive all at once. */
export function hasCycle(graph: Graph): boolean {
  return graph.nodes.some((node) => upstreamOf(graph, node.id).has(node.id))
}

function checkNoCycle(graph: Graph, fromNodeId: string, toNodeId: string): void {
  if (fromNodeId === toNodeId || upstreamOf(graph, fromNodeId).has(toNodeId)) {
    throw new OpError("cycle", `Connecting "${fromNodeId}" to "${toNodeId}" would create a loop.`)
  }
}

function bump(node: Node): Node {
  return { ...node, version: node.version + 1 }
}

function isFinitePosition(position: unknown): position is [number, number] {
  return Array.isArray(position) && position.length === 2 && position.every((v) => typeof v === "number" && Number.isFinite(v))
}

function checkSettings(settings: Partial<GraphSettings>): void {
  const positiveInt = (key: "width" | "height" | "frames"): void => {
    const value = settings[key]
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new OpError("invalid_value", `Graph ${key} must be a whole number of at least 1.`)
    }
  }
  positiveInt("width")
  positiveInt("height")
  positiveInt("frames")
  if (settings.fps !== undefined && !(Number.isFinite(settings.fps) && settings.fps > 0)) {
    throw new OpError("invalid_value", "Graph fps must be greater than 0.")
  }
  if (settings.bitDepth !== undefined && !["8", "16", "16f", "32f"].includes(settings.bitDepth)) {
    throw new OpError("invalid_value", `Unknown bit depth "${settings.bitDepth}".`)
  }
}

export function applyOp(project: Project, op: Op, options: ApplyOptions = {}): OpResult {
  switch (op.op) {
    case "add_graph": {
      const id = op.id ?? nextId(project.graphs.map((g) => g.id), "g")
      checkId(id)
      if (project.graphs.some((g) => g.id === id)) throw new OpError("duplicate_id", `Graph id "${id}" is already in use.`)
      if (op.settings) checkSettings(op.settings)
      const graph = createGraph(id, op.name, op.settings)
      if (op.function) graph.function = true
      if (op.description) graph.description = op.description
      return {
        project: { ...project, graphs: [...project.graphs, graph] },
        inverse: [{ op: "remove_graph", graphId: id }],
        created: id
      }
    }

    case "remove_graph": {
      const { graph, index } = findGraph(project, op.graphId)
      return {
        project: { ...project, graphs: project.graphs.filter((g) => g !== graph) },
        inverse: [{ op: "restore_graph", graph, index }]
      }
    }

    case "restore_graph": {
      if (project.graphs.some((g) => g.id === op.graph.id)) {
        throw new OpError("duplicate_id", `Graph id "${op.graph.id}" is already in use.`)
      }
      const graphs = project.graphs.slice()
      graphs.splice(Math.min(op.index, graphs.length), 0, op.graph)
      return { project: { ...project, graphs }, inverse: [{ op: "remove_graph", graphId: op.graph.id }] }
    }

    case "set_project": {
      if (op.seed !== undefined && !Number.isInteger(op.seed)) {
        throw new OpError("invalid_value", "Project seed must be a whole number.")
      }
      const inverse: Op = { op: "set_project" }
      const next = { ...project }
      if (op.name !== undefined) {
        inverse.name = project.name
        next.name = op.name
      }
      if (op.seed !== undefined) {
        inverse.seed = project.seed
        next.seed = op.seed
      }
      return { project: next, inverse: [inverse] }
    }

    case "set_references": {
      uniqueIds(op.references, "reference")
      for (const r of op.references) if (typeof r.image !== "string") throw new OpError("invalid_value", "Every reference needs an image.")
      return { project: { ...project, references: op.references.map((r) => ({ ...r })) }, inverse: [{ op: "set_references", references: project.references }] }
    }

    case "set_comments": {
      uniqueIds(op.comments, "comment thread")
      for (const thread of op.comments) {
        if (!Array.isArray(thread.messages) || thread.messages.length === 0) throw new OpError("invalid_value", "A comment thread needs at least one message.")
        for (const m of thread.messages) {
          if (typeof m.author !== "string" || typeof m.text !== "string" || m.text.trim() === "" || typeof m.timestamp !== "string") throw new OpError("invalid_value", "Every comment needs an author, a text and a time.")
        }
      }
      return { project: { ...project, comments: op.comments.map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m })) })) }, inverse: [{ op: "set_comments", comments: project.comments }] }
    }

    case "set_snapshots": {
      uniqueIds(op.snapshots, "snapshot")
      const next = { ...project }
      if (op.snapshots.length > 0) next.snapshots = op.snapshots.map((snap) => ({ ...snap }))
      else delete next.snapshots
      return { project: next, inverse: [{ op: "set_snapshots", snapshots: project.snapshots ?? [] }] }
    }

    case "set_graph": {
      const { graph, index } = findGraph(project, op.graphId)
      const inverse: Op = { op: "set_graph", graphId: graph.id }
      let next = graph
      if (op.name !== undefined) {
        inverse.name = graph.name
        next = { ...next, name: op.name }
      }
      if (op.function !== undefined) {
        inverse.function = graph.function ?? false
        next = { ...next }
        if (op.function) next.function = true
        else delete next.function
      }
      if (op.description !== undefined) {
        inverse.description = graph.description ?? null
        next = { ...next }
        if (op.description) next.description = op.description
        else delete next.description
      }
      if (op.settings) {
        checkSettings(op.settings)
        const previous: Partial<GraphSettings> = {}
        for (const key of Object.keys(op.settings) as (keyof GraphSettings)[]) {
          if (op.settings[key] !== undefined) (previous as Record<string, unknown>)[key] = graph.settings[key]
        }
        inverse.settings = previous
        next = { ...next, settings: { ...graph.settings, ...op.settings } }
      }
      return { project: withGraph(project, index, next), inverse: [inverse] }
    }

    case "expose_param": {
      const { graph, index } = findGraph(project, op.graphId)
      if (!graph.nodes.some((n) => n.id === op.id)) throw new OpError("unknown_node", `Graph "${graph.id}" has no node "${op.id}".`)
      if (!op.param) throw new OpError("invalid_value", "expose_param needs the name of a parameter.")
      const as = op.as ?? op.param
      if (!EXPOSED_NAME.test(as)) throw new OpError("invalid_value", `"${as}" is not a valid name for an exposed parameter. Use lower case letters, digits and "_", starting with a letter.`)
      if (graph.exposed.some((e) => e.as === as)) throw new OpError("duplicate_id", `This graph already exposes a parameter as "${as}". Pick another name with "as".`)
      if (graph.exposed.some((e) => e.nodeId === op.id && e.param === op.param)) throw new OpError("duplicate_id", `Parameter "${op.param}" of "${op.id}" is already exposed.`)
      const entry: ExposedParam = { nodeId: op.id, param: op.param, as }
      if (op.label) entry.label = op.label
      if (op.group) entry.group = op.group
      return {
        project: withGraph(project, index, { ...graph, exposed: [...graph.exposed, entry] }),
        inverse: [{ op: "set_exposed", graphId: graph.id, exposed: graph.exposed }]
      }
    }

    case "unexpose_param": {
      const { graph, index } = findGraph(project, op.graphId)
      if (!graph.exposed.some((e) => e.as === op.as)) throw new OpError("invalid_value", `This graph exposes nothing as "${op.as}".`)
      return {
        project: withGraph(project, index, { ...graph, exposed: graph.exposed.filter((e) => e.as !== op.as) }),
        inverse: [{ op: "set_exposed", graphId: graph.id, exposed: graph.exposed }]
      }
    }

    case "set_exposed": {
      const { graph, index } = findGraph(project, op.graphId)
      const seen = new Set<string>()
      for (const e of op.exposed) {
        if (!e || typeof e.nodeId !== "string" || typeof e.param !== "string" || typeof e.as !== "string" || !EXPOSED_NAME.test(e.as)) {
          throw new OpError("invalid_value", "Every exposed parameter needs nodeId, param and a valid name in as.")
        }
        if (!graph.nodes.some((n) => n.id === e.nodeId)) throw new OpError("unknown_node", `Graph "${graph.id}" has no node "${e.nodeId}".`)
        if (seen.has(e.as)) throw new OpError("duplicate_id", `Two parameters are exposed as "${e.as}".`)
        seen.add(e.as)
      }
      return {
        project: withGraph(project, index, { ...graph, exposed: op.exposed.map((e) => ({ ...e })) }),
        inverse: [{ op: "set_exposed", graphId: graph.id, exposed: graph.exposed }]
      }
    }

    case "set_presets": {
      const { graph, index } = findGraph(project, op.graphId)
      const names = new Set<string>()
      for (const preset of op.presets) {
        if (!preset || typeof preset.name !== "string" || preset.name.trim() === "" || typeof preset.values !== "object" || preset.values === null || Array.isArray(preset.values)) {
          throw new OpError("invalid_value", "Every preset needs a name and values.")
        }
        if (names.has(preset.name)) throw new OpError("duplicate_id", `Two presets are called "${preset.name}".`)
        names.add(preset.name)
      }
      const next = { ...graph }
      if (op.presets.length > 0) next.presets = op.presets.map((p) => ({ name: p.name, values: { ...p.values } }))
      else delete next.presets
      return {
        project: withGraph(project, index, next),
        inverse: [{ op: "set_presets", graphId: graph.id, presets: graph.presets ?? [] }]
      }
    }

    case "add_node": {
      const { graph, index } = findGraph(project, op.graphId)
      const id = op.id ?? nextId(graph.nodes.map((n) => n.id), "n")
      checkId(id)
      if (graph.nodes.some((n) => n.id === id)) throw new OpError("duplicate_id", `Node id "${id}" is already in use.`)
      if (!op.type) throw new OpError("invalid_value", "add_node needs a node type.")
      if (op.position !== undefined && !isFinitePosition(op.position)) {
        throw new OpError("invalid_value", "Node position must be [x, y].")
      }
      const node: Node = {
        id,
        type: op.type,
        ...(op.name ? { name: op.name } : {}),
        position: op.position ?? [0, 0],
        params: { ...op.params },
        driven: {},
        version: 1
      }
      return {
        project: withGraph(project, index, { ...graph, nodes: [...graph.nodes, node] }),
        inverse: [{ op: "remove_node", graphId: graph.id, id }],
        created: id
      }
    }

    case "remove_node": {
      const { graph, index } = findGraph(project, op.graphId)
      const { node, index: nodeIndex } = findNode(graph, op.id)
      guard(node, op, options)

      // Undo restores, in order: the node, its links, then params it was driving elsewhere.
      const inverse: Op[] = [{ op: "restore_node", graphId: graph.id, node, index: nodeIndex }]
      const links = graph.links.filter((link) => {
        const touches = parseSocketRef(link.from)?.nodeId === node.id || parseSocketRef(link.to)?.nodeId === node.id
        if (touches) inverse.push({ op: "connect", graphId: graph.id, from: link.from, to: link.to })
        return !touches
      })
      const nodes = graph.nodes
        .filter((n) => n !== node)
        .map((other) => {
          const drivenByRemoved = Object.entries(other.driven).filter(([, ref]) => parseSocketRef(ref)?.nodeId === node.id)
          if (drivenByRemoved.length === 0) return other
          const driven = { ...other.driven }
          for (const [param, ref] of drivenByRemoved) {
            delete driven[param]
            inverse.push({ op: "drive_param", graphId: graph.id, id: other.id, param, from: ref })
          }
          return bump({ ...other, driven })
        })
      const exposed = graph.exposed.filter((e) => e.nodeId !== node.id)
      const frames = graph.frames.map((f) =>
        f.nodeIds.includes(node.id) ? { ...f, nodeIds: f.nodeIds.filter((n) => n !== node.id) } : f
      )
      if (exposed.length !== graph.exposed.length || frames.some((f, i) => f !== graph.frames[i])) {
        // Rare enough that restoring the whole lists is simpler than per-item ops.
        return {
          project: withGraph(project, index, { ...graph, nodes, links, exposed, frames }),
          inverse: [{ op: "remove_graph", graphId: graph.id }, { op: "restore_graph", graph, index }]
        }
      }
      return { project: withGraph(project, index, { ...graph, nodes, links }), inverse }
    }

    case "restore_node": {
      const { graph, index } = findGraph(project, op.graphId)
      if (graph.nodes.some((n) => n.id === op.node.id)) {
        throw new OpError("duplicate_id", `Node id "${op.node.id}" is already in use.`)
      }
      const nodes = graph.nodes.slice()
      nodes.splice(Math.min(op.index, nodes.length), 0, bump(op.node))
      return {
        project: withGraph(project, index, { ...graph, nodes }),
        inverse: [{ op: "remove_node", graphId: graph.id, id: op.node.id }]
      }
    }

    case "set_params": {
      const { graph, index } = findGraph(project, op.graphId)
      const { node, index: nodeIndex } = findNode(graph, op.id)
      guard(node, op, options)
      const params = { ...node.params }
      const previous: Record<string, ParamValue | null> = {}
      for (const [key, value] of Object.entries(op.params)) {
        previous[key] = key in node.params ? node.params[key] : null
        if (value === null) delete params[key]
        else params[key] = value
      }
      return {
        project: withGraph(project, index, withNode(graph, nodeIndex, bump({ ...node, params }))),
        inverse: [{ op: "set_params", graphId: graph.id, id: node.id, params: previous }]
      }
    }

    case "connect": {
      const { graph, index } = findGraph(project, op.graphId)
      const from = socketOf(graph, op.from, "Link source")
      const to = socketOf(graph, op.to, "Link target")
      checkNoCycle(graph, from.node.id, to.node.id)
      if (options.respectLocks && to.node.locked) throw new OpError("locked", `Node "${to.node.id}" is locked.`)

      // An input holds one link: connecting replaces what was there.
      const existing = graph.links.find((link) => link.to === op.to)
      if (existing?.from === op.from) return { project, inverse: [] }
      const links = graph.links.filter((link) => link !== existing)
      links.push({ from: op.from, to: op.to })
      // Link order carries no meaning, so it is kept sorted by target for stable files and diffs.
      links.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0))
      const inverse: Op = existing
        ? { op: "connect", graphId: graph.id, from: existing.from, to: existing.to }
        : { op: "disconnect", graphId: graph.id, to: op.to }
      return {
        project: withGraph(project, index, { ...withNode(graph, to.index, bump(to.node)), links }),
        inverse: [inverse]
      }
    }

    case "disconnect": {
      const { graph, index } = findGraph(project, op.graphId)
      const to = socketOf(graph, op.to, "Link target")
      if (options.respectLocks && to.node.locked) throw new OpError("locked", `Node "${to.node.id}" is locked.`)
      const existing = graph.links.find((link) => link.to === op.to)
      if (!existing) throw new OpError("no_link", `Nothing is connected to "${op.to}".`)
      return {
        project: withGraph(project, index, {
          ...withNode(graph, to.index, bump(to.node)),
          links: graph.links.filter((link) => link !== existing)
        }),
        inverse: [{ op: "connect", graphId: graph.id, from: existing.from, to: existing.to }]
      }
    }

    case "drive_param": {
      const { graph, index } = findGraph(project, op.graphId)
      const { node, index: nodeIndex } = findNode(graph, op.id)
      guard(node, op, options)
      if (!op.param) throw new OpError("invalid_value", "drive_param needs a parameter name.")
      const previous = node.driven[op.param] ?? null
      if (previous === op.from) return { project, inverse: [] }
      const driven = { ...node.driven }
      if (op.from === null) {
        delete driven[op.param]
      } else {
        const from = socketOf(graph, op.from, "Driver")
        checkNoCycle(graph, from.node.id, node.id)
        driven[op.param] = op.from
      }
      return {
        project: withGraph(project, index, withNode(graph, nodeIndex, bump({ ...node, driven }))),
        inverse: [{ op: "drive_param", graphId: graph.id, id: node.id, param: op.param, from: previous }]
      }
    }

    case "move_node": {
      const { graph, index } = findGraph(project, op.graphId)
      const { node, index: nodeIndex } = findNode(graph, op.id)
      if (!isFinitePosition(op.position)) throw new OpError("invalid_value", "Node position must be [x, y].")
      // Moving is layout only: it does not bump the version or respect locks.
      return {
        project: withGraph(project, index, withNode(graph, nodeIndex, { ...node, position: op.position })),
        inverse: [{ op: "move_node", graphId: graph.id, id: node.id, position: node.position }]
      }
    }

    case "rename": {
      const { graph, index } = findGraph(project, op.graphId)
      const { node, index: nodeIndex } = findNode(graph, op.id)
      guard(node, op, options)
      const { name: previous, ...rest } = node
      const next: Node = op.name ? { ...node, name: op.name } : rest
      return {
        project: withGraph(project, index, withNode(graph, nodeIndex, bump(next))),
        inverse: [{ op: "rename", graphId: graph.id, id: node.id, name: previous ?? null }]
      }
    }

    case "set_node_flags": {
      const { graph, index } = findGraph(project, op.graphId)
      const { node, index: nodeIndex } = findNode(graph, op.id)
      // Unlocking is how a locked node becomes editable again, so only bypass is guarded.
      guard(node, op, op.bypass !== undefined ? options : {})
      const inverse: Op = { op: "set_node_flags", graphId: graph.id, id: node.id }
      const next = { ...node }
      for (const flag of ["locked", "bypass"] as const) {
        const value = op[flag]
        if (value === undefined) continue
        inverse[flag] = node[flag] ?? false
        if (value) next[flag] = true
        else delete next[flag]
      }
      return { project: withGraph(project, index, withNode(graph, nodeIndex, bump(next))), inverse: [inverse] }
    }
  }
}

export type OpsResult = {
  project: Project
  /** Ops that undo the whole batch, already in the order to apply them. */
  inverse: Op[]
  /** One entry per op: the id it created, if any. */
  created: (string | undefined)[]
}

export class BatchError extends OpError {
  constructor(
    readonly opIndex: number,
    cause: OpError
  ) {
    super(cause.code, `Op ${opIndex} (${cause.message})`, cause.info)
    this.name = "BatchError"
  }
}

/** Applies ops in order. All or nothing: on any error the input project is untouched. */
export function applyOps(project: Project, ops: readonly Op[], options: ApplyOptions = {}): OpsResult {
  let current = project
  const inverse: Op[] = []
  const created: (string | undefined)[] = []
  ops.forEach((op, opIndex) => {
    try {
      const result = applyOp(current, op, options)
      current = result.project
      inverse.unshift(...result.inverse)
      created.push(result.created)
    } catch (error) {
      if (error instanceof OpError) throw new BatchError(opIndex, error)
      throw error
    }
  })
  return { project: current, inverse, created }
}
