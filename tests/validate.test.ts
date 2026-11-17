import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { applyOps, createProject, parseProject, serializeProject, type Op } from "../src/doc"
import { checkParam, defineNode } from "../src/engine/nodeDef"
import { resolveGraph, topologicalOrder } from "../src/engine/validate"
import { nodeDefs, registry } from "../src/nodes"

const G = "g1"

function graphOf(ops: Op[]) {
  return applyOps(createProject(), [{ op: "add_graph", name: "t" }, ...ops]).project.graphs[0]
}

describe("node definitions", () => {
  it("every shipped node has a doc string and a category", () => {
    expect(nodeDefs.length).toBeGreaterThanOrEqual(20)
    for (const def of nodeDefs) {
      expect(def.doc.length, def.type).toBeGreaterThan(10)
      expect(def.category, def.type).toBeTruthy()
    }
  })

  it("adds tiling to nodes with image inputs and seed to seeded nodes", () => {
    expect(registry.get("warp")!.params.tiling).toMatchObject({ type: "enum", default: "tile" })
    expect(registry.get("shape")!.params.tiling).toBeUndefined()
    expect(registry.get("perlin")!.params.seed).toMatchObject({ type: "int", default: 0 })
  })

  it("rejects broken definitions", () => {
    const base = { type: "x", category: "Test", doc: "A test node.", inputs: {}, outputs: { out: "gray" as const }, params: {} }
    const wgsl = "fn node(uv: vec2f) -> vec4f { return vec4f(0.0); }"
    expect(() => defineNode({ ...base })).toThrow(/exactly one of wgsl or evaluate/)
    expect(() => defineNode({ ...base, wgsl: "fn other() {}" })).toThrow(/fn node/)
    expect(() => defineNode({ ...base, wgsl, type: "BadName" })).toThrow(/snake_case/)
    expect(() => defineNode({ ...base, wgsl, outputs: { out: "same:nope" } })).toThrow(/missing image input/)
    expect(() => defineNode({ ...base, wgsl, params: { a: { type: "float", default: 5, max: 1 } } })).toThrow(/default of "a"/)
    expect(() => defineNode({ ...base, wgsl, inputs: { v: "value" } })).toThrow(/driven parameters/)
  })

  it("checks parameter values against the schema", () => {
    expect(checkParam({ type: "float", default: 0, min: 0, max: 1 }, 0.5)).toBeNull()
    expect(checkParam({ type: "float", default: 0, min: 0, max: 1 }, 2)).toMatch(/at most 1/)
    expect(checkParam({ type: "int", default: 0 }, 1.5)).toMatch(/whole number/)
    expect(checkParam({ type: "enum", default: "a", options: ["a", "b"] }, "c")).toMatch(/one of a, b/)
    expect(checkParam({ type: "floatList", default: [], maxLength: 2 }, [1, 2, 3])).toMatch(/at most 2/)
    expect(checkParam({ type: "gradient", default: [] }, [{ position: 2, color: [0, 0, 0, 1] }])).toMatch(/position/)
  })
})

describe("graph validation", () => {
  it("accepts the shipped cel fire example and types its sockets", () => {
    const project = parseProject(readFileSync("src/library/examples/cel_fire.vfxf", "utf8"))
    const resolved = resolveGraph(project.graphs[0], registry)
    expect(resolved.problems).toEqual([])
    expect(resolved.outputTypes.get("n7.out")).toBe("gray")
    expect(resolved.outputTypes.get("n9.out")).toBe("color")
    expect(resolved.outputTypes.get("n1.phase")).toBe("value")
  })

  it("the example file is in canonical form", () => {
    const text = readFileSync("src/library/examples/cel_fire.vfxf", "utf8")
    expect(serializeProject(parseProject(text))).toBe(text)
  })

  it("orders sources before the nodes they feed", () => {
    const graph = graphOf([
      { op: "add_node", graphId: G, type: "output", id: "o" },
      { op: "add_node", graphId: G, type: "perlin", id: "p" },
      { op: "add_node", graphId: G, type: "time", id: "t" },
      { op: "connect", graphId: G, from: "p.out", to: "o.in" },
      { op: "drive_param", graphId: G, id: "p", param: "evolution", from: "t.phase" }
    ])
    expect(topologicalOrder(graph).map((n) => n.id)).toEqual(["t", "p", "o"])
  })

  it("output type follows the input for same:in", () => {
    const graph = graphOf([
      { op: "add_node", graphId: G, type: "perlin", id: "p" },
      { op: "add_node", graphId: G, type: "levels", id: "l" },
      { op: "connect", graphId: G, from: "p.out", to: "l.in" }
    ])
    expect(resolveGraph(graph, registry).outputTypes.get("l.out")).toBe("gray")
  })

  it("reports each kind of problem on the right node", () => {
    const graph = graphOf([
      { op: "add_node", graphId: G, type: "nope", id: "a" },
      { op: "add_node", graphId: G, type: "perlin", id: "p", params: { scale: -1, bogus: 1 } },
      { op: "add_node", graphId: G, type: "time", id: "t" },
      { op: "add_node", graphId: G, type: "warp", id: "w" },
      { op: "add_node", graphId: G, type: "shape", id: "s" },
      { op: "connect", graphId: G, from: "t.phase", to: "w.in" },
      { op: "connect", graphId: G, from: "p.nothing", to: "w.map" },
      { op: "connect", graphId: G, from: "p.out", to: "w.extra" },
      { op: "drive_param", graphId: G, id: "s", param: "shape", from: "t.phase" },
      { op: "drive_param", graphId: G, id: "s", param: "rotation", from: "p.out" }
    ])
    const found = resolveGraph(graph, registry).problems.map((p) => `${p.nodeId}:${p.code}`).sort()
    expect(found).toEqual(
      [
        "a:unknown_type",
        "p:bad_param",
        "p:unknown_param",
        "s:bad_driver",
        "s:bad_driver",
        "w:type_mismatch",
        "w:unknown_socket",
        "w:unknown_socket"
      ].sort()
    )
  })

  it("reports unconnected required inputs but not optional ones", () => {
    const graph = graphOf([
      { op: "add_node", graphId: G, type: "blend", id: "b" },
      { op: "add_node", graphId: G, type: "channels_merge", id: "m" }
    ])
    const found = resolveGraph(graph, registry).problems.map((p) => `${p.nodeId}:${p.message}`)
    expect(found).toEqual(['b:Input "fg" is not connected.', 'b:Input "bg" is not connected.'])
  })
})
