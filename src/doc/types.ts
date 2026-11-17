/** Document model (docs/06-architecture.md §6.3). Plain JSON-safe data. */

export type ParamValue = number | boolean | string | number[] | { [key: string]: ParamValue } | ParamValue[]

export type BitDepth = "8" | "16" | "16f" | "32f"

export type GraphSettings = {
  width: number
  height: number
  frames: number
  fps: number
  loop: boolean
  bitDepth: BitDepth
}

export type Node = {
  id: string
  type: string
  name?: string
  position: [number, number]
  /** Only values that differ from the node type's defaults. */
  params: Record<string, ParamValue>
  /** Parameter name -> "nodeId.output" that drives it. */
  driven: Record<string, string>
  /** Bumped on every change to this node. Used for conflict checks (`ifVersion`). */
  version: number
  locked?: boolean
  bypass?: boolean
}

/** Both ends are socket references of the form "nodeId.socketName". */
export type Link = { from: string; to: string }

export type CommentBox = { id: string; title: string; nodeIds: string[]; color?: string; note?: string }

export type ExposedParam = { nodeId: string; param: string; as: string; label?: string; group?: string }

/** Named values for a graph's exposed parameters, keyed by the exposed name (`as`). */
export type Preset = { name: string; values: Record<string, ParamValue> }

export type Graph = {
  id: string
  name: string
  /** A function: other graphs of the project can use it as a node, and it is left out of export. */
  function?: boolean
  /** What the graph makes, in a sentence. Shown as the doc of the function's node. */
  description?: string
  settings: GraphSettings
  nodes: Node[]
  links: Link[]
  frames: CommentBox[]
  exposed: ExposedParam[]
  presets?: Preset[]
}

export type GradientStop = { position: number; color: [number, number, number, number]; hardness?: number }
export type Gradient = { id: string; name: string; stops: GradientStop[] }
export type GradientLib = { id: string; name: string; gradients: Gradient[] }

/** A picture on the reference board. `image` is an asset reference ("images/<hash>.png"). */
export type Reference = { id: string; image: string; name?: string; note?: string }

export type CommentMessage = { author: string; text: string; timestamp: string; agent?: boolean }
/** A conversation pinned to a node, or to a graph as a whole. */
export type CommentThread = {
  id: string
  graphId?: string
  nodeId?: string
  resolved?: boolean
  messages: CommentMessage[]
}

/** A saved picture of an output at one moment, for comparing with later versions. */
export type Snapshot = { id: string; name: string; image: string; graphId: string; target: string; frame: number; timestamp: string; by?: string }

export type Project = {
  version: 1
  name: string
  seed: number
  graphs: Graph[]
  functions: Graph[]
  gradients: GradientLib[]
  references: Reference[]
  comments: CommentThread[]
  snapshots?: Snapshot[]
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  width: 256,
  height: 256,
  frames: 1,
  fps: 12,
  loop: true,
  bitDepth: "16f"
}

export function createProject(name = "Untitled"): Project {
  return { version: 1, name, seed: 0, graphs: [], functions: [], gradients: [], references: [], comments: [] }
}

export function createGraph(id: string, name: string, settings: Partial<GraphSettings> = {}): Graph {
  return { id, name, settings: { ...DEFAULT_GRAPH_SETTINGS, ...settings }, nodes: [], links: [], frames: [], exposed: [] }
}

export type SocketRef = { nodeId: string; socket: string }

/** Splits "nodeId.socket". Node ids never contain a dot; socket names may not either. */
export function parseSocketRef(ref: string): SocketRef | null {
  const dot = ref.indexOf(".")
  if (dot <= 0 || dot === ref.length - 1 || ref.indexOf(".", dot + 1) !== -1) return null
  return { nodeId: ref.slice(0, dot), socket: ref.slice(dot + 1) }
}

export function socketRef(nodeId: string, socket: string): string {
  return `${nodeId}.${socket}`
}
