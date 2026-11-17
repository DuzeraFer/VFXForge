/**
 * Editor hotkeys the artist can change (docs/03, "Customizable hotkeys").
 * File and edit menu shortcuts (save, undo, copy, paste) follow the system and stay fixed.
 */

import { useSyncExternalStore } from "react"

export const HOTKEYS = [
  { id: "tool.select", label: "Select tool", group: "Tools", combo: "V" },
  { id: "tool.pan", label: "Pan tool", group: "Tools", combo: "H" },
  { id: "tool.reroute", label: "Reroute tool", group: "Tools", combo: "R" },
  { id: "node.search", label: "Add a node", group: "Nodes", combo: "Space" },
  { id: "node.duplicate", label: "Duplicate", group: "Nodes", combo: "Mod+D" },
  { id: "node.bypass", label: "Bypass", group: "Nodes", combo: "B" },
  { id: "node.pin", label: "Pin to Preview", group: "Nodes", combo: "1" },
  { id: "node.frame", label: "Frame the selection", group: "Nodes", combo: "G" },
  { id: "select.all", label: "Select all", group: "Nodes", combo: "Mod+A" },
  { id: "graph.align", label: "Auto-align", group: "View", combo: "L" },
  { id: "view.fitSelection", label: "Zoom to selection", group: "View", combo: "F" },
  { id: "view.fitAll", label: "Zoom to fit", group: "View", combo: "A" },
  { id: "play.toggle", label: "Play / pause", group: "Playback", combo: "K" },
  { id: "play.previous", label: "Previous frame", group: "Playback", combo: "," },
  { id: "play.next", label: "Next frame", group: "Playback", combo: "." }
] as const

export type HotkeyAction = (typeof HOTKEYS)[number]["id"]

const STORAGE_KEY = "vfxforge.hotkeys"
/** Keys that belong to the menu or to typing, whatever the artist asks for. */
const RESERVED = new Set(["Mod+C", "Mod+V", "Mod+X", "Mod+Z", "Mod+Shift+Z", "Mod+Y", "Mod+S", "Mod+Shift+S", "Mod+O", "Mod+N", "Escape", "Enter", "Delete", "Backspace", "Tab"])

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

/** "Mod+Shift+D" for a key press; null while only modifier keys are down. */
export function comboOf(event: KeyLike): string | null {
  const { key } = event
  if (key === "Control" || key === "Meta" || key === "Alt" || key === "Shift" || key === "Dead" || key === "Unidentified") return null
  const name = key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key
  return [event.ctrlKey || event.metaKey ? "Mod" : "", event.altKey ? "Alt" : "", event.shiftKey && (key.length > 1 || /[a-z]/i.test(key)) ? "Shift" : "", name].filter(Boolean).join("+")
}

function read(): Partial<Record<HotkeyAction, string>> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")
    if (!raw || typeof raw !== "object") return {}
    const known = new Set<string>(HOTKEYS.map((h) => h.id))
    return Object.fromEntries(Object.entries(raw).filter(([id, combo]) => known.has(id) && typeof combo === "string"))
  } catch {
    return {}
  }
}

let custom = read()
let table = build()
const listeners = new Set<() => void>()

function build(): Map<string, HotkeyAction> {
  const map = new Map<string, HotkeyAction>()
  for (const hotkey of HOTKEYS) map.set(custom[hotkey.id] ?? hotkey.combo, hotkey.id)
  return map
}

function commit(next: Partial<Record<HotkeyAction, string>>): void {
  custom = next
  table = build()
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))
  } catch {
    // Without storage the change lasts until the window closes.
  }
  for (const listener of [...listeners]) listener()
}

export const comboFor = (id: HotkeyAction): string => custom[id] ?? HOTKEYS.find((h) => h.id === id)!.combo

/** The action a key press stands for, if any. */
export function actionFor(event: KeyLike): HotkeyAction | null {
  const combo = comboOf(event)
  return combo ? (table.get(combo) ?? null) : null
}

/** Gives an action a new key. Returns what is wrong, or null when it is set. */
export function setHotkey(id: HotkeyAction, combo: string): string | null {
  if (RESERVED.has(combo)) return `${combo.replace("Mod", "Ctrl")} is kept for the menu and for editing.`
  const owner = table.get(combo)
  if (owner && owner !== id) return `${combo.replace("Mod", "Ctrl")} is already used by “${HOTKEYS.find((h) => h.id === owner)!.label}”. Change that one first.`
  const next = { ...custom, [id]: combo }
  if (combo === HOTKEYS.find((h) => h.id === id)!.combo) delete next[id]
  commit(next)
  return null
}

export function resetHotkeys(): void {
  commit({})
}

export const hotkeysChanged = (): boolean => Object.keys(custom).length > 0

/** Re-renders when a hotkey changes. */
export function useHotkeys(): Partial<Record<HotkeyAction, string>> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => custom
  )
}

/** How a combination is shown: Ctrl on Windows and Linux, ⌘ on a Mac. */
export function showCombo(combo: string): string {
  const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
  return combo.replace("Mod", mac ? "⌘" : "Ctrl")
}
