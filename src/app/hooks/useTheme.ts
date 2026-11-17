import { useCallback, useEffect, useState } from "react"

export type ThemeName = "light" | "dark"

const STORAGE_KEY = "vfxforge.theme"

function readStoredTheme(): ThemeName {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

/** Dark is the default. The choice is remembered per machine. */
export function useTheme(): { theme: ThemeName; toggleTheme: () => void } {
  const [theme, setTheme] = useState<ThemeName>(readStoredTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.vfxforge?.setTheme(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage can be unavailable; the theme still applies for this run.
    }
  }, [theme])

  const toggleTheme = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), [])
  return { theme, toggleTheme }
}
