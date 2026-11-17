import { describe, expect, it } from "vitest"
import { graphText } from "../src/agent/graphText"
import { placeNewNodes } from "../src/agent/place"
import { TOOL_SPECS } from "../src/agent/toolSpecs"
import { createGraph, LAYOUT, parseProject, type Graph } from "../src/doc"
import { frameDifference, measureFrame, measureMotion } from "../src/engine/measure"
import type { Rgba8Image } from "../src/engine/render"
import { registry } from "../src/nodes"
import { readFileSync } from "node:fs"

describe("compact graph text", () => {
  const project = parseProject(readFileSync("src/library/examples/cel_fire.vfxf", "utf8"))
  const lines = graphText(project.graphs[0], registry, project.seed).split("\n")

  it("starts with the graph settings", () => {
    expect(lines[0]).toBe('graph g1 "fire_cel_green"  256x256  frames=16 fps=12 loop  seed=7')
  })

  it("writes one node per line with changed parameters, drivers and links", () => {
    expect(lines).toHaveLength(10)
    expect(lines[2]).toBe('n2  perlin         octaves=2 scale=3 evolution<-n1.phase "Warp noise"')
    expect(lines[5]).toBe("n5  warp           intensity=0.2 tiling=clamp in<-n4 map<-n2")
    expect(lines[7]).toBe("n7  band           thresholds=[-0.08,0,0.13] in<-n6")
  })

  it("full detail adds the defaults", () => {
    const full = graphText(project.graphs[0], registry, project.seed, "full").split("\n")
    expect(full[7]).toContain("softness=0")
  })

  it("says when a graph is empty", () => {
    expect(graphText(createGraph("g2", "New"), registry, 0)).toContain("(empty)")
  })
})

function image(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Rgba8Image {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4)
  return { width, height, data }
}

describe("measure", () => {
  // A 4x4 red square and a single stray green pixel on a 16x16 transparent frame.
  const frame = image(16, 16, (x, y) => (x >= 4 && x < 8 && y >= 6 && y < 10 ? [255, 0, 0, 255] : x === 12 && y === 2 ? [0, 255, 0, 255] : [0, 0, 0, 0]))
  const m = measureFrame(frame)

  it("reports coverage and the bounding box", () => {
    expect(m.coveragePercent).toBe(6.6)
    expect(m.bbox).toEqual([4, 2, 9, 8])
  })

  it("counts islands and finds the smallest", () => {
    expect(m.islands).toEqual({ count: 2, smallestArea: 1, largestArea: 16 })
  })

  it("knows when the shape touches a border", () => {
    expect(m.touchesEdge.any).toBe(false)
    const touching = measureFrame(image(8, 8, (x) => (x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0])))
    expect(touching.touchesEdge).toEqual({ left: true, right: false, top: true, bottom: true, any: true })
  })

  it("lists dominant colors with their share of the shape", () => {
    expect(m.dominantColors[0]).toEqual({ color: "#ff0000", percentOfShape: 94.1 })
    expect(m.dominantColors[1].color).toBe("#00ff00")
  })

  it("handles an empty frame", () => {
    const empty = measureFrame(image(4, 4, () => [0, 0, 0, 0]))
    expect(empty.bbox).toBeNull()
    expect(empty.islands.count).toBe(0)
  })

  it("measures motion and the loop seam", () => {
    const at = (offset: number): Rgba8Image => image(16, 16, (x) => (x >= offset && x < offset + 4 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    expect(frameDifference(at(0), at(0))).toBe(0)
    // Steady drift, then a jump back to the start: the seam stands out.
    const motion = measureMotion([at(0), at(1), at(2), at(3), at(4), at(5)])
    expect(motion.frameToFrame.min).toBe(motion.frameToFrame.max)
    expect(motion.loopSeamRatio).toBeGreaterThan(3)
    // A true loop: the last step is like the others.
    const loop = measureMotion([at(0), at(1), at(2), at(1)])
    expect(loop.loopSeamRatio).toBe(1)
  })
})

describe("placing new nodes", () => {
  const node = (id: string, position: [number, number] = [0, 0]) => ({ id, type: "perlin", position, params: {}, driven: {}, version: 1 })
  const graph = (nodes: ReturnType<typeof node>[], links: [string, string][]): Graph => ({
    ...createGraph("g1", "Graph"),
    nodes,
    links: links.map(([from, to]) => ({ from, to }))
  })

  it("puts a node to the right of what feeds it", () => {
    const spots = placeNewNodes(graph([node("a", [80, 40]), node("b")], [["a.out", "b.in"]]), ["b"])
    expect(spots.get("b")).toEqual([80 + LAYOUT.columnGap, 40])
  })

  it("lays a new chain out left to right and never stacks cards", () => {
    const spots = placeNewNodes(
      graph([node("a"), node("b"), node("c"), node("d")], [
        ["a.out", "c.in"],
        ["b.out", "c.map"],
        ["c.out", "d.in"]
      ]),
      ["a", "b", "c", "d"]
    )
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => spots.get(id)!)
    expect(a).toEqual([0, 0])
    expect(b[0]).toBe(a[0])
    expect(b[1]).toBeGreaterThanOrEqual(a[1] + LAYOUT.rowGap)
    expect(c[0]).toBe(LAYOUT.columnGap)
    expect(d[0]).toBe(LAYOUT.columnGap * 2)
  })

  it("puts a source to the left of its consumer", () => {
    const spots = placeNewNodes(graph([node("a", [400, 80]), node("src")], [["src.out", "a.in"]]), ["src"])
    expect(spots.get("src")).toEqual([400 - LAYOUT.columnGap, 80])
  })
})

describe("tool specs", () => {
  it("have unique names and descriptions", () => {
    expect(new Set(TOOL_SPECS.map((t) => t.name)).size).toBe(TOOL_SPECS.length)
    for (const tool of TOOL_SPECS) expect(tool.description.length).toBeGreaterThan(20)
  })
})
