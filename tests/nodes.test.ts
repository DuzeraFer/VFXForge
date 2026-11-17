import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Project } from "../src/doc/types"
import { evaluateExpression, ExpressionError } from "../src/engine/expression"
import { codeProblem, buildLayout, buildShader, hashText } from "../src/engine/shader"
import { resolveGraph } from "../src/engine/validate"
import { exportTargets } from "../src/export/render"
import { nodeDefs, registry } from "../src/nodes"
import { parseProject } from "../src/doc/serialize"

const CASES = join(__dirname, "golden", "cases")
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith(".vfxf"))
  .map((f) => parseProject(readFileSync(join(CASES, f), "utf8")))

describe("node library", () => {
  it("has a golden case for every node type", () => {
    const used = new Set(cases.flatMap((p: Project) => p.graphs.flatMap((g) => g.nodes.map((n) => n.type))))
    expect(nodeDefs.map((d) => d.type).filter((type) => !used.has(type))).toEqual([])
  })

  it("golden cases have no problems", () => {
    for (const project of cases) {
      for (const graph of project.graphs) {
        expect(resolveGraph(graph, registry).problems, `${project.name}/${graph.name}`).toEqual([])
      }
    }
  })

  it("documents every node and parameter range for the agent", () => {
    for (const def of nodeDefs) {
      expect(def.doc.length, def.type).toBeGreaterThan(30)
      expect(def.category, def.type).toMatch(/^(Inputs|Shapes|Splines|Noises|Patterns|Transform|Tone & Color|Filters|Blending|Math|Outputs|Sources)$/)
    }
  })
})

describe("value expression", () => {
  const names = { a: 2, b: 3, phase: 0.25, pi: Math.PI }
  const run = (text: string): number => evaluateExpression(text, names)

  it("follows the usual order of operations", () => {
    expect(run("1 + 2 * 3")).toBe(7)
    expect(run("(1 + 2) * 3")).toBe(9)
    expect(run("-a ^ 2")).toBe(-4)
    expect(run("2 ^ 3 ^ 2")).toBe(512)
    expect(run("7 % 3 + 10 / 4")).toBe(3.5)
    expect(run(" a*b - .5e1 ")).toBe(1)
  })

  it("has functions, with sin and cos in turns", () => {
    expect(run("sin(phase)")).toBeCloseTo(1)
    expect(run("cos(0.5)")).toBeCloseTo(-1)
    expect(run("clamp(a * b, 0, 4) + min(3, 1, 2) + lerp(0, 10, 0.3)")).toBeCloseTo(8)
    expect(run("ping(0.25)")).toBeCloseTo(0.5)
    expect(run("smoothstep(0, 1, 0.5)")).toBeCloseTo(0.5)
  })

  it("never returns something that is not a number", () => {
    expect(run("1 / 0")).toBe(0)
    expect(run("sqrt(-4)")).toBe(0)
    expect(run("pow(-8, 0.5)")).toBe(0)
  })

  it("explains mistakes", () => {
    const message = (text: string): string => {
      try {
        run(text)
        return ""
      } catch (error) {
        expect(error).toBeInstanceOf(ExpressionError)
        return (error as Error).message
      }
    }
    expect(message("a +")).toMatch(/ends too soon/)
    expect(message("(a + b")).toMatch(/not closed/)
    expect(message("q + 1")).toMatch(/"q" is not known/)
    expect(message("nope(1)")).toMatch(/no function called "nope"/)
    expect(message("pow(1)")).toMatch(/pow takes 2 values, not 1/)
    expect(message("a b")).toMatch(/not expected/)
    expect(message("constructor")).toMatch(/not known/)
    expect(message("toString(1)")).toMatch(/no function/)
    expect(message("(".repeat(60))).toMatch(/Too many brackets/)
  })

  it("shows up as a problem on the node", () => {
    const graph = cases.find((p) => p.name === "nodes2")!.graphs.find((g) => g.name === "value_expression")!
    const broken = { ...graph, nodes: graph.nodes.map((n) => (n.type === "value_expression" ? { ...n, params: { ...n.params, expression: "a +* 2" } } : n)) }
    expect(resolveGraph(broken, registry).problems.map((p) => p.message)).toEqual([expect.stringMatching(/^Expression: /)])
  })
})

describe("pixel expression", () => {
  const def = registry.get("pixel_expression")!

  it("puts the code into the shader", () => {
    const shader = buildShader(def, buildLayout(def.params), { a: null, b: null, c: null, d: null }, 0, "return vec4f(x);")
    expect(shader.code).toContain("return vec4f(x);")
    expect(shader.code).not.toContain("/*CODE*/")
  })

  it("keeps a `$&` in the code as typed", () => {
    const shader = buildShader(def, buildLayout(def.params), { a: null, b: null, c: null, d: null }, 0, "// $& $1\nreturn a;")
    expect(shader.code).toContain("// $& $1")
  })

  it("refuses loops without a visible end, and bindings", () => {
    expect(codeProblem("return a;")).toBeNull()
    expect(codeProblem("var s = 0.0; for (var i = 0; i < 8; i++) { s += 1.0; } return vec4f(s);")).toBeNull()
    expect(codeProblem("loop { } return a;")).toMatch(/for loop/)
    expect(codeProblem("while (true) { } return a;")).toMatch(/for loop/)
    expect(codeProblem("for (var i = 0; ; i++) { } return a;")).toMatch(/end condition/)
    expect(codeProblem("// a while ago\nreturn a;")).toBeNull()
    expect(codeProblem("} @group(0) @binding(9) var t: texture_2d<f32>; fn f() {")).toMatch(/bindings/)
    expect(codeProblem("x".repeat(9000))).toMatch(/longer/)
  })

  it("is reported on the node", () => {
    const graph = cases.find((p) => p.name === "nodes2")!.graphs.find((g) => g.name === "pixel_expression")!
    const broken = { ...graph, nodes: graph.nodes.map((n) => (n.type === "pixel_expression" ? { ...n, params: { ...n.params, code: "loop {}" } } : n)) }
    expect(resolveGraph(broken, registry).problems).toHaveLength(1)
  })

  it("hashes different code differently", () => {
    expect(hashText("return a;")).not.toBe(hashText("return b;"))
    expect(hashText("return a;")).toBe(hashText("return a;"))
  })
})

describe("packed output", () => {
  it("exports as data and lists what is in each channel", () => {
    const project = cases.find((p) => p.name === "nodes2")!
    const target = exportTargets(project, registry).find((t) => t.name === "packed")!
    expect(target.usage).toBe("mask")
    expect(target.packing).toEqual({ r: "shape", g: "perlin", b: null, a: null })
    expect(target.sheet).toBeNull()
  })
})
