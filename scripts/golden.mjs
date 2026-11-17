// Runs the golden-image tests in headless Electron.
// On Linux without a display it wraps the run in xvfb-run and uses software WebGPU.
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const electron = createRequire(import.meta.url)("electron")
const args = [".", "golden", "tests/golden", ...process.argv.slice(2)]
const env = { ...process.env }
let command = electron

if (process.platform === "linux") {
  args.splice(1, 0, "--no-sandbox")
  if (!env.DISPLAY) {
    env.VFXFORGE_SOFTWARE_GPU ??= "1"
    args.unshift("-a", electron)
    command = "xvfb-run"
  }
}
if (process.env.CI) env.VFXFORGE_SOFTWARE_GPU ??= "1"

const result = spawnSync(command, args, { stdio: "inherit", env })
process.exit(result.status ?? 1)
