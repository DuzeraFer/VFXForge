/// <reference types="vite/client" />

interface Window {
  /** Present only inside Electron (see electron/preload.ts). */
  vfxforge?: import("../electron/preload").VfxForgeApi
}
