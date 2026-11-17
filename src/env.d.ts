/// <reference types="vite/client" />

interface Window {
  /** Present only inside Electron (see electron/preload.ts). */
  vfxforge?: {
    platform: string
    setTheme: (theme: "light" | "dark") => void
  }
}
