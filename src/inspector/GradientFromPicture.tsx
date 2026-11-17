import { useEffect, useRef, useState, type ReactElement } from "react"
import { createPortal } from "react-dom"
import type { GradientStop } from "../doc/types"
import type { Rgba8Image } from "../engine/render"
import { assetPixels } from "../app/board"
import { useSession } from "../app/session"
import { Icon } from "../app/components/Icon"
import { gradientFromSamples, sampleGradient, sampleLine } from "./gradient"

type Point = [number, number]
type Props = { onPick: (stops: GradientStop[]) => void; onClose: () => void }

/** Drag a line across a reference picture; the colors under it become a gradient, from the start of the line to its end. */
export function GradientFromPicture({ onPick, onClose }: Props): ReactElement {
  const { project } = useSession()
  const [refId, setRefId] = useState(project.references[0]?.id ?? "")
  const reference = project.references.find((r) => r.id === refId)
  const [pixels, setPixels] = useState<Rgba8Image | null>(null)
  const [line, setLine] = useState<{ from: Point; to: Point }>({ from: [0.5, 0.9], to: [0.5, 0.1] })
  const pictureRef = useRef<HTMLCanvasElement>(null)
  const barRef = useRef<HTMLCanvasElement>(null)
  const stops = pixels ? gradientFromSamples(sampleLine(pixels, line.from, line.to)) : null

  useEffect(() => {
    let stale = false
    setPixels(null)
    if (reference) void assetPixels(reference.image).then((found) => !stale && setPixels(found))
    return () => {
      stale = true
    }
  }, [reference?.image])

  useEffect(() => {
    const canvas = pictureRef.current
    if (!canvas || !pixels) return
    canvas.width = pixels.width
    canvas.height = pixels.height
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0)
  }, [pixels])

  useEffect(() => {
    const canvas = barRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context || !stops) return
    const image = context.createImageData(canvas.width, 1)
    for (let x = 0; x < canvas.width; x++) {
      const [r, g, b, a] = sampleGradient(stops, x / (canvas.width - 1), 1 / canvas.width)
      image.data.set([r * 255, g * 255, b * 255, a * 255], x * 4)
    }
    context.putImageData(image, 0, 0)
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const pointAt = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clamp = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000
    return [clamp((e.clientX - rect.left) / rect.width), clamp((e.clientY - rect.top) / rect.height)]
  }

  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="dialog dialog-wide" role="dialog" aria-label="Gradient from a picture" data-testid="gradient-picture-dialog">
        <header className="dialog-header">
          <span className="dialog-title">Gradient from a picture</span>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="dialog-body">
          <p className="dialog-text">Drag a line across the picture, from the color that should be first to the color that should be last. Flat cel colors become hard steps.</p>
          {project.references.length > 1 && (
            <label className="field field-select">
              <select value={refId} aria-label="Reference picture" onChange={(e) => setRefId(e.target.value)}>
                {project.references.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name ?? r.id}
                  </option>
                ))}
              </select>
              <span className="field-caret">⌄</span>
            </label>
          )}
          <div className="gradient-picture">
            <div
              className="gradient-picture-frame"
              data-testid="gradient-picture"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                const at = pointAt(e)
                setLine({ from: at, to: at })
              }}
              onPointerMove={(e) => {
                if (e.buttons !== 1) return
                // Read now: the event's target is gone by the time the state update runs.
                const to = pointAt(e)
                setLine((now) => ({ from: now.from, to }))
              }}
            >
              <canvas ref={pictureRef} />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                <line x1={line.from[0] * 100} y1={line.from[1] * 100} x2={line.to[0] * 100} y2={line.to[1] * 100} vectorEffect="non-scaling-stroke" />
              </svg>
              <span className="gradient-picture-dot" style={{ left: `${line.from[0] * 100}%`, top: `${line.from[1] * 100}%` }} />
              <span className="gradient-picture-dot" data-end style={{ left: `${line.to[0] * 100}%`, top: `${line.to[1] * 100}%` }} />
            </div>
          </div>
          <div className="gradient-track">
            <canvas ref={barRef} className="gradient-bar" width={256} height={1} />
          </div>
          <div className="dialog-actions">
            <button className="chip chip-button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="button-primary"
              disabled={!stops}
              data-testid="gradient-picture-use"
              onClick={() => {
                if (stops) onPick(stops)
                onClose()
              }}
            >
              Use these {stops?.length ?? ""} colors
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  )
}
