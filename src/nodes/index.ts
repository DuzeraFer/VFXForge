import { createRegistry, type NodeRegistry, type ResolvedNodeDef } from "../engine/nodeDef"

// Every file in this folder is one node type (docs/06 §6.5). Adding a node = adding one file.
const modules = import.meta.glob<{ default: ResolvedNodeDef }>("./*.ts", { eager: true })

export const nodeDefs: ResolvedNodeDef[] = Object.entries(modules)
  .filter(([path]) => path !== "./index.ts")
  .map(([, module]) => module.default)

export const registry: NodeRegistry = createRegistry(nodeDefs)
