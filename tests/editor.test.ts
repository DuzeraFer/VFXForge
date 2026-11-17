import { describe, expect, it } from "vitest"
import { autoLayoutOps, createGraph, LAYOUT, nodeDepths, type Graph } from "../src/doc"
import { sampleGradient, spaceEvenly } from "../src/inspector/gradient"
import type { GradientStop } from "../src/doc"

function chain(): Graph {
  const node = (id: string, x: number, y: number) => ({ id, type: "perlin", position: [x, y] as [number, number], params: {}, driven: {}, version: 1 })
  return {
    ...createGraph("g1", "Graph"),
    nodes: [node("a", 40, 300), node("b", 0, 0), node("c", 500, 20), { ...node("d", 10, 10), driven: { scale: "b.out" } }],
    links: [
      { from: "a.out", to: "c.in" },
      { from: "b.out", to: "c.map" }
    ]
  }
}

describe("auto layout", () => {
  it("puts sources in the first column and counts drivers as inputs", () => {
    const depths = nodeDepths(chain())
    expect([depths.get("a"), depths.get("b"), depths.get("c"), depths.get("d")]).toEqual([0, 0, 1, 1])
  })

  it("lays columns out left to right, keeping the vertical order", () => {
    const graph = chain()
    const moved = new Map(autoLayoutOps(graph).map((op) => (op.op === "move_node" ? [op.id, op.position] : ["", [0, 0]])))
    // Origin is the top-left of what was there: (0, 0).
    expect(moved.get("a")).toEqual([0, LAYOUT.rowGap])
    expect(moved.has("b")).toBe(false) // already in place
    expect(moved.get("d")).toEqual([LAYOUT.columnGap, 0])
    expect(moved.get("c")).toEqual([LAYOUT.columnGap, LAYOUT.rowGap])
  })

  it("moves only the chosen nodes", () => {
    const ops = autoLayoutOps(chain(), ["a", "c"])
    expect(ops.every((op) => op.op === "move_node" && ["a", "c"].includes(op.id))).toBe(true)
  })
})

describe("gradient preview", () => {
  const stops: GradientStop[] = [
    { position: 0, color: [0, 0, 0, 1] },
    { position: 1, color: [1, 1, 1, 1] }
  ]

  it("blends evenly between soft stops", () => {
    expect(sampleGradient(stops, 0.5)[0]).toBeCloseTo(0.5)
    expect(sampleGradient(stops, 0)[0]).toBeCloseTo(0)
    expect(sampleGradient(stops, 1)[0]).toBeCloseTo(1)
  })

  it("a hard stop switches at its position", () => {
    const hard: GradientStop[] = [stops[0], { ...stops[1], position: 0.5, hardness: 1 }]
    expect(sampleGradient(hard, 0.49)[0]).toBeCloseTo(0)
    expect(sampleGradient(hard, 0.51)[0]).toBeCloseTo(1)
  })

  it("does not depend on the order the stops are stored in", () => {
    expect(sampleGradient([stops[1], stops[0]], 0.25)).toEqual(sampleGradient(stops, 0.25))
  })

  it("spaces stops evenly for cel bands", () => {
    const uneven: GradientStop[] = [
      { position: 0.9, color: [1, 1, 1, 1] },
      { position: 0.1, color: [0, 0, 0, 1] },
      { position: 0.2, color: [0.5, 0.5, 0.5, 1], hardness: 1 },
      { position: 0.3, color: [0.7, 0.7, 0.7, 1] }
    ]
    const even = spaceEvenly(uneven)
    expect(even.map((s) => s.position)).toEqual([0, 0.333, 0.667, 1])
    expect(even[1].hardness).toBe(1)
  })
})
