import { useEffect, useRef, type ReactElement } from "react"
import type { Rgba8Image } from "../../engine/render"
import { closeVariations, pickVariation, useVariationOffer } from "../variations"
import { Icon } from "./Icon"

function Picture({ image }: { image: Rgba8Image }): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  }, [image])
  return <canvas ref={ref} className="variation-image" />
}

/** A grid of versions to choose from. Clicking one applies it as one undoable step. */
export function Variations(): ReactElement | null {
  const offer = useVariationOffer()
  useEffect(() => {
    if (!offer) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeVariations()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [offer])
  if (!offer) return null
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeVariations()}>
      <section className="dialog dialog-wide" role="dialog" aria-label="Variations" data-testid="variations-dialog">
        <header className="dialog-header">
          <span className="dialog-title">{offer.from ? `${offer.from} made ${offer.items.length} variations` : `${offer.items.length} variations`}</span>
          <button className="icon-button" aria-label="Close" onClick={closeVariations}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="dialog-body">
          <p className="dialog-text">{offer.note ?? "Click the one you like. It is applied as one step that you can undo."}</p>
          <div className="variation-grid">
            {offer.items.map((item, index) => (
              <button key={index} className="variation" onClick={() => pickVariation(index)} data-testid="variation">
                <Picture image={item.image} />
                <span className="variation-label">{item.variation.label}</span>
              </button>
            ))}
          </div>
          <div className="dialog-actions">
            <button className="chip chip-button" onClick={closeVariations}>
              Keep it as it is
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
