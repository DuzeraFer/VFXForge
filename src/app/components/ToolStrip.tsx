import type { ReactElement } from "react"
import { Icon, type IconName } from "./Icon"

export type ToolId = "select" | "pan"

const TOOLS: { id: ToolId | "frame" | "comment" | "reroute" | "measure"; label: string; icon: IconName; later?: string }[] = [
  { id: "select", label: "Select (V)", icon: "select" },
  { id: "pan", label: "Pan (H)", icon: "pan" },
  { id: "frame", label: "Frame", icon: "frame", later: "a later phase" },
  { id: "comment", label: "Comment", icon: "comment", later: "a later phase" },
  { id: "reroute", label: "Reroute", icon: "reroute", later: "a later phase" },
  { id: "measure", label: "Measure / Pick color", icon: "measure", later: "a later phase" }
]

export function ToolStrip({ tool, onTool }: { tool: ToolId; onTool: (tool: ToolId) => void }): ReactElement {
  return (
    <nav className="toolstrip" aria-label="Tools">
      {TOOLS.map((item) => (
        <button
          key={item.id}
          className="tool"
          aria-pressed={item.id === tool}
          disabled={!!item.later}
          title={item.later ? `${item.label} (arrives in ${item.later})` : item.label}
          aria-label={item.label}
          onClick={() => !item.later && onTool(item.id as ToolId)}
        >
          <Icon name={item.icon} />
        </button>
      ))}
    </nav>
  )
}
