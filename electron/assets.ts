/**
 * Image files of a project (docs/06 §6.11). They live next to the project in
 * `<name>.assets/`, named by the hash of their content, and the project file
 * refers to them by a short relative path ("ai/0123456789abcdef.png").
 * A project that was never saved keeps them in a holding folder until it is.
 * Plain functions on paths, so they are tested without Electron.
 */

import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, extname, join } from "node:path"

export type AssetFolder = "ai" | "images"

/** The only shape a reference can have. Anything else is never turned into a path. */
const ASSET_REF = /^(ai|images)\/[a-f0-9]{16}\.(png|jpg|jpeg|webp)$/
const ASSET_REFS_IN_TEXT = /"((?:ai|images)\/[a-f0-9]{16}\.(?:png|jpg|jpeg|webp))"/g
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const

export function isAssetRef(value: unknown): value is string {
  return typeof value === "string" && ASSET_REF.test(value)
}

/** `fire.vfxf` keeps its images in `fire.assets/`. */
export function assetsDir(projectPath: string): string {
  return `${projectPath.replace(/\.vfxf$/i, "")}.assets`
}

/** Saves bytes under their content hash and returns the reference. Saving the same bytes twice is a no-op. */
export function storeAsset(dir: string, folder: AssetFolder, bytes: Uint8Array, extension: string): string {
  const ext = extension.toLowerCase().replace(/^\./, "")
  if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) throw new Error(`"${extension}" is not an image type VFXForge reads (PNG, JPEG, WebP).`)
  const ref = `${folder}/${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${ext}`
  const file = join(dir, ref)
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
  return ref
}

export function importAsset(dir: string, sourceFile: string): string {
  return storeAsset(dir, "images", readFileSync(sourceFile), extname(sourceFile))
}

/** Looks for a referenced file in each folder in turn. */
export function readAsset(dirs: readonly string[], ref: string): Buffer | null {
  if (!isAssetRef(ref)) return null
  for (const dir of dirs) {
    const file = join(dir, ref)
    if (existsSync(file)) return readFileSync(file)
  }
  return null
}

/** References found in a project's text. */
export function referencedAssets(projectText: string): string[] {
  return [...new Set([...projectText.matchAll(ASSET_REFS_IN_TEXT)].map((match) => match[1]))]
}

/**
 * Makes sure every image a project refers to is in its own assets folder,
 * copying from where it was before (the holding folder, or the folder of the
 * file it was saved from). Called on every save.
 */
export function adoptAssets(targetDir: string, sources: readonly string[], refs: readonly string[]): void {
  for (const ref of refs) {
    const target = join(targetDir, ref)
    if (!isAssetRef(ref) || existsSync(target)) continue
    const source = sources.map((dir) => join(dir, ref)).find((file) => existsSync(file))
    if (!source) continue
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
}

/** Clears out images of unsaved projects that nobody came back for. */
export function pruneHolding(dir: string, olderThanMs: number, now = Date.now()): void {
  for (const folder of ["ai", "images"]) {
    const path = join(dir, folder)
    if (!existsSync(path)) continue
    for (const name of readdirSync(path)) {
      const file = join(path, name)
      if (now - statSync(file).mtimeMs > olderThanMs) rmSync(file, { force: true })
    }
  }
}
