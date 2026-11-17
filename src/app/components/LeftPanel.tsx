import { useState, type ReactElement, type ReactNode } from "react"
import { Icon } from "./Icon"

/** Library categories from docs/04-node-library.md. Nodes arrive in Phase 1. */
const LIBRARY_CATEGORIES = [
  "Inputs",
  "Shapes",
  "Splines",
  "Noises",
  "Patterns",
  "Transform",
  "Tone & Color",
  "Filters",
  "Blending",
  "Math",
  "Outputs"
]

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(true)
  return (
    <section className="panel-section">
      <button className="section-header" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="label">{title}</span>
        <span className="section-chevron" data-open={open}>
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}

export function LeftPanel(): ReactElement {
  return (
    <aside className="left-panel">
      <div className="left-panel-scroll">
        <Section title="Graphs">
          <p className="empty-note">No graphs yet.</p>
        </Section>

        <Section title="Library">
          <label className="search-field">
            <Icon name="search" size={14} />
            <input type="search" placeholder="Search nodes" disabled />
          </label>
          <ul className="row-list">
            {LIBRARY_CATEGORIES.map((name) => (
              <li key={name} className="row row-muted">
                {name}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="References">
          <p className="empty-note">No reference images.</p>
        </Section>
      </div>
      <footer className="left-panel-footer">VFXForge 0.0.1 · Phase 0</footer>
    </aside>
  )
}
