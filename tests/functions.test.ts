import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import { graphText } from "../src/agent/graphText"
import { planFunctionFromNodes } from "../src/app/functions"
import { applyOps, createDocumentStore, createProject, functionFileText, importFunctionOps, parseFunctionFile, parseProject, serializeProject, type Graph, type Project } from "../src/doc"
import { expandFunctions, functionDef, outerNodeId } from "../src/engine/functions"
import { resolveGraph } from "../src/engine/validate"
import { recipes } from "../src/library/recipes"
import { registry, setProjectFunctions } from "../src/nodes"

function load(name: string): Project {
  const project = parseProject(readFileSync(new URL(`./golden/cases/${name}.vfxf`, import.meta.url), "utf8"))
  setProjectFunctions(project.graphs)
  return project
}
const graphOf = (project: Project, id: string): Graph => project.graphs.find((g) => g.id === id)!

afterEach(() => setProjectFunctions([]))

describe("a function as a node", () => {
  it("takes its sockets from Graph Input and Output nodes and its parameters from what it exposes", () => {
    const project = load("functions")
    const def = functionDef(graphOf(project, "cel"), registry)!
    expect(def.type).toBe("fn_cel")
    expect(def.category).toBe("Functions")
    expect(def.doc).toBe("Two flat tones and a rim from any mask.")
    expect(Object.keys(def.inputs)).toEqual(["shape", "warp_map"])
    expect(def.inputs.shape).toEqual({ type: "gray", optional: true })
    expect(def.outputs).toEqual({ color: "color", tones: "gray" })
    expect(Object.keys(def.params)).toEqual(["wobble", "light", "palette"])
    // The default of an exposed parameter is the value set inside the function.
    expect(def.params.wobble.default).toBe(0.1)
    expect(def.params.wobble.doc).toContain("How much the warp map bends the shape")
  })

  it("is not a node type without an Output inside", () => {
    const empty: Graph = { id: "f", name: "Empty", function: true, settings: load("functions").graphs[0].settings, nodes: [], links: [], frames: [], exposed: [] }
    expect(functionDef(empty, registry)).toBeNull()
  })

  it("is in the registry only while the project holds it", () => {
    expect(registry.get("fn_cel")).toBeUndefined()
    const before = registry.revision!()
    load("functions")
    expect(registry.get("fn_cel")?.fn?.graph.id).toBe("cel")
    expect(registry.get("fn_g1")).toBeUndefined()
    expect(registry.revision!()).not.toBe(before)
  })

  it("reports a function that uses itself", () => {
    const project = load("functions")
    const cel = graphOf(project, "cel")
    const looping = { ...cel, nodes: [...cel.nodes, { id: "self", type: "fn_cel", position: [0, 0] as [number, number], params: {}, driven: {}, version: 1 }] }
    setProjectFunctions(project.graphs.map((g) => (g.id === "cel" ? looping : g)))
    const problems = resolveGraph(looping, registry).problems
    expect(problems.some((p) => p.code === "bad_function" && p.nodeId === "self")).toBe(true)
  })
})

describe("expandFunctions", () => {
  it("returns a graph without function nodes as it is", () => {
    const project = load("functions")
    const cel = graphOf(project, "cel")
    expect(expandFunctions(cel, registry).graph).toBe(cel)
  })

  it("puts a copy of the function in place of the node, wired to what was plugged in", () => {
    const project = load("functions")
    const { graph, aliases } = expandFunctions(graphOf(project, "g1"), registry)
    const ids = graph.nodes.map((n) => n.id)
    expect(ids.some((id) => registry.get(graph.nodes.find((n) => n.id === id)!.type)?.fn)).toBe(false)
    // Node "a" has both inputs plugged, so neither Graph Input is copied; "b" keeps the unplugged warp map.
    expect(ids).toContain("a~w")
    expect(ids).not.toContain("a~shape")
    expect(ids).not.toContain("a~map")
    expect(ids).not.toContain("b~shape")
    expect(ids).toContain("b~map")
    expect(ids).not.toContain("a~o")
    expect(graph.links).toContainEqual({ from: "s.out", to: "a~w.in" })
    expect(graph.links).toContainEqual({ from: "n.out", to: "a~w.map" })
    expect(aliases.get("a.color")).toBe("a~pal.out")
    expect(aliases.get("a.tones")).toBe("a~rim.out")
    // The Output nodes of the outer graph now read from inside the copies.
    expect(graph.links).toContainEqual({ from: "a~pal.out", to: "o1.in" })
    expect(graph.links).toContainEqual({ from: "a~rim.out", to: "o3.in" })
    expect(outerNodeId("a~pal")).toBe("a")
    expect(resolveGraph(graph, registry).problems).toEqual([])
  })

  it("passes values set on the node to the parameters the function exposes, through nested functions too", () => {
    const project = load("functions")
    const { graph } = expandFunctions(graphOf(project, "g1"), registry)
    const node = (id: string) => graph.nodes.find((n) => n.id === id)!
    expect(node("a~w").params.intensity).toBe(0.3)
    expect(node("b~w").params.intensity).toBe(0.1)
    expect(node("b~rim").params.angle).toBe(300)
    // st is Cel Star, which uses Cel Shade inside and exposes its wobble.
    expect(node("st~s").params.points).toBe(6)
    expect(node("st~c~w").params.intensity).toBe(0.4)
    expect(node("st~c~rim").params.angle).toBe(45)
  })

  it("keeps a driver from the outer graph pointing at the outer graph", () => {
    const project = load("functions")
    const { graph } = expandFunctions(graphOf(project, "g2"), registry)
    expect(graph.nodes.find((n) => n.id === "st~c~w")!.driven).toEqual({ intensity: "m.out" })
  })
})

describe("exposed parameters and presets in the document", () => {
  const base = (): Project => load("functions")

  it("exposes and hides a parameter, and undoes both", () => {
    const store = createDocumentStore(base())
    store.apply([{ op: "expose_param", graphId: "g1", id: "s", param: "size", label: "Size" }], { label: "Expose", author: { kind: "human" } })
    expect(graphOf(store.getState().project, "g1").exposed).toEqual([{ nodeId: "s", param: "size", as: "size", label: "Size" }])
    store.apply([{ op: "unexpose_param", graphId: "g1", as: "size" }], { label: "Hide", author: { kind: "human" } })
    expect(graphOf(store.getState().project, "g1").exposed).toEqual([])
    store.undo()
    expect(graphOf(store.getState().project, "g1").exposed).toHaveLength(1)
    store.undo()
    expect(graphOf(store.getState().project, "g1").exposed).toEqual([])
  })

  it("refuses a name that is taken or not a valid name", () => {
    const project = base()
    expect(() => applyOps(project, [{ op: "expose_param", graphId: "cel", id: "w", param: "angle", as: "wobble" }])).toThrow(/already exposes/)
    expect(() => applyOps(project, [{ op: "expose_param", graphId: "cel", id: "w", param: "angle", as: "Bad Name" }])).toThrow(/not a valid name/)
    expect(() => applyOps(project, [{ op: "expose_param", graphId: "cel", id: "nope", param: "angle" }])).toThrow(/no node/)
  })

  it("stores presets, and writes and reads them with the function flag and description", () => {
    const { project } = applyOps(base(), [
      { op: "set_presets", graphId: "cel", presets: [{ name: "Strong", values: { wobble: 0.5, light: 90 } }] },
      { op: "set_graph", graphId: "g1", function: true, description: "Used elsewhere" }
    ])
    const again = parseProject(serializeProject(project))
    expect(graphOf(again, "cel").presets).toEqual([{ name: "Strong", values: { wobble: 0.5, light: 90 } }])
    expect(graphOf(again, "cel").function).toBe(true)
    expect(graphOf(again, "g1").description).toBe("Used elsewhere")
    expect(graphOf(again, "g2").function).toBeUndefined()
    expect(() => applyOps(project, [{ op: "set_presets", graphId: "cel", presets: [{ name: "A", values: {} }, { name: "A", values: {} }] }])).toThrow(/Two presets/)
  })

  it("lists what a graph exposes in the text Claude reads", () => {
    const project = base()
    const lines = graphText(graphOf(project, "cel"), registry, project.seed).split("\n")
    expect(lines[0]).toContain("function: Two flat tones and a rim from any mask.")
    expect(lines[1]).toBe("exposed: wobble=w.intensity, light=rim.angle, palette=pal.gradient")
  })
})

describe("function files", () => {
  it("holds the function and the functions it uses, the function first", () => {
    const project = load("functions")
    const graphs = parseFunctionFile(functionFileText(project, "cel_star"))
    expect(graphs.map((g) => g.id)).toEqual(["cel_star", "cel"])
    expect(graphs.every((g) => g.function)).toBe(true)
  })

  it("comes into another project as it was", () => {
    const project = load("functions")
    const graphs = parseFunctionFile(functionFileText(project, "cel_star"))
    const { ops, mainId } = importFunctionOps(createProject("other"), graphs)
    expect(mainId).toBe("cel_star")
    const result = applyOps(createProject("other"), ops).project
    expect(result.graphs.map((g) => g.id)).toEqual(["cel_star", "cel"])
    setProjectFunctions(result.graphs)
    expect(Object.keys(registry.get("fn_cel_star")!.params)).toEqual(["points", "wobble", "palette"])
  })

  it("adds nothing twice, and renames a function whose id is taken by something else", () => {
    const project = load("functions")
    const graphs = parseFunctionFile(functionFileText(project, "cel_star"))
    expect(importFunctionOps(project, graphs).ops).toEqual([])

    const changed: Project = { ...project, graphs: project.graphs.map((g) => (g.id === "cel" ? { ...g, name: "My own cel" } : g)) }
    const { ops, mainId } = importFunctionOps(changed, graphs)
    // The file's cel is not the project's any more, so both come in under new names, and the new star uses the new cel.
    expect(mainId).toBe("cel_star_2")
    const result = applyOps(changed, ops).project
    expect(result.graphs.map((g) => g.id).slice(-2)).toEqual(["cel_star_2", "cel_2"])
    expect(graphOf(result, "cel_star_2").nodes.find((n) => n.id === "c")!.type).toBe("fn_cel_2")
    expect(graphOf(result, "cel").name).toBe("My own cel")
    expect(graphOf(result, "cel_star").nodes.find((n) => n.id === "c")!.type).toBe("fn_cel")
  })

  it("refuses a file that is not one", () => {
    expect(() => parseFunctionFile("{}")).toThrow()
    expect(() => parseFunctionFile(serializeProject(createProject("empty")))).toThrow(/no function/)
  })
})

describe("making a function from selected nodes", () => {
  it("moves the nodes into a function and wires one node in their place", () => {
    const project = load("functions")
    const cel = graphOf(project, "cel")
    const plan = planFunctionFromNodes(project.graphs, cel, ["w", "rim"], "Bend and rim")
    if ("error" in plan) throw new Error(plan.error)
    const result = applyOps(project, plan.ops).project
    setProjectFunctions(result.graphs)
    const fn = graphOf(result, plan.functionId)
    expect(fn.function).toBe(true)
    expect(fn.name).toBe("Bend and rim")
    expect(fn.nodes.map((n) => n.type).sort()).toEqual(["graph_input", "graph_input", "output", "rim_shade", "warp"])
    const after = graphOf(result, "cel")
    expect(after.nodes.map((n) => n.id)).not.toContain("w")
    const node = after.nodes.find((n) => n.id === plan.nodeId)!
    expect(node.type).toBe(`fn_${plan.functionId}`)
    // Both wires that left the selection came from rim.out, so there is one output, feeding both readers.
    expect(after.links.filter((l) => l.from.startsWith(`${node.id}.`)).map((l) => l.to).sort()).toEqual(["o2.in", "pal.in"])
    expect(after.links.filter((l) => l.to.startsWith(`${node.id}.`)).map((l) => l.from).sort()).toEqual(["map.out", "shape.out"])
    expect(resolveGraph(after, registry).problems).toEqual([])
    expect(resolveGraph(expandFunctions(after, registry).graph, registry).problems).toEqual([])
  })

  it("turns a parameter driven from outside into a parameter of the function", () => {
    const project = load("functions")
    const use = graphOf(project, "g1")
    const plan = planFunctionFromNodes(project.graphs, use, ["n"])
    if ("error" in plan) throw new Error(plan.error)
    const result = applyOps(project, plan.ops).project
    setProjectFunctions(result.graphs)
    const fn = graphOf(result, plan.functionId)
    expect(fn.exposed).toEqual([{ nodeId: "n", param: "evolution", as: "n_evolution" }])
    expect(graphOf(result, "g1").nodes.find((n) => n.id === plan.nodeId)!.driven).toEqual({ n_evolution: "t.phase" })
  })

  it("says why a selection cannot become a function", () => {
    const project = load("functions")
    const use = graphOf(project, "g1")
    expect(planFunctionFromNodes(project.graphs, use, [])).toHaveProperty("error")
    expect(planFunctionFromNodes(project.graphs, use, ["o1"])).toMatchObject({ error: expect.stringContaining("Output") })
    expect(planFunctionFromNodes(project.graphs, use, ["t"])).toMatchObject({ error: expect.stringContaining("driven by") })
  })
})

describe("shipped recipes", () => {
  it("are all there, described, and valid", () => {
    expect(recipes.map((r) => r.id)).toEqual(["cel_fire", "cel_smoke_puff", "cel_slash", "impact_burst", "magic_ring", "cel_lightning", "dissolve_mask"])
    for (const r of recipes) {
      expect(r.description, r.id).not.toBe("")
      setProjectFunctions(r.graphs)
      expect(resolveGraph(r.graphs[0], registry).problems, r.id).toEqual([])
      const def = registry.get(`fn_${r.id}`)!
      expect(Object.keys(def.outputs).length, r.id).toBeGreaterThan(0)
      // Every exposed entry points at a real parameter, so each one shows up on the node.
      expect(Object.keys(def.params), r.id).toEqual(r.graphs[0].exposed.map((e) => e.as))
      for (const preset of r.graphs[0].presets ?? []) for (const name of Object.keys(preset.values)) expect(def.params, `${r.id} preset ${preset.name}`).toHaveProperty(name)
    }
  })

  it("are the same functions the golden case renders", () => {
    const golden = load("recipes")
    for (const r of recipes) expect(serializeProject({ ...createProject("x"), graphs: [graphOf(golden, r.id)] }), r.id).toBe(serializeProject({ ...createProject("x"), graphs: [r.graphs[0]] }))
  })
})
