import { app, BrowserWindow, ipcMain, shell } from "electron"
import { join } from "node:path"

// Chromium ships WebGPU on by default on Windows. Linux still needs the flag
// (used for development and headless checks).
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-unsafe-webgpu")
  app.commandLine.appendSwitch("enable-features", "Vulkan")
}

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

void app.whenReady().then(() => {
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
