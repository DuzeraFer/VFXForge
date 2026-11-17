import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PNG } from "pngjs"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { encodeImage, isInside, safeFileName, writeExport } from "../electron/exportFiles"
import type { ExportImage } from "../src/export/types"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vfxforge-export-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const sidecar: ExportImage["sidecar"] = {
  tool: "VFXForge",
  version: 1,
  sheet: { cols: 2, rows: 1, frames: 2, fps: 12, loop: true, padding: 0 },
  alpha: "straight",
  usage: "color",
  packing: null,
  source: { project: "fire", graph: "fire_cel_green", seed: 7 }
}

/** 3×2: red, half-transparent green, blue / white, black, clear. */
const PIXELS = [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 10, 20, 30, 0]
const image8: ExportImage = { name: "fire", width: 3, height: 2, data: Uint8Array.from(PIXELS), sidecar }
const image16: ExportImage = { ...image8, data: Uint16Array.from(PIXELS.map((v) => v * 257)) }

/** Decodes with an independent reader (Pillow) when the machine has one. */
function pillow(file: string): { size: number[]; mode: string; pixels: number[][] } | null {
  try {
    const script = "import sys,json\nfrom PIL import Image\nim=Image.open(sys.argv[1])\nprint(json.dumps({'size':list(im.size),'mode':im.mode,'pixels':[list(p) if isinstance(p,tuple) else [p] for p in im.getdata()]}))"
    return JSON.parse(execFileSync("python3", ["-c", script, file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
  } catch {
    return null
  }
}

describe("texture files", () => {
  it("PNG keeps every pixel, at 8 and 16 bits", () => {
    const eight = PNG.sync.read(encodeImage(image8, "png"))
    expect([eight.width, eight.height, [...eight.data]]).toEqual([3, 2, PIXELS])
    const [file] = writeExport(dir, [image16], "png")
    const header = readFileSync(file)
    expect(header[24]).toBe(16) // bit depth
    expect(header[25]).toBe(6) // RGBA
    const read = PNG.sync.read(header)
    expect([...read.data]).toEqual(PIXELS)
  })

  it("TGA, BMP and TIFF are read back identically by another decoder", () => {
    const expected = Array.from({ length: 6 }, (_, i) => PIXELS.slice(i * 4, i * 4 + 4))
    for (const format of ["tga", "bmp", "tiff"] as const) {
      const [file] = writeExport(join(dir, format), [image8], format)
      const read = pillow(file)
      if (!read) continue
      expect(read.size, format).toEqual([3, 2])
      expect(read.mode, format).toBe("RGBA")
      expect(read.pixels, format).toEqual(expected)
    }
    // Headers, checked here so the test means something without Pillow too.
    const tga = encodeImage(image8, "tga")
    expect([tga[2], tga.readUInt16LE(12), tga.readUInt16LE(14), tga[16], tga[17], tga.length]).toEqual([2, 3, 2, 32, 0x28, 18 + 24])
    expect([...tga.subarray(18, 22)]).toEqual([0, 0, 255, 255]) // red, stored blue first
    const bmp = encodeImage(image8, "bmp")
    expect([bmp.toString("latin1", 0, 2), bmp.readInt32LE(18), bmp.readInt32LE(22), bmp.readUInt16LE(28)]).toEqual(["BM", 3, -2, 32])
    const tiff = encodeImage(image16, "tiff")
    expect([tiff.toString("latin1", 0, 2), tiff.readUInt16LE(2), tiff.length]).toEqual(["II", 42, 8 + 2 + 11 * 12 + 4 + 8 + 48])
  })

  it("JPEG is flattened onto black and needs the app's encoder", () => {
    expect(() => encodeImage(image8, "jpg")).toThrow(/only available inside the app/)
    let seen: number[] = []
    encodeImage(image8, "jpg", (rgba) => {
      seen = [...rgba]
      return Buffer.from("jpeg")
    })
    expect(seen.slice(4, 8)).toEqual([0, 128, 0, 255])
    expect(seen.slice(20, 24)).toEqual([0, 0, 0, 255])
  })

  it("writes a sidecar next to every texture", () => {
    const files = writeExport(dir, [image8, { ...image8, name: "smoke", sidecar: { ...sidecar, sheet: null } }], "png")
    expect(files).toEqual([join(dir, "fire.png"), join(dir, "smoke.png")])
    expect(JSON.parse(readFileSync(join(dir, "fire.png.vfxforge.json"), "utf8"))).toEqual({ ...sidecar, texture: "fire.png", width: 3, height: 2 })
    expect(JSON.parse(readFileSync(join(dir, "smoke.png.vfxforge.json"), "utf8")).sheet).toBeNull()
    expect(readdirSync(dir).some((name) => name.includes(".tmp-"))).toBe(false)
  })

  it("refuses names that would collide, before writing anything", () => {
    expect(() => writeExport(dir, [image8, { ...image8, name: "FIRE" }], "png")).toThrow(/Two outputs would be written as "FIRE.png"/)
    expect(existsSync(join(dir, "fire.png"))).toBe(false)
    expect(() => writeExport(dir, [], "png")).toThrow(/nothing to export/)
    expect(() => writeExport(dir, [image8], "exe" as never)).toThrow(/not an export format/)
  })

  it("keeps file names inside the folder", () => {
    expect(safeFileName("../../etc/passwd")).toBe("_.._etc_passwd")
    expect(safeFileName('fire: "green" <v2>')).toBe("fire_ _green_ _v2_")
    expect(safeFileName("  .. ")).toBe("texture")
    expect(safeFileName("CON")).toBe("_CON")
    const [file] = writeExport(dir, [{ ...image8, name: "..\\..\\evil" }], "png")
    expect(isInside(file, dir)).toBe(true)
  })

  it("knows what is inside a folder", () => {
    expect(isInside("/a/b/c", "/a/b")).toBe(true)
    expect(isInside("/a/b", "/a/b")).toBe(true)
    expect(isInside("/a/bc", "/a/b")).toBe(false)
    expect(isInside("/a/b/../c", "/a/b")).toBe(false)
  })
})
