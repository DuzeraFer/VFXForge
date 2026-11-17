import { describe, expect, it } from "vitest"
import { clamp, LEFT_PANEL, resizeBy, RIGHT_COLUMN } from "../src/app/layout"

describe("clamp", () => {
  it("keeps values inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it("falls back to min for NaN", () => {
    expect(clamp(Number.NaN, 2, 10)).toBe(2)
  })
})

describe("resizeBy", () => {
  it("grows the left panel when dragged right", () => {
    expect(resizeBy(240, 40, 1, LEFT_PANEL)).toBe(280)
  })

  it("grows the right column when dragged left", () => {
    expect(resizeBy(360, -40, -1, RIGHT_COLUMN)).toBe(400)
  })

  it("stops at the limits", () => {
    expect(resizeBy(240, -500, 1, LEFT_PANEL)).toBe(LEFT_PANEL.min)
    expect(resizeBy(360, -5000, -1, RIGHT_COLUMN)).toBe(RIGHT_COLUMN.max)
  })
})
