import { useRef, type ReactElement } from "react"
import type { GraphSettings } from "../../doc"
import { playback, usePlayback } from "../playback"
import { Icon } from "./Icon"

type Props = { open: boolean; onToggle: () => void; settings: GraphSettings | null }

const pad = (n: number): string => String(n).padStart(2, "0")

export function Timeline({ open, onToggle, settings }: Props): ReactElement {
  const { playing, frame, onion } = usePlayback()
  const cellsRef = useRef<HTMLDivElement>(null)
  const frames = settings?.frames ?? 1
  const animated = frames > 1

  const seekAt = (clientX: number): void => {
    const rect = cellsRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    playback.seek(Math.max(0, Math.min(frames - 1, Math.floor(((clientX - rect.left) / rect.width) * frames))))
  }

  return (
    <footer className="timeline" data-open={open}>
      <button className="timeline-toggle" aria-expanded={open} onClick={onToggle} title="Show or hide the timeline">
        <span className="label">Timeline</span>
      </button>
      {open && (
        <div className="timeline-body">
          <button className="icon-button" disabled={!animated} aria-label="Previous frame" title="Previous frame (,)" onClick={() => playback.step(-1)}>
            <Icon name="prev" size={14} />
          </button>
          <button
            className="icon-button"
            disabled={!animated}
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause (K)" : "Play (K)"}
            onClick={() => playback.setPlaying(!playing)}
            data-testid="play-toggle"
          >
            <Icon name={playing && animated ? "pause" : "play"} size={14} />
          </button>
          <button className="icon-button" disabled={!animated} aria-label="Next frame" title="Next frame (.)" onClick={() => playback.step(1)}>
            <Icon name="next" size={14} />
          </button>
          <span className="timeline-readout mono" data-testid="frame-readout">
            {pad(frame + 1)} / {pad(frames)}
          </span>
          <div
            ref={cellsRef}
            className="timeline-cells"
            data-disabled={!animated || undefined}
            onPointerDown={(e) => {
              if (!animated) return
              e.currentTarget.setPointerCapture(e.pointerId)
              seekAt(e.clientX)
            }}
            onPointerMove={(e) => e.buttons === 1 && animated && seekAt(e.clientX)}
          >
            {Array.from({ length: Math.min(frames, 64) }, (_, i) => {
              // With more frames than cells, each cell stands for a run of frames.
              const at = Math.floor((frame / frames) * Math.min(frames, 64))
              return <span key={i} className="timeline-cell" data-state={i === at ? "current" : i < at ? "played" : undefined} />
            })}
          </div>
          <span className="timeline-readout">{settings?.fps ?? 12} fps</span>
          <button
            className="text-button"
            data-on={onion || undefined}
            disabled={!animated}
            title="Onion skin: also show the frame before (warm) and after (cool) in Preview"
            onClick={() => playback.setOnion(!onion)}
            data-testid="onion-toggle"
          >
            Onion
          </button>
          <span className="timeline-readout">
            Loop <span className={settings?.loop === false ? undefined : "timeline-ok"}>{settings?.loop === false ? "○" : "✓"}</span>
          </span>
        </div>
      )}
    </footer>
  )
}
