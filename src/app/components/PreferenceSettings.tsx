import type { ReactElement } from "react"
import { applyProfile, currentProfile, parseProfile, setPreferences, usePreferences, WIRE_STYLES, type WireStyle } from "../preferences"
import { session } from "../session"

const WIRE_LABELS: Record<WireStyle, string> = { curved: "Curved", straight: "Straight", stepped: "Stepped" }

async function exportProfile(): Promise<void> {
  try {
    const path = await window.vfxforge?.saveProfile(`${JSON.stringify(currentProfile(), null, 1)}\n`)
    if (path) session.say("Settings profile saved. Import it on another computer under Settings.")
  } catch (error) {
    session.say(`The profile could not be saved. ${error instanceof Error ? error.message : String(error)}`, true)
  }
}

async function importProfile(): Promise<void> {
  try {
    const text = await window.vfxforge?.openProfile()
    if (text === null || text === undefined) return
    const skipped = applyProfile(parseProfile(text))
    session.say(skipped > 0 ? `Settings imported. ${skipped} hotkey${skipped === 1 ? " was" : "s were"} left out because the key is taken or reserved.` : "Settings imported.")
  } catch (error) {
    session.say(error instanceof Error ? error.message : String(error), true)
  }
}

/** Preferences of this computer, and carrying them to another one. */
export function PreferenceSettings(): ReactElement {
  const { wireStyle } = usePreferences()
  return (
    <>
      <h3 className="dialog-section">Editor</h3>
      <div className="param-row">
        <span className="param-label">Wires</span>
        <span className="toolbar-spacer" />
        {WIRE_STYLES.map((style) => (
          <button key={style} className={`chip chip-button${style === wireStyle ? " chip-on" : ""}`} aria-pressed={style === wireStyle} data-testid={`wire-${style}`} onClick={() => setPreferences({ wireStyle: style })}>
            {WIRE_LABELS[style]}
          </button>
        ))}
      </div>
      {window.vfxforge && (
        <>
          <div className="param-row">
            <span className="param-label param-label-wide">Settings profile</span>
            <span className="toolbar-spacer" />
            <button className="chip chip-button" data-testid="profile-export" onClick={() => void exportProfile()}>
              Export…
            </button>
            <button className="chip chip-button" data-testid="profile-import" onClick={() => void importProfile()}>
              Import…
            </button>
          </div>
          <p className="dialog-text">A profile holds the theme, the wire style and your hotkeys. It never holds your OpenAI key.</p>
        </>
      )}
    </>
  )
}
