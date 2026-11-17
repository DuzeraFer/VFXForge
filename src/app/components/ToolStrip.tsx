import { useState, type ReactElement } from "react"
import { Icon, type IconName } from "./Icon"

const TOOLS: { id: string; label: string; icon: IconName }[] = [
  { id: "select", label: "Select", icon: "select" },
  { id: "pan", label: "Pan", icon: "pan" },
  { id: "frame", label: "Frame", icon: "frame" },
  { id: "comment", label: "Comment", icon: "comment" },
  { id: "reroute", label: "Reroute", icon: "reroute" },
  { id: "measure", label: "Measure / Pick color", icon: "measure" }
]

export function ToolStrip(): ReactElement {
  const [active, setActive] = useState("select")
  return (
    <nav className="toolstrip" aria-label="Tools">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          className="tool"
          aria-pressed={tool.id === active}
          title={tool.label}
          aria-label={tool.label}
          onClick={() => setActive(tool.id)}
        >
          <Icon name={tool.icon} />
        </button>
      ))}
    </nav>
  )
}
