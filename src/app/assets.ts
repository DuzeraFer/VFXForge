/**
 * Loads the image files a project refers to (docs/06 §6.11) into the engine.
 * The main process reads the bytes; decoding happens here. Loading is in the
 * background: a node shows empty until its image arrives, then re-renders.
 */

import type { Project } from "../doc"
import type { Engine } from "../engine/evaluator"
import type { NodeRegistry } from "../engine/nodeDef"

/** Image files referred to by nodes of the project. */
export function assetRefs(project: Project, registry: NodeRegistry): string[] {
  const refs = new Set<string>()
  for (const graph of project.graphs) {
    for (const node of graph.nodes) {
      const param = registry.get(node.type)?.asset
      const ref = param === undefined ? undefined : node.params[param]
      if (typeof ref === "string" && ref !== "") refs.add(ref)
    }
  }
  return [...refs]
}

export type AssetReader = (projectPath: string | null, ref: string) => Promise<Uint8Array | null>

export async function decodeImage(bytes: Uint8Array): Promise<ImageBitmap> {
  // As stored: no premultiplying, no color conversion (the engine works in display values).
  return createImageBitmap(new Blob([bytes as BlobPart]), { premultiplyAlpha: "none", colorSpaceConversion: "none" })
}

export class AssetLoader {
  private engine: Engine | null = null
  private path: string | null = null
  private readonly loading = new Map<string, Promise<boolean>>()
  /** Files that were not found; looked for again when the project moves. */
  private readonly missing = new Set<string>()

  constructor(
    private readonly registry: NodeRegistry,
    private readonly read: AssetReader
  ) {}

  setEngine(engine: Engine | null): void {
    this.engine = engine
    this.loading.clear()
    this.missing.clear()
  }

  /** Loads what the project needs and the engine does not have yet. */
  sync(project: Project, path: string | null): void {
    if (path !== this.path) {
      this.path = path
      this.missing.clear()
    }
    for (const ref of assetRefs(project, this.registry)) void this.ensure(ref)
  }

  /** Resolves once the image is in the engine (true) or cannot be found (false). */
  ensure(ref: string): Promise<boolean> {
    const engine = this.engine
    if (!engine) return Promise.resolve(false)
    if (engine.hasAsset(ref)) return Promise.resolve(true)
    if (this.missing.has(ref)) return Promise.resolve(false)
    let pending = this.loading.get(ref)
    if (!pending) {
      pending = this.read(this.path, ref)
        .then(async (bytes) => {
          if (!bytes || this.engine !== engine) return false
          engine.setAsset(ref, await decodeImage(bytes))
          return true
        })
        .catch(() => false)
        .then((found) => {
          this.loading.delete(ref)
          if (!found) this.missing.add(ref)
          return found
        })
      this.loading.set(ref, pending)
    }
    return pending
  }

  /** A file appeared (generated or imported): look for it again. */
  forget(ref: string): void {
    this.missing.delete(ref)
  }
}
