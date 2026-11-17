import { useEffect, useRef, useState, type ReactElement } from "react"
import { Icon } from "../app/components/Icon"
import type { GpuContext } from "../engine/gpu"
import { createTestPattern, TEST_PATTERN_LOOP_SECONDS } from "../engine/testPattern"

type Props = { gpu: GpuContext | null }

const PADDING = 16

export function PreviewPane({ gpu }: Props): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [side, setSide] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Fit a square canvas inside the stage.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSide(Math.max(0, Math.floor(Math.min(width, height) - PADDING * 2)))
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // Backing store in device pixels.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pixels = Math.round(side * window.devicePixelRatio)
    canvas.width = pixels
    canvas.height = pixels
  }, [side])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!gpu || !canvas) return
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
  }, [gpu])

  return (
    <section className="preview">
      <header className="pane-header">
        <span className="label">Preview</span>
        <span className="pane-header-note">WGSL test pattern</span>
      </header>
      <div className="preview-stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          style={{ width: side, height: side }}
          data-testid="preview-canvas"
        />
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
