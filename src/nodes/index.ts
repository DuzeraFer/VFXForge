import type { Graph } from "../doc/types"
import { functionDef, functionIdOf } from "../engine/functions"
import { createRegistry, type NodeRegistry, type ResolvedNodeDef } from "../engine/nodeDef"

// Every file in this folder is one node type (docs/06 §6.5). Adding a node = adding one file.
const modules = import.meta.glob<{ default: ResolvedNodeDef }>("./*.ts", { eager: true })

export const nodeDefs: ResolvedNodeDef[] = Object.entries(modules)
  .filter(([path]) => path !== "./index.ts")
  .map(([, module]) => module.default)

const builtIn = createRegistry(nodeDefs)

// Functions of the open project are node types too (docs/07 Phase 7). Their
// definitions are made on demand from the graphs and kept until the graphs change.
let functions = new Map<string, Graph>()
let cache = new Map<string, ResolvedNodeDef | null>()
let revision = 0
const building = new Set<string>()

function functionNode(id: string): ResolvedNodeDef | undefined {
  const graph = functions.get(id)
  if (!graph) return undefined
  if (cache.has(id)) return cache.get(id) ?? undefined
  // A function that (through others) uses itself has no definition; the node shows as an unknown type.
  if (building.has(id)) return undefined
  building.add(id)
  try {
    const def = functionDef(graph, registry)
    cache.set(id, def)
    return def ?? undefined
  } finally {
    building.delete(id)
  }
}

export const registry: NodeRegistry = {
  get: (type) => {
    const id = functionIdOf(type)
    return id !== null && functions.has(id) ? functionNode(id) : builtIn.get(type)
  },
  list: () => [...builtIn.list(), ...[...functions.keys()].map(functionNode).filter((d): d is ResolvedNodeDef => !!d)],
  revision: () => revision
}

/**
 * Tells the registry which graphs of the open project are functions. Call it
 * whenever the project changes; it does nothing when the function graphs are
 * the same objects as last time.
 */
export function setProjectFunctions(graphs: readonly Graph[]): void {
  const next = graphs.filter((g) => g.function)
  if (next.length === functions.size && next.every((g) => functions.get(g.id) === g)) return
  functions = new Map(next.map((g) => [g.id, g]))
  cache = new Map()
  revision++
}
