/**
 * Headless commands (docs/06 §6.8): the app starts with a hidden window, runs
 * one job on the same engine as the UI, and exits.
 *
 *   vfxforge render project.vfxf [--graph g] [--target t] [--frame n|sheet] [--cols n] [--bg rrggbb] [--out dir]
 *   vfxforge golden <dir> [--update]
 */

import { app, BrowserWindow } from "electron"
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { PNG } from "pngjs"
import type { Job, JobAssets, JobImage, JobResult } from "../src/headless/jobs"
import { assetsDir, readAsset, referencedAssets } from "./assets"

export const HEADLESS_COMMANDS = ["render", "golden"] as const
export type HeadlessCommand = (typeof HEADLESS_COMMANDS)[number]

type Args = { positional: string[]; flags: Record<string, string | true> }

export function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }
    const eq = arg.indexOf("=")
    if (eq !== -1) flags[arg.slice(2, eq)] = arg.slice(eq + 1)
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[arg.slice(2)] = argv[++i]
    else flags[arg.slice(2)] = true
  }
  return { positional, flags }
}

function encodePng(image: JobImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
  return PNG.sync.write(png, { colorType: 6 })
}

/** The image files a project refers to, read from the folder next to it. */
function assetsOf(projectFile: string, projectText: string): JobAssets {
  const assets: JobAssets = {}
  for (const ref of referencedAssets(projectText)) {
    const bytes = readAsset([assetsDir(projectFile)], ref)
    if (bytes) assets[ref] = bytes.toString("base64")
  }
  return assets
}

async function createRunner(): Promise<(job: Job) => Promise<JobImage[]>> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  })
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/headless/index.html`)
  else await win.loadFile(join(__dirname, "../renderer/headless/index.html"))
  return async (job) => {
    const result = (await win.webContents.executeJavaScript(`window.vfxRunJob(${JSON.stringify(job)})`)) as JobResult
    if (!result.ok) throw new Error(result.error)
    return result.images
  }
}

function parseColor(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) throw new Error(`--bg needs a color like 2a1f2b, got "${hex}".`)
  const n = Number.parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

async function render(args: Args): Promise<number> {
  const file = args.positional[0]
  if (!file) throw new Error("Usage: vfxforge render project.vfxf [--graph g] [--target t] [--frame n|sheet] [--out dir]")
  const run = await createRunner()
  const frameFlag = args.flags.frame
  const frame = frameFlag === "sheet" ? "sheet" : Number(frameFlag ?? 0)
  if (frame !== "sheet" && !Number.isInteger(frame)) throw new Error(`--frame needs a whole number or "sheet".`)
  const projectText = readFileSync(file, "utf8")
  const images = await run({
    kind: "render",
    projectText,
    assets: assetsOf(file, projectText),
    graphId: typeof args.flags.graph === "string" ? args.flags.graph : undefined,
    target: typeof args.flags.target === "string" ? args.flags.target : undefined,
    frame,
    cols: typeof args.flags.cols === "string" ? Number(args.flags.cols) : undefined,
    background: typeof args.flags.bg === "string" ? parseColor(args.flags.bg) : undefined
  })
  const outDir = resolve(typeof args.flags.out === "string" ? args.flags.out : ".")
  mkdirSync(outDir, { recursive: true })
  for (const image of images) {
    const suffix = frame === "sheet" ? "sheet" : `f${frame}`
    const path = join(outDir, `${image.name}.${suffix}.png`)
    writeFileSync(path, encodePng(image))
    console.log(path)
  }
  return 0
}

/**
 * Golden-image tests: every Output node of every `.vfxf` in `<dir>/cases` is
 * compared with `<dir>/expected/<file>/<graph>.<output>.png`.
 */
async function golden(args: Args): Promise<number> {
  const dir = resolve(args.positional[0] ?? "tests/golden")
  const update = args.flags.update === true
  // Same GPU gives identical bytes; across GPUs the tolerance is ±1/255 (docs/06 §6.6).
  const tolerance = Number(process.env.VFXFORGE_GOLDEN_TOLERANCE ?? 1)
  const casesDir = join(dir, "cases")
  const failedDir = join(dir, "failed")
  rmSync(failedDir, { recursive: true, force: true })
  const run = await createRunner()

  let failures = 0
  let checked = 0
  for (const file of readdirSync(casesDir).filter((f) => f.endsWith(".vfxf")).sort()) {
    const suite = basename(file, ".vfxf")
    let images: JobImage[]
    try {
      const projectText = readFileSync(join(casesDir, file), "utf8")
      images = await run({ kind: "golden", projectText, assets: assetsOf(join(casesDir, file), projectText) })
    } catch (error) {
      failures++
      console.log(`FAIL  ${suite}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    for (const image of images) {
      checked++
      const expectedPath = join(dir, "expected", suite, `${image.name}.png`)
      const label = `${suite}/${image.name}`
      if (update || !existsSync(expectedPath)) {
        if (!update) {
          failures++
          console.log(`FAIL  ${label}: no expected image. Run with --update to create it.`)
          continue
        }
        mkdirSync(join(dir, "expected", suite), { recursive: true })
        writeFileSync(expectedPath, encodePng(image))
        console.log(`WROTE ${label}`)
        continue
      }
      const expected = PNG.sync.read(readFileSync(expectedPath))
      let problem: string | null = null
      if (expected.width !== image.width || expected.height !== image.height) {
        problem = `size ${image.width}x${image.height}, expected ${expected.width}x${expected.height}`
      } else {
        let worst = 0
        let count = 0
        for (let i = 0; i < image.data.length; i++) {
          const diff = Math.abs(image.data[i] - expected.data[i])
          if (diff > tolerance) count++
          if (diff > worst) worst = diff
        }
        if (count > 0) problem = `${count} channel values differ by more than ${tolerance} (worst ${worst})`
      }
      if (problem) {
        failures++
        mkdirSync(join(failedDir, suite), { recursive: true })
        writeFileSync(join(failedDir, suite, `${image.name}.png`), encodePng(image))
        console.log(`FAIL  ${label}: ${problem}`)
      } else {
        console.log(`ok    ${label}`)
      }
    }
  }
  console.log(`\n${checked} images, ${failures} failed${failures ? ` (actual renders in ${failedDir})` : ""}`)
  return failures === 0 ? 0 : 1
}

export async function runHeadless(command: HeadlessCommand, argv: string[]): Promise<void> {
  let code = 1
  try {
    await app.whenReady()
    const args = parseArgs(argv)
    code = command === "render" ? await render(args) : await golden(args)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
  }
  app.exit(code)
}
