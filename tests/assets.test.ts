import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { adoptAssets, assetsDir, importAsset, isAssetRef, pruneHolding, readAsset, referencedAssets, storeAsset } from "../electron/assets"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vfxforge-assets-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe("project image files", () => {
  it("keeps images next to the project", () => {
    expect(assetsDir(join(dir, "fire.vfxf"))).toBe(join(dir, "fire.assets"))
    expect(assetsDir(join(dir, "Fire.VFXF"))).toBe(join(dir, "Fire.assets"))
  })

  it("stores by content hash, once", () => {
    const a = storeAsset(dir, "ai", bytes("picture"), "png")
    expect(a).toMatch(/^ai\/[a-f0-9]{16}\.png$/)
    expect(storeAsset(dir, "ai", bytes("picture"), ".PNG")).toBe(a)
    expect(storeAsset(dir, "ai", bytes("another"), "png")).not.toBe(a)
    expect(readAsset([dir], a)?.toString()).toBe("picture")
  })

  it("imports a file the artist picked", () => {
    const source = join(dir, "smoke.webp")
    writeFileSync(source, "webp bytes")
    const ref = importAsset(join(dir, "p.assets"), source)
    expect(ref).toMatch(/^images\/[a-f0-9]{16}\.webp$/)
    expect(() => storeAsset(dir, "images", bytes("x"), "exe")).toThrow(/not an image type/)
  })

  it("never turns anything but a reference into a path", () => {
    writeFileSync(join(dir, "secret.txt"), "secret")
    for (const ref of ["../secret.txt", "ai/../../secret.txt", "/etc/passwd", "ai/0123456789abcdef.png/../../x", "images/short.png", "other/0123456789abcdef.png", ""]) {
      expect(isAssetRef(ref)).toBe(false)
      expect(readAsset([dir], ref)).toBeNull()
    }
    expect(readAsset([dir], "ai/0123456789abcdef.png")).toBeNull()
  })

  it("finds references in a project's text", () => {
    const text = JSON.stringify({ nodes: [{ params: { image: "ai/0123456789abcdef.png" } }, { params: { file: "images/fedcba9876543210.jpg", name: "ai/not-a-ref.png" } }, { params: { image: "ai/0123456789abcdef.png" } }] })
    expect(referencedAssets(text)).toEqual(["ai/0123456789abcdef.png", "images/fedcba9876543210.jpg"])
  })

  it("moves images along when a project is saved for the first time or under a new name", () => {
    const holding = join(dir, "holding")
    const ref = storeAsset(holding, "ai", bytes("generated before the first save"), "png")
    const first = assetsDir(join(dir, "a.vfxf"))
    adoptAssets(first, [holding], [ref, "ai/0000000000000000.png", "../nope"])
    expect(readAsset([first], ref)?.toString()).toBe("generated before the first save")

    const second = assetsDir(join(dir, "copy", "b.vfxf"))
    adoptAssets(second, [first, holding], [ref])
    expect(existsSync(join(second, ref))).toBe(true)
    // The original stays where it was.
    expect(existsSync(join(first, ref))).toBe(true)
  })

  it("clears old images of projects that were never saved", () => {
    const fresh = storeAsset(dir, "ai", bytes("fresh"), "png")
    const old = storeAsset(dir, "images", bytes("old"), "png")
    const monthAgo = new Date(Date.now() - 40 * 24 * 3600 * 1000)
    utimesSync(join(dir, old), monthAgo, monthAgo)
    pruneHolding(dir, 30 * 24 * 3600 * 1000)
    expect(existsSync(join(dir, fresh))).toBe(true)
    expect(existsSync(join(dir, old))).toBe(false)
    expect(readFileSync(join(dir, fresh), "utf8")).toBe("fresh")
  })
})
