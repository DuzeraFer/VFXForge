import type { ReactElement } from "react"
import { Icon, type IconName } from "./Icon"

import { frameSelection } from "../commands"
import { comboFor, showCombo, useHotkeys, type HotkeyAction } from "../hotkeys"

export type ToolId = "select" | "pan" | "reroute"

type Item = { id: ToolId | "frame" | "comment" | "measure"; label: string; icon: IconName; hotkey?: HotkeyAction; hint?: string; later?: string }

const TOOLS: Item[] = [
  { id: "select", label: "Select", icon: "select", hotkey: "tool.select" },
  { id: "pan", label: "Pan", icon: "pan", hotkey: "tool.pan" },
  { id: "frame", label: "Frame the selected nodes", icon: "frame", hotkey: "node.frame" },
  { id: "comment", label: "Comment", icon: "comment", hint: "Select a node and write under Comments in the Inspector" },
  { id: "reroute", label: "Reroute: click a wire to add a point", icon: "reroute", hotkey: "tool.reroute" },
  { id: "measure", label: "Measure / Pick color", icon: "measure", later: "a later phase" }
]

export function ToolStrip({ tool, onTool }: { tool: ToolId; onTool: (tool: ToolId) => void }): ReactElement {
  useHotkeys()
  return (
    <nav className="toolstrip" aria-label="Tools">
      {TOOLS.map((item) => (
        <button
          key={item.id}
          className="tool"
          aria-pressed={item.id === tool}
          disabled={!!item.later || !!item.hint}
          data-testid={`tool-${item.id}`}
          title={item.later ? `${item.label} (arrives in ${item.later})` : item.hint ? `${item.label}: ${item.hint}` : `${item.label}${item.hotkey ? ` (${showCombo(comboFor(item.hotkey))})` : ""}`}
          aria-label={item.label}
          onClick={() => (item.id === "frame" ? frameSelection() : item.id === "select" || item.id === "pan" || item.id === "reroute" ? onTool(item.id) : undefined)}
        >
          <Icon name={item.icon} />
        </button>
      ))}
    </nav>
  )
}
