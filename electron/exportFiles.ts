/**
 * Writes exported textures (docs/06 §6.7): PNG, TGA, JPG, BMP and TIFF, each
 * with a sidecar JSON for the Unity importer. Plain functions, tested without
 * Electron; only JPEG needs an encoder from outside (Electron has one).
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { PNG } from "pngjs"
import { DEEP_FORMATS, EXPORT_FORMATS, type ExportFormat, type ExportImage, type Sidecar } from "../src/export/types"

/** RGBA 8-bit, top row first → JPEG bytes. */
export type JpegEncoder = (rgba: Uint8Array, width: number, height: number) => Buffer

const bytesOf = (data: Uint8Array | Uint16Array): Buffer => Buffer.from(data.buffer, data.byteOffset, data.byteLength)

/** 8-bit view of an image, whatever depth it came in. */
function to8(image: ExportImage): Uint8Array {
  if (image.data instanceof Uint8Array) return image.data
  const out = new Uint8Array(image.data.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(image.data[i] / 257)
  return out
}

function encodePng(image: ExportImage, deep: boolean): Buffer {
  const png = new PNG({ width: image.width, height: image.height })
  if (deep && image.data instanceof Uint16Array) {
    png.data = bytesOf(image.data)
    return PNG.sync.write(png, { bitDepth: 16, colorType: 6, inputColorType: 6, inputHasAlpha: true })
  }
  png.data = Buffer.from(to8(image))
  return PNG.sync.write(png, { colorType: 6 })
}

/** Uncompressed 32-bit TGA, top row first. */
function encodeTga(image: ExportImage): Buffer {
  const rgba = to8(image)
  const out = Buffer.alloc(18 + rgba.length)
  out[2] = 2 // true color, no compression
  out.writeUInt16LE(image.width, 12)
  out.writeUInt16LE(image.height, 14)
  out[16] = 32
  out[17] = 0x28 // 8 alpha bits, origin at the top left
  for (let i = 0; i < rgba.length; i += 4) {
    out[18 + i] = rgba[i + 2]
    out[18 + i + 1] = rgba[i + 1]
    out[18 + i + 2] = rgba[i]
    out[18 + i + 3] = rgba[i + 3]
  }
  return out
}

/** 32-bit BMP with an alpha channel (V4 header), top row first. */
function encodeBmp(image: ExportImage): Buffer {
  const rgba = to8(image)
  const header = 14 + 108
  const out = Buffer.alloc(header + rgba.length)
  out.write("BM", 0, "latin1")
  out.writeUInt32LE(out.length, 2)
  out.writeUInt32LE(header, 10)
  out.writeUInt32LE(108, 14)
  out.writeInt32LE(image.width, 18)
  out.writeInt32LE(-image.height, 22)
  out.writeUInt16LE(1, 26)
  out.writeUInt16LE(32, 28)
  out.writeUInt32LE(3, 30) // BI_BITFIELDS
  out.writeUInt32LE(rgba.length, 34)
  out.writeUInt32LE(2835, 38)
  out.writeUInt32LE(2835, 42)
  out.writeUInt32LE(0x00ff0000, 54)
  out.writeUInt32LE(0x0000ff00, 58)
  out.writeUInt32LE(0x000000ff, 62)
  out.writeUInt32LE(0xff000000, 66)
  out.write("BGRs", 70, "latin1") // sRGB
  for (let i = 0; i < rgba.length; i += 4) {
    out[header + i] = rgba[i + 2]
    out[header + i + 1] = rgba[i + 1]
    out[header + i + 2] = rgba[i]
    out[header + i + 3] = rgba[i + 3]
  }
  return out
}

/** Uncompressed RGBA TIFF, 8 or 16 bits per channel, little-endian. */
function encodeTiff(image: ExportImage, deep: boolean, premultiplied: boolean): Buffer {
  const sixteen = deep && image.data instanceof Uint16Array
  const pixels = sixteen ? bytesOf(image.data) : Buffer.from(to8(image))
  const bits = sixteen ? 16 : 8
  const tags: [number, number, number, number][] = [
    // tag, type (3 = short, 4 = long), count, value or offset
    [256, 4, 1, image.width],
    [257, 4, 1, image.height],
    [258, 3, 4, 0], // bits per sample: offset filled in below
    [259, 3, 1, 1], // no compression
    [262, 3, 1, 2], // RGB
    [273, 4, 1, 0], // strip offset: filled in below
    [277, 3, 1, 4],
    [278, 4, 1, image.height],
    [279, 4, 1, pixels.length],
    [284, 3, 1, 1],
    [338, 3, 1, premultiplied ? 1 : 2] // the fourth channel is alpha
  ]
  const ifd = 8
  const bitsAt = ifd + 2 + tags.length * 12 + 4
  const pixelsAt = bitsAt + 8
  const out = Buffer.alloc(pixelsAt + pixels.length)
  out.write("II", 0, "latin1")
  out.writeUInt16LE(42, 2)
  out.writeUInt32LE(ifd, 4)
  out.writeUInt16LE(tags.length, ifd)
  tags.forEach(([tag, type, count, value], index) => {
    const at = ifd + 2 + index * 12
    out.writeUInt16LE(tag, at)
    out.writeUInt16LE(type, at + 2)
    out.writeUInt32LE(count, at + 4)
    const actual = tag === 258 ? bitsAt : tag === 273 ? pixelsAt : value
    if (type === 3 && count === 1) out.writeUInt16LE(actual, at + 8)
    else out.writeUInt32LE(actual, at + 8)
  })
  for (let i = 0; i < 4; i++) out.writeUInt16LE(bits, bitsAt + i * 2)
  pixels.copy(out, pixelsAt)
  return out
}

/** JPEG has no alpha: the picture is flattened onto black first. */
function flattenOnBlack(image: ExportImage, premultiplied: boolean): Uint8Array {
  const rgba = Uint8Array.from(to8(image))
  for (let i = 0; i < rgba.length; i += 4) {
    if (!premultiplied) {
      const a = rgba[i + 3] / 255
      rgba[i] = Math.round(rgba[i] * a)
      rgba[i + 1] = Math.round(rgba[i + 1] * a)
      rgba[i + 2] = Math.round(rgba[i + 2] * a)
    }
    rgba[i + 3] = 255
  }
  return rgba
}

export function encodeImage(image: ExportImage, format: ExportFormat, jpeg?: JpegEncoder): Buffer {
  const deep = DEEP_FORMATS.includes(format)
  const premultiplied = image.sidecar.alpha === "premultiplied"
  switch (format) {
    case "png":
      return encodePng(image, deep)
    case "tga":
      return encodeTga(image)
    case "bmp":
      return encodeBmp(image)
    case "tiff":
      return encodeTiff(image, deep, premultiplied)
    case "jpg":
      if (!jpeg) throw new Error("JPEG export is only available inside the app.")
      return jpeg(flattenOnBlack(image, premultiplied), image.width, image.height)
  }
}

/** A file name the artist's template produced, made safe: no folders, no characters Windows refuses. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "")
  const safe = cleaned === "" ? "texture" : cleaned.slice(0, 120)
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(safe) ? `_${safe}` : safe
}

/** True when `folder` is `root` or inside it. */
export function isInside(folder: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(folder))
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function writeAtomic(file: string, data: Buffer | string): void {
  const temp = `${file}.tmp-${process.pid}`
  writeFileSync(temp, data)
  renameSync(temp, file)
}

/**
 * Writes every image and its sidecar into `folder`. Two images with the same
 * name would overwrite each other, so that is refused before anything is written.
 */
export function writeExport(folder: string, images: readonly ExportImage[], format: ExportFormat, jpeg?: JpegEncoder): string[] {
  if (!EXPORT_FORMATS.includes(format)) throw new Error(`"${String(format)}" is not an export format (${EXPORT_FORMATS.join(", ")}).`)
  if (images.length === 0) throw new Error("There is nothing to export: the project has no Output or Sheet Output node with an image.")
  const names = images.map((image) => safeFileName(image.name))
  const repeated = names.find((name, index) => names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) !== index)
  if (repeated) throw new Error(`Two outputs would be written as "${repeated}.${format}". Give them different names, or put {graph} in the file name.`)
  const encoded = images.map((image) => encodeImage(image, format, jpeg))
  mkdirSync(folder, { recursive: true })
  const written: string[] = []
  images.forEach((image, index) => {
    const texture = `${names[index]}.${format}`
    const file = join(folder, texture)
    // The sidecar goes first, so an importer that sees the texture always finds its settings.
    const sidecar: Sidecar = { ...image.sidecar, texture, width: image.width, height: image.height }
    writeAtomic(`${file}.vfxforge.json`, `${JSON.stringify(sidecar, null, 2)}\n`)
    writeAtomic(file, encoded[index])
    written.push(file)
  })
  return written
}
