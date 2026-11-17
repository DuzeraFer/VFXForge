import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from "electron"
import { join, resolve } from "node:path"
import { openProject, saveProject, writeAutosave, type OpenedProject } from "./files"
import { HEADLESS_COMMANDS, runHeadless, type HeadlessCommand } from "./headless"
import { createMcpHandler, createToolRunner, runStdioShim, startMcpServer, type McpServer } from "./mcp"

// Tests and side-by-side installs can keep their settings (and mcp.json) elsewhere.
if (process.env.VFXFORGE_USER_DATA) app.setPath("userData", process.env.VFXFORGE_USER_DATA)

// Chromium ships WebGPU on by default on Windows. Linux still needs the flag
// (used for development and headless checks).
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-unsafe-webgpu")
  app.commandLine.appendSwitch("enable-features", "Vulkan")
}

// Software rendering for machines without a GPU (CI, containers).
if (process.env.VFXFORGE_SOFTWARE_GPU === "1") {
  app.commandLine.appendSwitch("use-angle", "swiftshader")
  app.commandLine.appendSwitch("use-webgpu-adapter", "swiftshader")
  app.commandLine.appendSwitch("use-vulkan", "swiftshader")
  app.commandLine.appendSwitch("enable-unsafe-swiftshader")
}

// `vfxforge <command> ...` runs headless and exits (docs/06 §6.8).
const cliArgs = process.argv.slice(app.isPackaged ? 1 : 2).filter((arg) => arg !== "--no-sandbox")
const headlessCommand = HEADLESS_COMMANDS.find((command) => command === cliArgs[0]) as HeadlessCommand | undefined
/** `vfxforge mcp [project.vfxf]`: the stdio shim for MCP clients (docs/05 §5.2). */
const mcpShim = cliArgs[0] === "mcp"

type ThemeName = "light" | "dark"

// Keep in sync with --color-surface / --color-ink in src/app/theme/tokens.css.
const TITLE_BAR: Record<ThemeName, { color: string; symbolColor: string }> = {
  light: { color: "#ffffff", symbolColor: "#0d0d0c" },
  dark: { color: "#232322", symbolColor: "#ecebe8" }
}

const TITLE_BAR_HEIGHT = 40

let mainWindow: BrowserWindow | null = null

function createWindow(hidden = false): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: TITLE_BAR.dark.color,
    titleBarStyle: "hidden",
    titleBarOverlay: { ...TITLE_BAR.dark, height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Agents keep working while the window is minimized or hidden.
      backgroundThrottling: false
    }
  })
  mainWindow = win
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null
  })

  if (!hidden) win.once("ready-to-show", () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url)
    return { action: "deny" }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"))
  }
  return win
}

const FILE_FILTERS = [{ name: "VFXForge project", extensions: ["vfxf"] }]

ipcMain.handle("project:open", async (event): Promise<OpenedProject | null> => {
  const win = BrowserWindow.fromWebContents(event.sender)!
  const result = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: FILE_FILTERS })
  if (result.canceled || result.filePaths.length === 0) return null
  return openProject(result.filePaths[0])
})

// `vfxforge file.vfxf` (or a double-clicked file) opens that project at startup.
ipcMain.handle("project:startup", (): OpenedProject | null => {
  const file = cliArgs.find((arg) => arg.toLowerCase().endsWith(".vfxf"))
  if (!file || headlessCommand) return null // `mcp project.vfxf` does open the project
  try {
    return openProject(resolve(file))
  } catch {
    return null
  }
})

ipcMain.handle("project:save", (_event, path: string, text: string): void => {
  saveProject(path, text)
})

ipcMain.handle("project:saveAs", async (event, text: string, suggestedName: string): Promise<string | null> => {
  const win = BrowserWindow.fromWebContents(event.sender)!
  const result = await dialog.showSaveDialog(win, { defaultPath: `${suggestedName}.vfxf`, filters: FILE_FILTERS })
  if (result.canceled || !result.filePath) return null
  saveProject(result.filePath, text)
  return result.filePath
})

ipcMain.handle("project:autosave", (_event, path: string, text: string): void => {
  writeAutosave(path, text)
})


export type MenuCommand = "new" | "open" | "save" | "saveAs" | "undo" | "redo"

/** The menu bar is hidden behind the custom title bar on Windows, but its shortcuts still work. */
function buildMenu(): Menu {
  const send = (command: MenuCommand) => (): void => {
    BrowserWindow.getFocusedWindow()?.webContents.send("menu:command", command)
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "New", accelerator: "CmdOrCtrl+N", click: send("new") },
        { label: "Open…", accelerator: "CmdOrCtrl+O", click: send("open") },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: send("save") },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: send("saveAs") },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: send("undo") },
        { label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", click: send("redo") },
        { label: "Redo", accelerator: "CmdOrCtrl+Y", click: send("redo"), visible: false }
      ]
    },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }] }
  ]
  return Menu.buildFromTemplate(template)
}

ipcMain.handle("mcp:info", (): { url: string; command: string } | null => {
  if (!mcpServer) return null
  // PORTABLE_EXECUTABLE_FILE is the real exe of a portable build (process.execPath is its unpacked copy).
  const exe = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath
  return { url: `http://127.0.0.1:${mcpServer.port}/mcp`, command: app.isPackaged ? `claude mcp add vfxforge -- "${exe}" mcp` : "claude mcp add vfxforge -- vfxforge mcp" }
})

ipcMain.on("theme:set", (event, theme: unknown) => {
  if (theme !== "light" && theme !== "dark") return
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  win.setBackgroundColor(TITLE_BAR[theme].color)
  // The overlay only exists on Windows and Linux.
  if (process.platform !== "darwin") {
    win.setTitleBarOverlay({ ...TITLE_BAR[theme], height: TITLE_BAR_HEIGHT })
  }
})

const toolRunner = createToolRunner(() => mainWindow)
let mcpServer: McpServer | null = null

if (headlessCommand) {
  void runHeadless(headlessCommand, cliArgs.slice(1))
} else if (mcpShim) {
  // stdout carries the protocol; the app must not print there.
  void app.whenReady().then(() =>
    runStdioShim(async () => {
      // No app is running: serve from a hidden window in this process.
      const win = createWindow(true)
      await new Promise<void>((resolve) => ipcMain.once("mcp:ready", () => resolve()))
      void win
      return createMcpHandler(toolRunner)
    })
  )
  app.on("window-all-closed", () => app.quit())
} else {
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(buildMenu())
    createWindow()
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    try {
      mcpServer = await startMcpServer(createMcpHandler(toolRunner))
    } catch (error) {
      console.error("Could not start the MCP server:", error)
    }
  })

  app.on("will-quit", () => mcpServer?.close())

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
}
