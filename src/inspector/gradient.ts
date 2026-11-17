/** Gradient math shared by the editor's preview bar and its tests. Mirrors `gradient_<name>` in the shader generator. */

import type { GradientStop } from "../doc/types"
import { sortedStops } from "../engine/shader"

export type Rgba = [number, number, number, number]

/** Color at `t` (0–1). `pixel` is the smallest blend width, as a fraction of the ramp. */
export function sampleGradient(stops: GradientStop[], t: number, pixel = 1e-5): Rgba {
  const sorted = sortedStops(stops)
  let color: Rgba = [...sorted[0].color]
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].position
    const stop = sorted[i]
    const blend = (stop.position - prev) * (1 - (stop.hardness ?? 0))
    const width = Math.max(blend, pixel)
    const center = stop.position - blend * 0.5
    const k = Math.min(1, Math.max(0, (t - center) / width + 0.5))
    color = color.map((c, j) => c + (stop.color[j] - c) * k) as Rgba
  }
  return color
}

/** Stops moved to even positions (0, 1/N, … 1) in their current order: what Palette Remap wants after Band. */
export function spaceEvenly(stops: GradientStop[]): GradientStop[] {
  const sorted = sortedStops(stops)
  if (sorted.length < 2) return sorted
  return sorted.map((stop, i) => ({ ...stop, position: Math.round((i / (sorted.length - 1)) * 1000) / 1000 }))
}

const distance = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3])
const round3 = (v: number): number => Math.round(v * 1000) / 1000

/**
 * A gradient from colors read along a line, first sample at position 0.
 * Flat areas (a cel-shaded picture) become stops with hard edges where the
 * color jumps; a picture that changes all the way becomes evenly spaced soft stops.
 */
export function gradientFromSamples(samples: readonly Rgba[], maxStops = 8): GradientStop[] {
  if (samples.length === 0) return [{ position: 0, color: [0, 0, 0, 1] }]
  // Runs of nearly the same color. A sample joins the run when it is close to the run's first color.
  const runs: { start: number; colors: Rgba[] }[] = []
  samples.forEach((color, i) => {
    const run = runs[runs.length - 1]
    if (run && distance(run.colors[0], color) < 0.08) run.colors.push(color)
    else runs.push({ start: i, colors: [color] })
  })
  const mean = (colors: readonly Rgba[]): GradientStop["color"] => [0, 1, 2, 3].map((c) => round3(colors.reduce((sum, color) => sum + color[c], 0) / colors.length)) as GradientStop["color"]
  // Short runs are the anti-aliased edges between flat areas; only runs of some length count as a tone.
  const tones = runs.filter((run) => run.colors.length >= Math.max(2, samples.length / 24))
  const flat = tones.reduce((sum, run) => sum + run.colors.length, 0) >= samples.length * 0.7
  if (flat && tones.length >= 1 && tones.length <= maxStops) {
    return tones.map((run, i) => (i === 0 ? { position: 0, color: mean(run.colors) } : { position: round3(run.start / samples.length), color: mean(run.colors), hardness: 1 }))
  }
  const count = Math.min(maxStops, Math.max(2, samples.length))
  return Array.from({ length: count }, (_, i) => {
    const at = Math.round((i / (count - 1)) * (samples.length - 1))
    return { position: round3(i / (count - 1)), color: samples[at].map(round3) as GradientStop["color"] }
  })
}

/** Colors along a line across a picture. `from` and `to` are 0–1 from the top left. */
export function sampleLine(image: { width: number; height: number; data: Uint8ClampedArray }, from: readonly [number, number], to: readonly [number, number], count = 64): Rgba[] {
  const out: Rgba[] = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1)
    const x = Math.min(image.width - 1, Math.max(0, Math.round((from[0] + (to[0] - from[0]) * t) * (image.width - 1))))
    const y = Math.min(image.height - 1, Math.max(0, Math.round((from[1] + (to[1] - from[1]) * t) * (image.height - 1))))
    const at = (y * image.width + x) * 4
    out.push([image.data[at] / 255, image.data[at + 1] / 255, image.data[at + 2] / 255, image.data[at + 3] / 255])
  }
  return out
}

export const GRADIENT_PRESETS: { name: string; stops: GradientStop[] }[] = [
  {
    name: "Black to white",
    stops: [
      { position: 0, color: [0, 0, 0, 1] },
      { position: 1, color: [1, 1, 1, 1] }
    ]
  },
  {
    name: "Fade in",
    stops: [
      { position: 0, color: [1, 1, 1, 0] },
      { position: 1, color: [1, 1, 1, 1] }
    ]
  },
  {
    name: "Cel fire, green",
    stops: [
      { position: 0, color: [0.086, 0.157, 0.11, 0] },
      { position: 0.333, color: [0.086, 0.157, 0.11, 1] },
      { position: 0.667, color: [0.384, 0.898, 0.133, 1] },
      { position: 1, color: [0.843, 1, 0.384, 1] }
    ]
  },
  {
    name: "Cel fire, orange",
    stops: [
      { position: 0, color: [0.3, 0.05, 0.03, 0] },
      { position: 0.333, color: [0.75, 0.16, 0.05, 1] },
      { position: 0.667, color: [1, 0.55, 0.1, 1] },
      { position: 1, color: [1, 0.95, 0.6, 1] }
    ]
  },
  {
    name: "Heat",
    stops: [
      { position: 0, color: [0, 0, 0, 1] },
      { position: 0.35, color: [0.6, 0.05, 0.02, 1] },
      { position: 0.7, color: [1, 0.6, 0.05, 1] },
      { position: 1, color: [1, 1, 0.85, 1] }
    ]
  }
]
