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
        <Icon name="logo" />
        <span>VFXForge</span>
      </div>

      <div className="tabs" role="tablist" aria-label="Open documents">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTab}
            className="tab"
            onClick={() => onSelectTab(tab.id)}
          >
            <Icon name={tab.kind === "home" ? "home" : "doc"} size={14} />
            <span>{tab.title}</span>
          </button>
        ))}
      </div>

      <div className="titlebar-drag" />

      <div className="presence" aria-label="Who is in this document">
        <span className="avatar" title="You">
          Y
        </span>
        <span className="avatar avatar-agent" title="Claude — not connected">
          C
        </span>
      </div>
      <button
        className="icon-button"
        onClick={onToggleTheme}
        title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
        aria-label="Toggle theme"
      >
        <Icon name={theme === "light" ? "moon" : "sun"} />
      </button>
      {/* Space for the native window buttons drawn by Electron's title bar overlay. */}
      {window.vfxforge && window.vfxforge.platform !== "darwin" && <div className="titlebar-controls-gap" />}
    </header>
  )
}
