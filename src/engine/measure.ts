/**
 * Numbers an agent can reason about without guessing from pixels (docs/05
 * §5.3): coverage, bounding box, histogram, islands, border contact, colors
 * and, across frames, loop seam and motion. Works on straight-alpha RGBA8.
 */

import type { Rgba8Image } from "./render"

export type FrameMeasure = {
  width: number
  height: number
  /** Share of pixels with alpha above the cutoff, 0–100. */
  coveragePercent: number
  /** Bounding box of covered pixels in pixels, [x, y, width, height], or null when empty. */
  bbox: [number, number, number, number] | null
  /** Which borders the shape touches. */
  touchesEdge: { left: boolean; right: boolean; top: boolean; bottom: boolean; any: boolean }
  /** Connected covered regions (8-neighbour). */
  islands: { count: number; smallestArea: number; largestArea: number }
  /** 16 bins each, counts of covered pixels (alpha: all pixels). */
  histogram: { luminance: number[]; alpha: number[] }
  meanColor: [number, number, number]
  /** Most common colors among covered pixels, with their share of the covered area (flat cel bands show up here). */
  dominantColors: { color: string; percentOfShape: number }[]
}

const ALPHA_CUTOFF = 128

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

export function measureFrame(image: Rgba8Image): FrameMeasure {
  const { width, height, data } = image
  const total = width * height
  const covered = new Uint8Array(total)
  const luminance = new Array<number>(16).fill(0)
  const alpha = new Array<number>(16).fill(0)
  const colors = new Map<number, number>()
  let count = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let sumR = 0
  let sumG = 0
  let sumB = 0
  const edge = { left: false, right: false, top: false, bottom: false }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const a = data[i + 3]
      alpha[a >> 4]++
      if (a < ALPHA_CUTOFF) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      covered[y * width + x] = 1
      count++
      sumR += r
      sumG += g
      sumB += b
      luminance[Math.min(15, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) >> 4)]++
      // Quantize to 4 bits per channel so anti-aliased edges do not hide the flat bands.
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      colors.set(key, (colors.get(key) ?? 0) + 1)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x === 0) edge.left = true
      if (x === width - 1) edge.right = true
      if (y === 0) edge.top = true
      if (y === height - 1) edge.bottom = true
    }
  }

  // Islands: flood fill with an explicit stack.
  const seen = new Uint8Array(total)
  const stack: number[] = []
  let islandCount = 0
  let smallest = Infinity
  let largest = 0
  for (let start = 0; start < total; start++) {
    if (!covered[start] || seen[start]) continue
    islandCount++
    let area = 0
    seen[start] = 1
    stack.push(start)
    while (stack.length > 0) {
      const p = stack.pop()!
      area++
      const px = p % width
      const py = (p - px) / width
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx
          if (nx < 0 || nx >= width) continue
          const q = ny * width + nx
          if (covered[q] && !seen[q]) {
            seen[q] = 1
            stack.push(q)
          }
        }
      }
    }
    if (area < smallest) smallest = area
    if (area > largest) largest = area
  }

  const dominantColors = [...colors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, n]) => ({
      color: hex(((key >> 8) & 15) * 17, ((key >> 4) & 15) * 17, (key & 15) * 17),
      percentOfShape: Math.round((n / count) * 1000) / 10
    }))
    .filter((c) => c.percentOfShape >= 1)

  return {
    width,
    height,
    coveragePercent: Math.round((count / total) * 1000) / 10,
    bbox: count > 0 ? [minX, minY, maxX - minX + 1, maxY - minY + 1] : null,
    touchesEdge: { ...edge, any: edge.left || edge.right || edge.top || edge.bottom },
    islands: { count: islandCount, smallestArea: islandCount > 0 ? smallest : 0, largestArea: largest },
    histogram: { luminance, alpha },
    meanColor: count > 0 ? [Math.round(sumR / count), Math.round(sumG / count), Math.round(sumB / count)] : [0, 0, 0],
    dominantColors
  }
}

/** Mean absolute difference between two frames over premultiplied RGBA, 0–100 (% of full scale). */
export function frameDifference(a: Rgba8Image, b: Rgba8Image): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error("Frames differ in size.")
  let sum = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const aa = a.data[i + 3] / 255
    const ba = b.data[i + 3] / 255
    sum += Math.abs(a.data[i] * aa - b.data[i] * ba) + Math.abs(a.data[i + 1] * aa - b.data[i + 1] * ba) + Math.abs(a.data[i + 2] * aa - b.data[i + 2] * ba)
    sum += Math.abs(a.data[i + 3] - b.data[i + 3])
  }
  return Math.round((sum / (a.data.length * 255)) * 10000) / 100
}

export type MotionMeasure = {
  frames: number
  /** Change between each frame and the next, in % of full scale. */
  frameToFrame: { mean: number; min: number; max: number }
  /** Change from the last frame back to the first. */
  loopStep: number
  /** loopStep ÷ mean step. Near 1 = the loop is as smooth as the rest; well above 1 = a visible pop. */
  loopSeamRatio: number
  coveragePercent: { min: number; max: number }
}

export function measureMotion(frames: readonly Rgba8Image[]): MotionMeasure {
  const steps: number[] = []
  for (let i = 0; i + 1 < frames.length; i++) steps.push(frameDifference(frames[i], frames[i + 1]))
  const mean = steps.length > 0 ? steps.reduce((a, b) => a + b, 0) / steps.length : 0
  const loopStep = frames.length > 1 ? frameDifference(frames[frames.length - 1], frames[0]) : 0
  const coverage = frames.map((f) => measureFrame(f).coveragePercent)
  const round = (v: number): number => Math.round(v * 100) / 100
  return {
    frames: frames.length,
    frameToFrame: { mean: round(mean), min: round(Math.min(...steps, Infinity) === Infinity ? 0 : Math.min(...steps)), max: round(Math.max(0, ...steps)) },
    loopStep: round(loopStep),
    loopSeamRatio: mean > 0 ? round(loopStep / mean) : frames.length > 1 && loopStep > 0 ? Infinity : 1,
    coveragePercent: { min: Math.min(...coverage), max: Math.max(...coverage) }
  }
}
