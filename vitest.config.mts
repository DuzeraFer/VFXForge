import { readFileSync } from "node:fs"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    {
      // Vite's `?raw` imports for .wgsl files, for tests that run outside the app build.
      name: "wgsl-raw",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".wgsl?raw")) return `export default ${JSON.stringify(readFileSync(id.slice(0, -4), "utf8"))}`
        return null
      }
    }
  ],
  test: { include: ["tests/**/*.test.ts", "src/**/*.test.ts"], environment: "node" }
})
