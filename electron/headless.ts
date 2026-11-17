/**
 * Headless commands (docs/06 §6.8): the app starts with a hidden window, runs
 * one job on the same engine as the UI, and exits.
 *
 *   vfxforge render project.vfxf [--graph g] [--target t] [--frame n|sheet] [--cols n] [--bg rrggbb] [--out dir]
 *   vfxforge sweep  project.vfxf (--param node.param=from:to:count | --seed from:to) [--graph g] [--target t] [--frame n] [--out dir]
 *   vfxforge export project.vfxf [--out dir] [--format png|tga|jpg|bmp|tiff] [--depth 8|16] [--name "{graph}_{output}"] [--only a,b]
 *   vfxforge golden <dir> [--update]
 */

import { app, BrowserWindow } from "electron"
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { PNG } from "pngjs"
import type { Job, JobAssets, JobImage, JobResult } from "../src/headless/jobs"
import { parseSweep, type Variation } from "../src/engine/sweep"
import { assetsDir, readAsset, referencedAssets } from "./assets"
import { DEFAULT_EXPORT, EXPORT_FORMATS, type ExportFormat, type ExportImage } from "../src/export/types"
import { writeExport, type JpegEncoder } from "./exportFiles"

export const HEADLESS_COMMANDS = ["render", "golden", "export", "sweep"] as const
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

type Runner = ((job: Job) => Promise<JobImage[]>) & { full: (job: Job) => Promise<JobResult & { ok: true }> }

async function createRunner(): Promise<Runner> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  })
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/headless/index.html`)
  else await win.loadFile(join(__dirname, "../renderer/headless/index.html"))
  const full = async (job: Job): Promise<JobResult & { ok: true }> => {
    const result = (await win.webContents.executeJavaScript(`window.vfxRunJob(${JSON.stringify(job)})`)) as JobResult
    if (!result.ok) throw new Error(result.error)
    return result
  }
  return Object.assign(async (job: Job) => (await full(job)).images, { full })
}

/** `vfxforge export`: every Output and Sheet Output of a project, with sidecars. Default folder: `export/` next to the project. */
async function exportProject(args: Args, jpeg: JpegEncoder): Promise<number> {
  const file = args.positional[0]
  if (!file) throw new Error('Usage: vfxforge export project.vfxf [--out dir] [--format png|tga|jpg|bmp|tiff] [--depth 8|16] [--name "{graph}_{output}"] [--only a,b]')
  const flag = (name: string): string | undefined => (typeof args.flags[name] === "string" ? (args.flags[name] as string) : undefined)
  const format = (flag("format") ?? DEFAULT_EXPORT.format) as ExportFormat
  if (!EXPORT_FORMATS.includes(format)) throw new Error(`--format must be one of ${EXPORT_FORMATS.join(", ")}.`)
  const depth = flag("depth") ?? "8"
  if (depth !== "8" && depth !== "16") throw new Error("--depth must be 8 or 16.")
  const projectText = readFileSync(file, "utf8")
  const run = await createRunner()
  const result = await run.full({
    kind: "export",
    projectText,
    assets: assetsOf(file, projectText),
    projectName: basename(file).replace(/\.vfxf$/i, ""),
    settings: { format, bitDepth: depth === "16" ? 16 : 8, template: flag("name") ?? DEFAULT_EXPORT.template },
    only: flag("only")?.split(",").map((name) => name.trim()).filter(Boolean)
  })
  const folder = resolve(flag("out") ?? join(resolve(file), "..", "export"))
  for (const path of writeExport(folder, result.exported as ExportImage[], format, jpeg)) console.log(path)
  return 0
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

/** One picture per value of a parameter, or per seed, and a contact sheet of them all. */
async function sweep(args: Args): Promise<number> {
  const file = args.positional[0]
  const usage = "Usage: vfxforge sweep project.vfxf (--param node.param=from:to:count | --seed from:to) [--graph g] [--target t] [--frame n] [--bg rrggbb] [--out dir]"
  if (!file) throw new Error(usage)
  let variations: Variation[]
  if (typeof args.flags.param === "string") variations = parseSweep(args.flags.param)
  else if (typeof args.flags.seed === "string") {
    const match = /^(\d+):(\d+)$/.exec(args.flags.seed)
    if (!match || Number(match[2]) < Number(match[1]) || Number(match[2]) - Number(match[1]) >= 64) throw new Error("--seed needs a range of at most 64 seeds, for example 1:8.")
    variations = Array.from({ length: Number(match[2]) - Number(match[1]) + 1 }, (_, i) => ({ label: `seed ${Number(match[1]) + i}`, seed: Number(match[1]) + i }))
  } else throw new Error(usage)
  const frame = Number(args.flags.frame ?? 0)
  if (!Number.isInteger(frame)) throw new Error("--frame needs a whole number.")
  const run = await createRunner()
  const projectText = readFileSync(file, "utf8")
  const images = await run({
    kind: "sweep",
    projectText,
    assets: assetsOf(file, projectText),
    graphId: typeof args.flags.graph === "string" ? args.flags.graph : undefined,
    target: typeof args.flags.target === "string" ? args.flags.target : undefined,
    frame,
    variations,
    background: typeof args.flags.bg === "string" ? parseColor(args.flags.bg) : undefined
  })
  const outDir = resolve(typeof args.flags.out === "string" ? args.flags.out : ".")
  mkdirSync(outDir, { recursive: true })
  for (const image of images) {
    const path = join(outDir, `${image.name}.png`)
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

export async function runHeadless(command: HeadlessCommand, argv: string[], jpeg: JpegEncoder): Promise<void> {
  let code = 1
  try {
    await app.whenReady()
    const args = parseArgs(argv)
    code = command === "render" ? await render(args) : command === "export" ? await exportProject(args, jpeg) : command === "sweep" ? await sweep(args) : await golden(args)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
  }
  app.exit(code)
}
