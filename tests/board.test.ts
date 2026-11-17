import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { graphText, graphTextOps, GraphTextError, parseGraphText } from "../src/agent/graphText"
import { TOOL_SPECS } from "../src/agent/toolSpecs"
import { variationOps } from "../src/app/variations"
import {
  addComment,
  addReference,
  addSnapshot,
  applyOps,
  BoardError,
  createDocumentStore,
  createGraph,
  createProject,
  MAX_SNAPSHOTS,
  parseProject,
  removeReference,
  replyToComment,
  resolveComment,
  serializeProject,
  threadsOf,
  updateReference,
  type Project
} from "../src/doc"
import { contactSheet, gridColumns, parseSweep, seedVariations, sweepValues, variantGraph } from "../src/engine/variations"
import { registry } from "../src/nodes"

const fire = (): Project => parseProject(readFileSync("src/library/examples/cel_fire.vfxf", "utf8"))
const IMAGE = "images/0123456789abcdef.png"
const at = new Date("2026-11-17T12:00:00Z")

describe("the reference board", () => {
  it("adds, annotates and removes a picture, each as an undoable step", () => {
    const store = createDocumentStore(fire())
    const { op, id } = addReference(store.getState().project, IMAGE, "fire ref", "the shape, not the color")
    store.apply([op], { label: "Add reference", author: { kind: "human" } })
    expect(store.getState().project.references).toEqual([{ id: "ref1", image: IMAGE, name: "fire ref", note: "the shape, not the color" }])
    store.apply([updateReference(store.getState().project, id, { note: "" })], { label: "Note", author: { kind: "human" } })
    expect(store.getState().project.references[0].note).toBeUndefined()
    store.undo()
    expect(store.getState().project.references[0].note).toBe("the shape, not the color")
    store.apply([removeReference(store.getState().project, id)], { label: "Remove", author: { kind: "human" } })
    expect(store.getState().project.references).toEqual([])
  })

  it("refuses the same picture twice and an unknown id", () => {
    const project = applyOps(fire(), [addReference(fire(), IMAGE).op]).project
    expect(() => addReference(project, IMAGE)).toThrow(BoardError)
    expect(() => removeReference(project, "nope")).toThrow(/no reference/)
  })
})

describe("comment threads", () => {
  it("start on a node, take replies, and resolve", () => {
    let project = fire()
    const started = addComment(project, { graphId: "g1", nodeId: "n4" }, "  this tip is too thin ", { author: "You" }, at)
    project = applyOps(project, [started.op]).project
    expect(project.comments).toEqual([{ id: "c1", graphId: "g1", nodeId: "n4", messages: [{ author: "You", text: "this tip is too thin", timestamp: at.toISOString() }] }])
    project = applyOps(project, [replyToComment(project, "c1", "Raised taper to 0.8.", { author: "Claude", agent: true }, true, at)]).project
    expect(project.comments[0].resolved).toBe(true)
    expect(project.comments[0].messages[1]).toMatchObject({ author: "Claude", agent: true })
    // Answering a resolved thread opens it again.
    project = applyOps(project, [replyToComment(project, "c1", "Still thin at frame 8.", { author: "You" }, false, at)]).project
    expect(project.comments[0].resolved).toBeUndefined()
    project = applyOps(project, [resolveComment(project, "c1", true)]).project
    expect(project.comments[0].resolved).toBe(true)
  })

  it("refuses empty text, unknown nodes and unknown threads", () => {
    const project = fire()
    expect(() => addComment(project, { graphId: "g1", nodeId: "n4" }, "   ", { author: "You" })).toThrow(/needs some text/)
    expect(() => addComment(project, { graphId: "g1", nodeId: "zz" }, "hi", { author: "You" })).toThrow(/no node/)
    expect(() => replyToComment(project, "c9", "hi", { author: "You" })).toThrow(/no comment thread/)
    expect(() => applyOps(project, [{ op: "set_comments", comments: [{ id: "c1", messages: [] }] }])).toThrow(/at least one message/)
  })

  it("lists a graph's threads, leaving out those on nodes that are gone", () => {
    let project = fire()
    project = applyOps(project, [addComment(project, { graphId: "g1", nodeId: "n4" }, "on the flame", { author: "You" }, at).op]).project
    project = applyOps(project, [addComment(project, { graphId: "g1" }, "on the graph", { author: "You" }, at).op]).project
    expect(threadsOf(project, "g1").map((c) => c.id)).toEqual(["c1", "c2"])
    expect(threadsOf(project, "g1", "n4").map((c) => c.id)).toEqual(["c1"])
    project = applyOps(project, [{ op: "remove_node", graphId: "g1", id: "n4" }]).project
    expect(threadsOf(project, "g1").map((c) => c.id)).toEqual(["c2"])
  })
})

describe("snapshots", () => {
  it("are named, kept with the project and limited in number", () => {
    let project = fire()
    for (let i = 0; i < MAX_SNAPSHOTS + 2; i++) {
      project = applyOps(project, [addSnapshot(project, { image: IMAGE, graphId: "g1", target: "n9.out", frame: 0, name: i === 0 ? "first" : undefined }, at).op]).project
    }
    expect(project.snapshots).toHaveLength(MAX_SNAPSHOTS)
    expect(project.snapshots!.some((s) => s.name === "first")).toBe(false)
    const again = parseProject(serializeProject(project))
    expect(again.snapshots).toEqual(project.snapshots)
    expect(serializeProject(again)).toBe(serializeProject(project))
  })

  it("leave the file as it was when there are none", () => {
    const text = serializeProject(fire())
    expect(text).not.toContain("snapshots")
    expect(serializeProject(parseProject(text))).toBe(text)
  })

  it("write references and comments to the file, where the asset scan finds the pictures", () => {
    let project = fire()
    project = applyOps(project, [addReference(project, IMAGE, "ref").op]).project
    project = applyOps(project, [addComment(project, { graphId: "g1" }, 'say "hi"', { author: "You" }, at).op]).project
    const text = serializeProject(project)
    expect(text).toContain(`"${IMAGE}"`)
    expect(parseProject(text).comments[0].messages[0].text).toBe('say "hi"')
  })
})

describe("variations", () => {
  it("set values on a copy of the graph and leave the graph alone", () => {
    const graph = fire().graphs[0]
    const variant = variantGraph(graph, { label: "wide", params: { n4: { taper: 0.6 }, n2: { evolution: 0.25 } } }, registry)
    expect(variant.nodes.find((n) => n.id === "n4")!.params.taper).toBe(0.6)
    // A value given for a driven parameter replaces the driver, or nothing would change.
    expect(variant.nodes.find((n) => n.id === "n2")!.driven).toEqual({})
    expect(graph.nodes.find((n) => n.id === "n4")!.params.taper).toBe(1.1)
    expect(variantGraph(graph, { label: "seed only", seed: 3 }, registry)).toBe(graph)
  })

  it("say what is wrong with a variation", () => {
    const graph = fire().graphs[0]
    expect(() => variantGraph(graph, { label: "x", params: { zz: { a: 1 } } }, registry)).toThrow(/no node "zz"/)
    expect(() => variantGraph(graph, { label: "x", params: { n4: { nope: 1 } } }, registry)).toThrow(/no parameter "nope"/)
    expect(() => variantGraph(graph, { label: "x", params: { n4: { taper: "big" } } }, registry)).toThrow(/n4\.taper/)
  })

  it("read sweeps written as text", () => {
    expect(sweepValues("0.2:0.6:5")).toEqual([0.2, 0.3, 0.4, 0.5, 0.6])
    expect(sweepValues("1, 2,4")).toEqual([1, 2, 4])
    expect(parseSweep("n5.intensity=0.2:0.6:3")).toEqual([
      { label: "intensity 0.2", params: { n5: { intensity: 0.2 } } },
      { label: "intensity 0.4", params: { n5: { intensity: 0.4 } } },
      { label: "intensity 0.6", params: { n5: { intensity: 0.6 } } }
    ])
    expect(() => parseSweep("intensity=1:2:3")).toThrow(/not a sweep/)
    expect(() => sweepValues("a:b:c")).toThrow(/not a list of numbers/)
    expect(() => sweepValues("0:1:500")).toThrow(/64/)
    expect(seedVariations(7, 3).map((v) => v.seed)).toEqual([8, 9, 10])
  })

  it("become ordinary ops when one is picked", () => {
    expect(variationOps("g1", { label: "a", seed: 9, params: { n4: { taper: 2 } } }, 7)).toEqual([
      { op: "set_params", graphId: "g1", id: "n4", params: { taper: 2 } },
      { op: "set_project", seed: 9 }
    ])
    expect(variationOps("g1", { label: "same seed", seed: 7 }, 7)).toEqual([])
  })

  it("lay pictures out in a grid with gaps", () => {
    const pixel = (v: number) => ({ width: 1, height: 1, data: new Uint8ClampedArray([v, v, v, 255]) })
    const sheet = contactSheet([pixel(1), pixel(2), pixel(3)], gridColumns(3), 1)
    expect([sheet.width, sheet.height]).toEqual([3, 3])
    expect(sheet.data[0]).toBe(1)
    expect(sheet.data[2 * 4]).toBe(2)
    expect(sheet.data[(2 * 3 + 0) * 4]).toBe(3)
    expect(sheet.data[1 * 4 + 3]).toBe(0)
  })
})

describe("graph text as input", () => {
  const graph = fire().graphs[0]
  const text = graphText(graph, registry, 7)

  it("reads back what get_graph writes, and finds nothing to change", () => {
    const nodes = parseGraphText(text, registry)
    expect(nodes).toHaveLength(graph.nodes.length)
    expect(nodes[1]).toMatchObject({ id: "n2", type: "perlin", name: "Warp noise", params: { octaves: 2, scale: 3 }, driven: { evolution: "n1.phase" } })
    expect(nodes[4].inputs).toEqual({ in: "n4.out", map: "n2.out" })
    expect(graphTextOps(graph, nodes, registry)).toEqual([])
    // The full form, with every default written out, is the same graph too.
    expect(graphTextOps(graph, parseGraphText(graphText(graph, registry, 7, "full"), registry), registry)).toEqual([])
  })

  it("turns an edited text into the smallest set of operations", () => {
    const edited = text
      .replace("intensity=0.2 tiling=clamp in<-n4 map<-n2", "intensity=0.35 in<-n4 map<-n3")
      .replace(/^n10 .*$/m, "")
      .replace('evolution<-n1.phase "Erosion noise"', '"Erosion noise" bypass')
      .concat('\nglow1  glow  radius=0.1 in<-n8 "Halo"\n')
    const ops = graphTextOps(graph, parseGraphText(edited, registry), registry)
    expect(ops).toEqual([
      { op: "remove_node", id: "n10" },
      { op: "set_node_flags", id: "n3", bypass: true },
      { op: "set_params", id: "n5", params: { intensity: 0.35, tiling: null } },
      { op: "add_node", type: "glow", id: "glow1", name: "Halo", params: { radius: 0.1 } },
      { op: "drive_param", id: "n3", param: "evolution", from: null },
      { op: "connect", from: "n3.out", to: "n5.map" },
      { op: "connect", from: "n8.out", to: "glow1.in" }
    ])
  })

  it("replaces a node whose type changed and rewires what touched it", () => {
    const edited = text.replace(/^n7 .*$/m, "n7 levels in<-n6")
    const ops = graphTextOps(graph, parseGraphText(edited, registry), registry)
    expect(ops[0]).toEqual({ op: "remove_node", id: "n7" })
    expect(ops).toContainEqual({ op: "add_node", type: "levels", id: "n7" })
    expect(ops).toContainEqual({ op: "connect", from: "n6.out", to: "n7.in" })
    expect(ops).toContainEqual({ op: "connect", from: "n7.out", to: "n8.in" })
  })

  it("builds a graph from nothing, and keeps text that looks like a number as text", () => {
    const empty = createGraph("g9", "New")
    const nodes = parseGraphText('s  anime_star  points=5\no  output  name=12 in<-s "Star out"', registry)
    expect(nodes[1].params.name).toBe("12")
    expect(graphTextOps(empty, nodes, registry)).toEqual([
      { op: "add_node", type: "anime_star", id: "s", params: { points: 5 } },
      { op: "add_node", type: "output", id: "o", name: "Star out", params: { name: "12" } },
      { op: "connect", from: "s.out", to: "o.in" }
    ])
  })

  it("says which line is wrong", () => {
    expect(() => parseGraphText("a nope", registry)).toThrow(/Line 1: there is no node type "nope"/)
    expect(() => parseGraphText("a perlin\na perlin", registry)).toThrow(/Line 2: the id "a" is used twice/)
    expect(() => parseGraphText("a perlin size=3", registry)).toThrow(/no parameter "size"/)
    expect(() => parseGraphText("a warp zz<-b", registry)).toThrow(/no input or parameter "zz"/)
    expect(() => parseGraphText('a perlin "open', registry)).toThrow(GraphTextError)
    const locked = { ...graph, nodes: graph.nodes.map((n) => (n.id === "n10" ? { ...n, locked: true } : n)) }
    expect(() => graphTextOps(locked, parseGraphText(text.replace(/^n10 .*$/m, ""), registry), registry)).toThrow(/n10 is locked/)
  })
})

describe("the tools for working together", () => {
  it("are described", () => {
    const names = TOOL_SPECS.map((t) => t.name)
    for (const name of ["list_references", "get_reference", "render_compare", "add_reference", "list_comments", "comment", "reply", "snapshot", "render_variations", "apply_text"]) expect(names).toContain(name)
    expect(TOOL_SPECS.find((t) => t.name === "render_variations")!.readOnly).toBe(true)
    expect(TOOL_SPECS.find((t) => t.name === "reply")!.readOnly).toBe(false)
  })

  it("empty projects still read", () => {
    expect(parseProject(serializeProject(createProject("x"))).references).toEqual([])
  })
})
