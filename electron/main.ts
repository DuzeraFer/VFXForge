import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from "electron"
import { join, resolve } from "node:path"
import { openProject, saveProject, writeAutosave, type OpenedProject } from "./files"
import { HEADLESS_COMMANDS, runHeadless, type HeadlessCommand } from "./headless"

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

type ThemeName = "light" | "dark"

// Keep in sync with --color-surface / --color-ink in src/app/theme/tokens.css.
const TITLE_BAR: Record<ThemeName, { color: string; symbolColor: string }> = {
  light: { color: "#ffffff", symbolColor: "#0d0d0c" },
  dark: { color: "#232322", symbolColor: "#ecebe8" }
}

const TITLE_BAR_HEIGHT = 36

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: TITLE_BAR.light.color,
    titleBarStyle: "hidden",
    titleBarOverlay: { ...TITLE_BAR.light, height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once("ready-to-show", () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url)
    return { action: "deny" }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"))
  }
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
  if (!file || headlessCommand) return null
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

if (headlessCommand) {
  void runHeadless(headlessCommand, cliArgs.slice(1))
} else {
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(buildMenu())
    createWindow()
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
}
