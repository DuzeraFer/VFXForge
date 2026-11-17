/** Export settings and file descriptions shared by the window, the main process and the command line (docs/06 §6.7). */

export const EXPORT_FORMATS = ["png", "tga", "jpg", "bmp", "tiff"] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** Formats that can hold 16 bits per channel. The others are always 8. */
export const DEEP_FORMATS: readonly ExportFormat[] = ["png", "tiff"]

export type ExportSettings = {
  format: ExportFormat
  bitDepth: 8 | 16
  /** File name without extension. Tokens: {project} {graph} {output}. */
  template: string
}

export const DEFAULT_EXPORT: ExportSettings = { format: "png", bitDepth: 8, template: "{output}" }

/** Read by the Unity importer. Written next to every texture as `<texture>.vfxforge.json`. */
export type Sidecar = {
  tool: "VFXForge"
  version: 1
  texture: string
  width: number
  height: number
  sheet: { cols: number; rows: number; frames: number; fps: number; loop: boolean; padding: number } | null
  alpha: "straight" | "premultiplied"
  usage: string
  packing: null
  source: { project: string; graph: string; seed: number }
}

/** One texture on its way to disk: pixels as displayed, top row first, RGBA. */
export type ExportImage = {
  /** File name without extension. */
  name: string
  width: number
  height: number
  /** 8-bit: Uint8Array. 16-bit: Uint16Array. Four values per pixel. */
  data: Uint8Array | Uint16Array
  sidecar: Omit<Sidecar, "texture" | "width" | "height">
}

export type ExportResult = { ok: true; files: string[] } | { ok: false; error: string }
