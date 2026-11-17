import { useEffect, useState, type ReactElement } from "react"
import { comboFor, comboOf, HOTKEYS, hotkeysChanged, resetHotkeys, setHotkey, showCombo, useHotkeys, type HotkeyAction } from "../hotkeys"

/** The editor's hotkeys. Click one, then press the new key. */
export function HotkeySettings(): ReactElement {
  const custom = useHotkeys()
  const [recording, setRecording] = useState<HotkeyAction | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    // Before every other key handler, so that the key being chosen does nothing else.
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === "Escape") return setRecording(null)
      const combo = comboOf(event)
      if (!combo) return
      const refused = setHotkey(recording, combo)
      setProblem(refused)
      if (!refused) setRecording(null)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [recording])

  return (
    <>
      <h3 className="dialog-section">Hotkeys</h3>
      <p className="dialog-text">Click a key, then press the one you want instead. Escape cancels. Save, undo, copy and paste follow your system and cannot be changed.</p>
      <div className="hotkey-list" data-testid="hotkeys">
        {HOTKEYS.map((hotkey) => (
          <div key={hotkey.id} className="hotkey-row">
            <span>{hotkey.label}</span>
            <button
              className="hotkey-key"
              data-recording={recording === hotkey.id || undefined}
              data-custom={custom[hotkey.id] !== undefined || undefined}
              data-testid={`hotkey-${hotkey.id}`}
              aria-label={`Hotkey for ${hotkey.label}`}
              onClick={() => {
                setProblem(null)
                setRecording(recording === hotkey.id ? null : hotkey.id)
              }}
            >
              {recording === hotkey.id ? "Press a key" : showCombo(comboFor(hotkey.id))}
            </button>
          </div>
        ))}
      </div>
      {problem && (
        <p className="dialog-text dialog-problem" data-testid="hotkey-problem">
          {problem}
        </p>
      )}
      {hotkeysChanged() && (
        <div className="dialog-actions">
          <button
            className="chip chip-button"
            data-testid="hotkeys-reset"
            onClick={() => {
              resetHotkeys()
              setProblem(null)
            }}
          >
            Reset all hotkeys
          </button>
        </div>
      )}
    </>
  )
}
