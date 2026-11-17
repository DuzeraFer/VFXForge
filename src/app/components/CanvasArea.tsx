import type { ReactElement } from "react"

export function CanvasArea(): ReactElement {
  return (
    <main className="canvas-area">
      <div className="canvas-empty">
        <div className="canvas-empty-title">Empty graph</div>
        <div>The node canvas arrives in Phase 2.</div>
      </div>
    </main>
  )
}
