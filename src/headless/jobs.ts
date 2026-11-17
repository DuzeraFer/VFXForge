/** Job and result shapes shared by the main process and the headless renderer. */

/** Image files the project refers to, by reference, base64-encoded (docs/06 §6.11). */
export type JobAssets = Record<string, string>

export type RenderJob = {
  kind: "render"
  projectText: string
  assets?: JobAssets
  graphId?: string
  /** See `resolveTarget`. */
  target?: string
  frame: number | "sheet"
  cols?: number
  /** Flatten onto this color (0–255). Omit to keep alpha. */
  background?: [number, number, number]
}

/** Renders every Output node of every graph at frame 0 (and mid-loop for animated graphs). */
export type GoldenJob = { kind: "golden"; projectText: string; assets?: JobAssets }

/** Renders the project's outputs for export (docs/06 §6.7). */
export type ExportJob = { kind: "export"; projectText: string; assets?: JobAssets; projectName: string; settings: import("../export/types").ExportSettings; only?: string[] }

/** Renders one target once per variation (a seed or parameter sweep), plus a contact sheet of them all. */
export type SweepJob = {
  kind: "sweep"
  projectText: string
  assets?: JobAssets
  graphId?: string
  target?: string
  frame: number
  variations: import("../engine/sweep").Variation[]
  background?: [number, number, number]
}

export type Job = RenderJob | GoldenJob | ExportJob | SweepJob

export type JobImage = { name: string; width: number; height: number; data: Uint8Array }

export type JobResult = { ok: true; images: JobImage[]; exported?: import("../export/types").ExportImage[] } | { ok: false; error: string }
