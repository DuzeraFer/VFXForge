import type { ReactElement } from "react"

export function Inspector(): ReactElement {
  return (
    <section className="inspector">
      <header className="pane-header">
        <span className="label">Inspector</span>
      </header>
      <p className="empty-note inspector-empty">Nothing selected.</p>
    </section>
  )
}
