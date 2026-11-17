/**
 * Node thumbnails. One offscreen WebGPU canvas renders each thumbnail, which
 * is then copied into the node card's 2D canvas. Work is pulled once per
 * animation frame, only for cards whose content key changed, within a time
 * budget so the UI stays responsive (docs/06 §6.6).
 */

import type { Graph } from "../doc/types"
import type { Engine } from "../engine/evaluator"
import type { GpuContext } from "../engine/gpu"
import { createPresenter, type Presenter } from "./present"

export const THUMBNAIL_SIZE = 88
const BUDGET_MS = 6

type Watch = { nodeId: string; output: string; canvas: HTMLCanvasElement; drawnKey: string }

export class Thumbnails {
  private readonly offscreen: OffscreenCanvas
  private readonly presenter: Presenter
  private readonly watches = new Set<Watch>()
  private graph: Graph | null = null
  private seed = 0
  private frame = 0
  private raf = 0

  constructor(
    gpu: GpuContext,
    private readonly engine: Engine
  ) {
    const pixels = Math.round(THUMBNAIL_SIZE * Math.min(2, window.devicePixelRatio))
    this.offscreen = new OffscreenCanvas(pixels, pixels)
    this.presenter = createPresenter(gpu, this.offscreen)
    const tick = (): void => {
      this.raf = requestAnimationFrame(tick)
      this.flush()
    }
    this.raf = requestAnimationFrame(tick)
  }

  get pixelSize(): number {
    return this.offscreen.width
  }

  setContext(graph: Graph | null, seed: number, frame: number): void {
    this.graph = graph
    this.seed = seed
    this.frame = frame
  }

  /** Keeps `canvas` showing `nodeId.output` until the returned function is called. */
  watch(nodeId: string, output: string, canvas: HTMLCanvasElement): () => void {
    const watch: Watch = { nodeId, output, canvas, drawnKey: "" }
    this.watches.add(watch)
    return () => this.watches.delete(watch)
  }

  private flush(): void {
    const graph = this.graph
    if (!graph || this.watches.size === 0) return
    const started = performance.now()
    this.engine.setGraph(graph, this.seed)
    for (const watch of this.watches) {
      let key: string
      try {
        key = this.engine.keyOf(watch.nodeId, watch.output, this.frame)
      } catch {
        key = "error"
      }
      if (key === watch.drawnKey) continue
      const context = watch.canvas.getContext("2d")
      if (!context) continue
      context.clearRect(0, 0, watch.canvas.width, watch.canvas.height)
      if (key !== "error") {
        try {
          this.presenter.present(this.engine.evaluate(watch.nodeId, watch.output, this.frame))
          context.drawImage(this.offscreen, 0, 0, watch.canvas.width, watch.canvas.height)
        } catch {
          key = "error"
        }
      }
      watch.drawnKey = key
      // The rest waits for the next animation frame.
      if (performance.now() - started > BUDGET_MS) break
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.presenter.destroy()
    this.watches.clear()
  }
}
