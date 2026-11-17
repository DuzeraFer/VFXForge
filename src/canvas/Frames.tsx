import { useState, type ReactElement } from "react"
import { deleteFrame, editFrame } from "../app/board"
import { Icon } from "../app/components/Icon"
import { session } from "../app/session"
import { FRAME_COLORS, type CommentBox, type Graph } from "../doc"

type Placed = { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number } }
type Box = { x: number; y: number; width: number; height: number }

const PAD = 24
const HEADER = 28

/** The rectangle around a frame's nodes, in canvas units. Null when none of them is on the canvas. */
export function frameBox(frame: CommentBox, nodes: readonly Placed[]): Box | null {
  const members = nodes.filter((n) => frame.nodeIds.includes(n.id))
  if (members.length === 0) return null
  const left = Math.min(...members.map((n) => n.position.x))
  const top = Math.min(...members.map((n) => n.position.y))
  const right = Math.max(...members.map((n) => n.position.x + (n.measured?.width ?? 120)))
  const bottom = Math.max(...members.map((n) => n.position.y + (n.measured?.height ?? 136)))
  return { x: left - PAD, y: top - PAD - HEADER, width: right - left + PAD * 2, height: bottom - top + PAD * 2 + HEADER }
}

function Frame({ frame, box }: { frame: CommentBox; box: Box }): ReactElement {
  const [editing, setEditing] = useState<string | null>(null)
  const color = frame.color ?? "gray"
  const finish = (): void => {
    if (editing !== null && editing.trim() !== frame.title) editFrame(frame.id, { title: editing })
    setEditing(null)
  }
  return (
    <div className="frame" data-color={color} data-testid="frame" style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.width, height: box.height }}>
      <header className="frame-header" title={frame.note}>
        {editing !== null ? (
          <input
            className="frame-title-input nodrag"
            value={editing}
            autoFocus
            onFocus={(e) => e.target.select()}
            maxLength={80}
            aria-label="Frame title"
            onChange={(e) => setEditing(e.target.value)}
            onBlur={finish}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Enter") finish()
              else if (e.key === "Escape") setEditing(null)
            }}
          />
        ) : (
          <button className="frame-title" data-testid="frame-title" title="Click to select the nodes inside. Double-click to rename." onClick={() => session.select(frame.nodeIds)} onDoubleClick={() => setEditing(frame.title)}>
            {frame.title}
          </button>
        )}
        <button
          className="frame-swatch"
          title="Change the color"
          aria-label="Change the frame's color"
          data-testid="frame-color"
          onClick={() => editFrame(frame.id, { color: FRAME_COLORS[(FRAME_COLORS.indexOf(color as (typeof FRAME_COLORS)[number]) + 1) % FRAME_COLORS.length] })}
        />
        <button className="frame-remove" title="Remove the frame (the nodes stay)" aria-label="Remove the frame" data-testid="frame-remove" onClick={() => deleteFrame(frame.id)}>
          <Icon name="close" size={10} />
        </button>
      </header>
      {frame.note && <p className="frame-note">{frame.note}</p>}
    </div>
  )
}

/** Titled boxes behind groups of nodes. A frame follows its nodes; it has no place of its own. */
export function Frames({ graph, nodes }: { graph: Graph; nodes: readonly Placed[] }): ReactElement {
  return (
    <>
      {graph.frames.map((frame) => {
        const box = frameBox(frame, nodes)
        return box ? <Frame key={frame.id} frame={frame} box={box} /> : null
      })}
    </>
  )
}
