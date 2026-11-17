import type { ReactElement } from "react"
import { Icon } from "./Icon"

type Props = { open: boolean; onToggle: () => void }

/** Shell only: transport and scrubbing come with animation in Phase 4. */
export function Timeline({ open, onToggle }: Props): ReactElement {
  return (
    <footer className="timeline" data-open={open}>
      <button className="timeline-toggle" aria-expanded={open} onClick={onToggle} title="Show or hide the timeline">
        <span className="section-chevron" data-open={open}>
          <Icon name="chevron" size={12} />
        </span>
        <span className="label">Timeline</span>
      </button>
      {open && (
        <div className="timeline-body">
          <button className="icon-button" disabled aria-label="Previous frame">
            <Icon name="prev" />
          </button>
          <button className="icon-button" disabled aria-label="Play">
            <Icon name="play" />
          </button>
          <button className="icon-button" disabled aria-label="Next frame">
            <Icon name="next" />
          </button>
          <span className="timeline-readout">frame 00 / 00</span>
          <div className="timeline-track" aria-hidden="true" />
          <span className="timeline-readout">12 fps</span>
        </div>
      )}
    </footer>
  )
}
