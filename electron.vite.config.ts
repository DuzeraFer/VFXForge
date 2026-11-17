import { resolve } from "node:path"
import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"

// Layout follows docs/06-architecture.md §6.10:
// electron/ = main process, src/ = renderer.
export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      lib: { entry: resolve(__dirname, "electron/main.ts"), formats: ["cjs"] }
    }
  },
  preload: {
    build: {
      outDir: "out/preload",
      lib: { entry: resolve(__dirname, "electron/preload.ts"), formats: ["cjs"] }
    }
  },
  renderer: {
    root: resolve(__dirname, "src"),
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      rollupOptions: { input: resolve(__dirname, "src/index.html") }
    },
    plugins: [react()]
  }
})
