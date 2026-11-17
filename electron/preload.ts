import { contextBridge, ipcRenderer } from "electron"
import type { OpenedProject } from "./files"
import type { ToolCall } from "./mcp"

type MenuCommand = "new" | "open" | "save" | "saveAs" | "undo" | "redo"

const api = {
  platform: process.platform,
  setTheme: (theme: "light" | "dark"): void => ipcRenderer.send("theme:set", theme),

  startupProject: (): Promise<OpenedProject | null> => ipcRenderer.invoke("project:startup"),
  openProject: (): Promise<OpenedProject | null> => ipcRenderer.invoke("project:open"),
  saveProject: (path: string, text: string): Promise<void> => ipcRenderer.invoke("project:save", path, text),
  saveProjectAs: (text: string, suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke("project:saveAs", text, suggestedName),
  autosaveProject: (path: string, text: string): Promise<void> => ipcRenderer.invoke("project:autosave", path, text),

  /** Tool calls from MCP clients. The listener's result goes back to the client. Call once. */
  serveMcp: (listener: (call: ToolCall) => Promise<unknown>): void => {
    ipcRenderer.on("mcp:call", (_event, call: ToolCall) => {
      void listener(call).then((result) => ipcRenderer.send("mcp:result", call.callId, result))
    })
    ipcRenderer.send("mcp:ready")
  },
  /** Where agents connect, for the "Connect Claude" help. Null when the server is not running. */
  mcpInfo: (): Promise<{ url: string; command: string } | null> => ipcRenderer.invoke("mcp:info"),

  /** Returns a function that stops listening. */
  onMenuCommand: (listener: (command: MenuCommand) => void): (() => void) => {
    const handler = (_event: unknown, command: MenuCommand): void => listener(command)
    ipcRenderer.on("menu:command", handler)
    return () => ipcRenderer.removeListener("menu:command", handler)
  }
}

export type VfxForgeApi = typeof api

contextBridge.exposeInMainWorld("vfxforge", api)
