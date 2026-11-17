import { contextBridge, ipcRenderer } from "electron"
import type { OpenedProject } from "./files"
import type { ToolCall } from "./mcp"
import type { AiGenerateResult, AiImageRequest, AiStatus } from "../src/ai/imageOptions"

type MenuCommand = "new" | "open" | "save" | "saveAs" | "undo" | "redo"

const api = {
  platform: process.platform,
  setTheme: (theme: "light" | "dark"): void => ipcRenderer.send("theme:set", theme),

  startupProject: (): Promise<OpenedProject | null> => ipcRenderer.invoke("project:startup"),
  openProject: (): Promise<OpenedProject | null> => ipcRenderer.invoke("project:open"),
  saveProject: (path: string, text: string): Promise<void> => ipcRenderer.invoke("project:save", path, text),
  /** `previousPath`: where the project was saved before, so its images are copied along. */
  saveProjectAs: (text: string, suggestedName: string, previousPath: string | null): Promise<string | null> =>
    ipcRenderer.invoke("project:saveAs", text, suggestedName, previousPath),
  autosaveProject: (path: string, text: string): Promise<void> => ipcRenderer.invoke("project:autosave", path, text),

  /** Bytes of an image file of the project, or null if it is missing. */
  readAsset: (projectPath: string | null, ref: string): Promise<Uint8Array | null> => ipcRenderer.invoke("asset:read", projectPath, ref),
  /** Lets the artist pick an image, copies it into the project and returns its reference. */
  importAsset: (projectPath: string | null): Promise<string | null> => ipcRenderer.invoke("asset:import", projectPath),

  // AI images. The key goes in, but never comes back out.
  aiStatus: (): Promise<AiStatus> => ipcRenderer.invoke("ai:status"),
  aiSetKey: (key: string): Promise<{ status: AiStatus; error?: string }> => ipcRenderer.invoke("ai:setKey", key),
  aiClearKey: (): Promise<AiStatus> => ipcRenderer.invoke("ai:clearKey"),
  aiSetSettings: (patch: { model?: string; agentAllowed?: boolean; agentLimit?: number }): Promise<AiStatus> => ipcRenderer.invoke("ai:setSettings", patch),
  aiGenerate: (projectPath: string | null, request: AiImageRequest, agentSession?: string): Promise<AiGenerateResult> =>
    ipcRenderer.invoke("ai:generate", projectPath, request, agentSession),

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
