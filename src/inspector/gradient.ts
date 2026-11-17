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
