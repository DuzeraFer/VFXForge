import type { ReactElement } from "react"
import type { ThemeName } from "../hooks/useTheme"
import { Icon } from "./Icon"

export type Tab = { id: string; title: string; kind: "home" | "graph" }

type Props = {
  tabs: Tab[]
  activeTab: string
  onSelectTab: (id: string) => void
  theme: ThemeName
  onToggleTheme: () => void
}

export function TitleBar({ tabs, activeTab, onSelectTab, theme, onToggleTheme }: Props): ReactElement {
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
