import type { ReactElement } from "react"
import type { ThemeName } from "../hooks/useTheme"
import { session } from "../session"
import { Icon } from "./Icon"

export type Tab = { id: string; title: string; kind: "home" | "graph" }

type Props = {
  tabs: Tab[]
  activeTab: string
  onSelectTab: (id: string) => void
  theme: ThemeName
  onToggleTheme: () => void
  /** Names of the agents working in the document right now. */
  agents: readonly string[]
}

export function TitleBar({ tabs, activeTab, onSelectTab, theme, onToggleTheme, agents }: Props): ReactElement {
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>VFXForge</span>
      </div>

      <div className="tabs" role="tablist" aria-label="Open documents">
        {tabs.map((tab) => (
          <button key={tab.id} role="tab" aria-selected={tab.id === activeTab} className="tab" onClick={() => onSelectTab(tab.id)}>
            {tab.title}
          </button>
        ))}
      </div>

      <div className="titlebar-drag" />

      <div className="titlebar-actions">
        {agents.length > 0 && (
          <span className="agent-pill" title="An agent is connected through MCP and is changing this document.">
            <span className="agent-dot">{agents[0].charAt(0).toUpperCase()}</span>
            {agents.length === 1 ? `${agents[0]} is editing` : `${agents.length} agents are editing`}
          </span>
        )}
        {agents.length === 0 && window.vfxforge && (
          <button
            className="chip chip-button"
            title="Copies the command that connects Claude Code to this app"
            onClick={() => {
              void window.vfxforge!.mcpInfo().then(async (info) => {
                if (!info) return session.say("The agent link is not running.", true)
                try {
                  await navigator.clipboard.writeText(info.command)
                  session.say("Copied. Run it once in a terminal, then ask Claude to work in VFXForge.")
                } catch {
                  session.say(`Run this once in a terminal: ${info.command}`)
                }
              })
            }}
          >
            Connect Claude
          </button>
        )}
        <button
          className="icon-button"
          onClick={onToggleTheme}
          title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          aria-label="Toggle theme"
        >
          <Icon name={theme === "light" ? "moon" : "sun"} />
        </button>
        <span className="avatar" title="You">
          Y
        </span>
        <button className="button-primary" disabled title="Export arrives in Phase 5">
          Export
        </button>
      </div>
      {/* Space for the native window buttons drawn by Electron's title bar overlay. */}
      {window.vfxforge && window.vfxforge.platform !== "darwin" && <div className="titlebar-controls-gap" />}
    </header>
  )
}
