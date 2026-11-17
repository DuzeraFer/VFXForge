import { describe, expect, it } from "vitest"
import { buildLayout, packParams } from "../src/engine/shader"
import type { ParamSchema } from "../src/engine/nodeDef"

describe("uniform layout", () => {
  it("follows WGSL alignment rules", () => {
    const params: Record<string, ParamSchema> = {
      a: { type: "float", default: 0 },
      v: { type: "vec2", default: [0, 0] },
      b: { type: "bool", default: false },
      c: { type: "color", default: [0, 0, 0, 1] },
      n: { type: "int", default: 0 },
      list: { type: "floatList", default: [], maxLength: 8 }
    }
    const layout = buildLayout(params)
    const at = Object.fromEntries(layout.fields.map((f) => [f.name, f.offset]))
    expect(at).toEqual({ a: 0, v: 8, b: 16, c: 32, n: 48, list_data: 64, list_count: 96 })
    expect(layout.size).toBe(112)
  })

  it("is never empty", () => {
    expect(buildLayout({}).size).toBe(16)
    expect(buildLayout({ name: { type: "string", default: "" } }).fields).toEqual([])
  })

  it("packs values, converting angles and enums", () => {
    const params: Record<string, ParamSchema> = {
      angle: { type: "angle", default: 0 },
      mode: { type: "enum", default: "add", options: ["copy", "add", "multiply"] },
      on: { type: "bool", default: false },
      list: { type: "floatList", default: [], maxLength: 4 },
      ramp: { type: "gradient", default: [{ position: 0, color: [0, 0, 0, 1] }] }
    }
    const layout = buildLayout(params)
    const view = new DataView(
      packParams(layout, params, {
        angle: 180,
        mode: "multiply",
        on: true,
        list: [0.25, 0.5],
        ramp: [
          { position: 1, color: [1, 1, 1, 1], hardness: 1 },
          { position: 0, color: [0.5, 0, 0, 1] }
        ]
      })
    )
    const at = Object.fromEntries(layout.fields.map((f) => [f.name, f.offset]))
    expect(view.getFloat32(at.angle, true)).toBeCloseTo(Math.PI)
    expect(view.getUint32(at.mode, true)).toBe(2)
    expect(view.getUint32(at.on, true)).toBe(1)
    expect(view.getFloat32(at.list_data + 4, true)).toBe(0.5)
    expect(view.getUint32(at.list_count, true)).toBe(2)
    // Stops are sorted by position before packing.
    expect(view.getFloat32(at.ramp_colors, true)).toBe(0.5)
    expect(view.getFloat32(at.ramp_stops + 16, true)).toBe(1)
    expect(view.getFloat32(at.ramp_stops + 20, true)).toBe(1)
    expect(view.getUint32(at.ramp_count, true)).toBe(2)
  })
})
