import { describe, expect, it } from "vitest"
import { defineNode } from "../src/engine/nodeDef"
import { isResultNode } from "../src/engine/render"
import { sheetCols, sheetSize } from "../src/engine/sheet"
import patternGrid from "../src/nodes/pattern_grid"
import randomFlipbook from "../src/nodes/random_flipbook"
import sheetOutput from "../src/nodes/sheet_output"

const defaults = (def: { params: Record<string, { default: unknown }> }, over: Record<string, unknown> = {}): Record<string, never> =>
  ({ ...Object.fromEntries(Object.entries(def.params).map(([k, v]) => [k, v.default])), ...over }) as Record<string, never>

describe("sheet layout", () => {
  it("picks the squarest grid unless told otherwise", () => {
    expect([1, 2, 4, 5, 9, 16, 17].map((n) => sheetCols(n, 0))).toEqual([1, 2, 2, 3, 3, 4, 5])
    expect(sheetCols(16, 8)).toBe(8)
    expect(sheetCols(3, 8)).toBe(3)
    expect(sheetCols(0, 0)).toBe(1)
  })

  it("is an even grid of cells, padding included", () => {
    expect(sheetSize({ cols: 4, padding: 0, cells: { length: 16 } }, 256, 256)).toMatchObject({ width: 1024, height: 1024, rows: 4 })
    expect(sheetSize({ cols: 4, padding: 2, cells: { length: 6 } }, 64, 32)).toEqual({ width: 272, height: 72, cols: 4, rows: 2, cellWidth: 68, cellHeight: 36 })
  })
})

describe("sheet nodes", () => {
  it("Sheet Output asks for every frame of its input", () => {
    const plan = sheetOutput.assemble!({ params: defaults(sheetOutput, { padding: 2 }), connected: ["in"], frame: 5, frames: 16 })
    expect(plan.cols).toBe(4)
    expect(plan.padding).toBe(2)
    expect(plan.cells).toHaveLength(16)
    expect(plan.cells[7]).toEqual({ input: "in", frame: 7, seed: 0 })
    expect(isResultNode("sheet_output") && isResultNode("output") && !isResultNode("band")).toBe(true)
  })

  it("Random Flipbook asks for the current frame with different seeds", () => {
    const plan = randomFlipbook.assemble!({ params: defaults(randomFlipbook, { count: 6, cols: 3 }), connected: ["in"], frame: 2, frames: 8 })
    expect(plan.cols).toBe(3)
    expect(plan.cells.map((c) => c.seed)).toEqual([0, 1, 2, 3, 4, 5])
    expect(plan.cells.every((c) => c.frame === 2 && c.input === "in")).toBe(true)
  })

  it("Pattern Grid packs the connected inputs in order", () => {
    const plan = patternGrid.assemble!({ params: defaults(patternGrid), connected: ["in1", "in3", "in6"], frame: 0, frames: 1 })
    expect(plan.cols).toBe(2)
    expect(plan.cells.map((c) => c.input)).toEqual(["in1", "in3", "in6"])
    expect(Object.values(patternGrid.inputs).every((i) => i.optional)).toBe(true)
  })

  it("a node is a shader, a value or a sheet, never two", () => {
    const base = { type: "x", category: "Test", doc: "Test.", inputs: { in: "image" as const }, outputs: { out: "same:in" as const }, params: {} }
    const assemble = (): { cols: number; padding: number; dilate: number; cells: never[] } => ({ cols: 1, padding: 0, dilate: 0, cells: [] })
    expect(defineNode({ ...base, assemble }).params.tiling).toBeUndefined()
    expect(() => defineNode({ ...base, assemble, wgsl: "fn node(uv: vec2f) -> vec4f { return vec4f(0.0); }" })).toThrow(/exactly one/)
    expect(() => defineNode({ ...base, outputs: { a: "color", b: "color" }, assemble })).toThrow(/exactly one output/)
  })
})
