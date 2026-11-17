/**
 * Preferences of this computer (not of a project), and the settings profile:
 * one file that carries preferences, hotkeys and the theme to another machine
 * (docs/03, "Portable settings and profiles").
 */

import { useSyncExternalStore } from "react"
import { HOTKEYS, hotkeyOverrides, loadHotkeys, type HotkeyAction } from "./hotkeys"

export const WIRE_STYLES = ["curved", "straight", "stepped"] as const
export type WireStyle = (typeof WIRE_STYLES)[number]
export type Preferences = { wireStyle: WireStyle }

const STORAGE_KEY = "vfxforge.preferences"
const THEME_KEY = "vfxforge.theme"
const DEFAULTS: Preferences = { wireStyle: "curved" }

/** Keeps what is known and valid; everything else falls back to the default. */
export function cleanPreferences(raw: unknown): Preferences {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return { wireStyle: (WIRE_STYLES as readonly unknown[]).includes(value.wireStyle) ? (value.wireStyle as WireStyle) : DEFAULTS.wireStyle }
}

function read(): Preferences {
  try {
    return cleanPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"))
  } catch {
    return DEFAULTS
  }
}

let current = read()
const listeners = new Set<() => void>()

export const getPreferences = (): Preferences => current

export function setPreferences(patch: Partial<Preferences>): void {
  current = cleanPreferences({ ...current, ...patch })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Without storage the change lasts until the window closes.
  }
  for (const listener of [...listeners]) listener()
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current
  )
}

// ── Settings profile ──────────────────────────────────────

export type Profile = { vfxforgeProfile: 1; theme: "light" | "dark"; preferences: Preferences; hotkeys: Partial<Record<HotkeyAction, string>> }

/** Asked of the window so that the theme hook can follow an imported profile. */
export const THEME_EVENT = "vfxforge:theme"

function storedTheme(): "light" | "dark" {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

/** This computer's settings as a profile. It never holds keys, paths or anything of a project. */
export function currentProfile(): Profile {
  return { vfxforgeProfile: 1, theme: storedTheme(), preferences: current, hotkeys: hotkeyOverrides() }
}

/** Reads a profile file. Throws with a sentence for the artist when it is not one. */
export function parseProfile(text: string): Profile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error("That file is not a VFXForge settings profile.")
  }
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  if (value.vfxforgeProfile !== 1) throw new Error("That file is not a VFXForge settings profile.")
  const known = new Set<string>(HOTKEYS.map((h) => h.id))
  const keys = value.hotkeys && typeof value.hotkeys === "object" ? Object.entries(value.hotkeys as Record<string, unknown>) : []
  return {
    vfxforgeProfile: 1,
    theme: value.theme === "light" ? "light" : "dark",
    preferences: cleanPreferences(value.preferences),
    hotkeys: Object.fromEntries(keys.filter(([id, combo]) => known.has(id) && typeof combo === "string" && combo.length > 0 && combo.length <= 40)) as Profile["hotkeys"]
  }
}

/** Makes a profile this computer's settings. Returns how many hotkeys could not be taken over. */
export function applyProfile(profile: Profile): number {
  setPreferences(profile.preferences)
  const skipped = loadHotkeys(profile.hotkeys)
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: profile.theme }))
  return skipped
}
