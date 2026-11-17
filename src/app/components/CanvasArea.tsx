import type { ReactElement } from "react"
import type { Graph } from "../../doc/types"

export function CanvasArea({ graph }: { graph: Graph | null }): ReactElement {
  return (
    <main className="canvas-area">
      <div className="canvas-empty">
        <div className="canvas-empty-title">
          {graph ? `${graph.name} · ${graph.nodes.length} ${graph.nodes.length === 1 ? "node" : "nodes"}` : "Empty project"}
        </div>
        <div>{graph ? "The node canvas arrives in Phase 2." : "Open a project with Ctrl+O."}</div>
      </div>
    </main>
  )
}
