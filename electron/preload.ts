import { contextBridge, ipcRenderer } from "electron"

const api = {
  platform: process.platform,
  setTheme: (theme: "light" | "dark"): void => ipcRenderer.send("theme:set", theme)
}

export type VfxForgeApi = typeof api

contextBridge.exposeInMainWorld("vfxforge", api)
