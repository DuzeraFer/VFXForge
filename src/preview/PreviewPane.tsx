import { useEffect, useRef, useState, type ReactElement } from "react"
import { Icon } from "../app/components/Icon"
import type { Graph } from "../doc/types"
import type { Engine } from "../engine/evaluator"
import type { GpuContext } from "../engine/gpu"
import { resolveTarget } from "../engine/render"
import { createTestPattern, TEST_PATTERN_LOOP_SECONDS } from "../engine/testPattern"
import { registry } from "../nodes"
import { createPresenter } from "./present"

type Props = {
  gpu: GpuContext | null
  engine: Engine | null
  /** Graph to show. Its first Output node is previewed; with none, the test pattern is drawn. */
  graph: Graph | null
  projectSeed: number
}

const PADDING = 16

function hasOutput(graph: Graph | null): graph is Graph {
  return !!graph && graph.nodes.some((n) => n.type === "output")
}

export function PreviewPane({ gpu, engine, graph, projectSeed }: Props): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [error, setError] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)

  const showGraph = hasOutput(graph)
  const aspect = showGraph ? graph.settings.width / graph.settings.height : 1

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width - PADDING * 2, height: entry.contentRect.height - PADDING * 2 })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // Largest size with the image's aspect ratio that fits the stage.
  const width = Math.max(0, Math.floor(Math.min(box.width, box.height * aspect)))
  const height = Math.max(0, Math.floor(width / aspect))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = Math.round(width * window.devicePixelRatio)
    canvas.height = Math.round(height * window.devicePixelRatio)
  }, [width, height])

  // Test pattern: shown until a graph with an Output node is open.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!gpu || !canvas || showGraph) return
    let pattern: ReturnType<typeof createTestPattern>
    try {
      pattern = createTestPattern(gpu, canvas)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    let raf = 0
    const tick = (now: number): void => {
      pattern.draw(((now / 1000) % TEST_PATTERN_LOOP_SECONDS) / TEST_PATTERN_LOOP_SECONDS)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      pattern.destroy()
    }
  }, [gpu, showGraph])

  // Graph preview: pulls the Output through the engine once per animation
  // frame and redraws only when its content key changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!gpu || !engine || !canvas || !showGraph) return
    const presenter = createPresenter(gpu, canvas)
    let raf = 0
    let lastKey = ""
    let lastSize = ""
    let stopped = false
    const start = performance.now()

    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      const { frames, fps } = graph.settings
      const current = frames > 1 ? Math.floor(((now - start) / 1000) * fps) % frames : 0
      try {
        const { problems } = engine.setGraph(graph, projectSeed)
        const target = resolveTarget(graph, registry, undefined)
        if (problems.length > 0) throw new Error(`${problems[0].nodeId}: ${problems[0].message}`)
        const key = engine.keyOf(target.nodeId, target.output, current)
        const size = `${canvas.width}x${canvas.height}`
        if (key !== lastKey || size !== lastSize) {
          presenter.present(engine.evaluate(target.nodeId, target.output, current))
          lastKey = key
          lastSize = size
          setFrame(current)
          // Shader compile errors arrive late; show them when they do.
          void engine.settle().then(
            () => !stopped && setError(null),
            (e: unknown) => !stopped && setError(e instanceof Error ? e.message : String(e))
          )
        }
      } catch (e) {
        lastKey = ""
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      presenter.destroy()
    }
  }, [gpu, engine, graph, projectSeed, showGraph])

  const note = showGraph
    ? `${graph.settings.width}×${graph.settings.height}${graph.settings.frames > 1 ? ` · frame ${String(frame + 1).padStart(2, "0")} / ${graph.settings.frames}` : ""}`
    : "WGSL test pattern"

  return (
    <section className="preview">
      <header className="pane-header">
        <span className="label">Preview</span>
        <span className="pane-header-note">{note}</span>
      </header>
      <div className="preview-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="preview-canvas" style={{ width, height }} data-testid="preview-canvas" />
        {error && <div className="preview-error">{error}</div>}
      </div>
      <div className="preview-toolbar" title="Preview controls arrive in Phase 2">
        <button className="field-button" disabled>
          RGBA <Icon name="chevron" size={12} />
        </button>
        <span className="preview-zoom">Fit</span>
        <span className="toolbar-spacer" />
        <button className="icon-button" disabled aria-label="Tile 2×2">
          <Icon name="tile" />
        </button>
      </div>
    </section>
  )
}
