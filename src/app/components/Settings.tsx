import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react"
import { generation, useGeneration } from "../../ai/generation"
import { NumberField, TextField, Toggle } from "../../inspector/fields"
import { session } from "../session"
import { HotkeySettings } from "./HotkeySettings"
import { PreferenceSettings } from "./PreferenceSettings"
import { Icon } from "./Icon"

let open = false
const listeners = new Set<() => void>()
function setOpen(next: boolean): void {
  open = next
  for (const listener of [...listeners]) listener()
}

export function openSettings(): void {
  setOpen(true)
}

/** Settings dialog: the setup of AI images, editor preferences and the hotkeys. */
export function Settings(): ReactElement | null {
  const shown = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => open
  )
  const { status } = useGeneration()
  const [key, setKey] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const api = window.vfxforge

  useEffect(() => {
    if (!shown) return
    setKey("")
    setProblem(null)
    void generation.refreshStatus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [shown])

  if (!shown) return null

  const saveKey = async (): Promise<void> => {
    if (!api) return
    const result = await api.aiSetKey(key)
    generation.setStatus(result.status)
    setProblem(result.error ?? null)
    if (!result.error) {
      setKey("")
      session.say("OpenAI key saved on this computer.")
    }
  }

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <section className="dialog" role="dialog" aria-label="Settings" data-testid="settings">
        <header className="dialog-header">
          <span>Settings</span>
          <button className="icon-button" aria-label="Close settings" onClick={() => setOpen(false)}>
            <Icon name="close" size={12} />
          </button>
        </header>

        <div className="dialog-body">
          <h3 className="dialog-section">AI images</h3>
          <p className="dialog-text">
            The AI Image node draws a picture from a prompt with OpenAI's Images API, on your own account. Your key is stored encrypted on this computer. It is only ever sent to OpenAI: it is not written into
            projects, and agents such as Claude cannot read it.
          </p>

          {!api || !status ? (
            <p className="dialog-text">AI images are available inside the VFXForge app.</p>
          ) : (
            <>
              <div className="param-row">
                <span className="param-label">OpenAI key</span>
                {status.hasKey ? (
                  <>
                    <span className="field field-grow field-driven" data-testid="key-saved">
                      <span className="field-value">A key is saved</span>
                    </span>
                    <button className="chip chip-button" onClick={() => void api.aiClearKey().then(generation.setStatus)}>
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <span className="field field-grow">
                      <input
                        className="field-input"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="sk-…"
                        aria-label="OpenAI API key"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void saveKey()}
                      />
                    </span>
                    <button className="chip chip-button" disabled={key.trim() === "" || !status.canEncrypt} onClick={() => void saveKey()}>
                      Save
                    </button>
                  </>
                )}
              </div>
              {!status.canEncrypt && <p className="inspector-problems inspector-note">This computer cannot encrypt the key, so it cannot be saved here.</p>}
              {problem && <p className="inspector-problems inspector-note">{problem}</p>}

              <div className="param-row" title="The OpenAI image model to ask. Change it when OpenAI releases a newer one.">
                <span className="param-label">Model</span>
                <TextField value={status.model} label="Image model" onChange={(model) => void api.aiSetSettings({ model }).then(generation.setStatus)} />
              </div>

              <h3 className="dialog-section">Agents</h3>
              <div className="param-row">
                <span className="param-label param-label-wide">Let agents generate images</span>
                <span className="toolbar-spacer" />
                <Toggle value={status.agentAllowed} label="Let agents generate images" onChange={(agentAllowed) => void api.aiSetSettings({ agentAllowed }).then(generation.setStatus)} />
              </div>
              <div className="param-row" data-disabled={!status.agentAllowed || undefined}>
                <span className="param-label param-label-wide">Images per agent session</span>
                <span className="toolbar-spacer" />
                <NumberField
                  className="field-narrow"
                  value={status.agentLimit}
                  integer
                  min={1}
                  max={50}
                  step={0.1}
                  label="Images per agent session"
                  onChange={(agentLimit) => void api.aiSetSettings({ agentLimit }).then(generation.setStatus)}
                />
              </div>
              <p className="dialog-text">
                Off by default, because every picture is paid for by your OpenAI account. While it is off, an agent can still write the prompt and ask you to press Generate.
              </p>
            </>
          )}
          <PreferenceSettings />
          <HotkeySettings />
        </div>
      </section>
    </div>
  )
}
