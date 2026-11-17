import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { graphText } from "../src/agent/graphText"
import { TOOL_SPECS } from "../src/agent/toolSpecs"
import { actionFor, comboFor, comboOf, HOTKEYS, resetHotkeys, setHotkey } from "../src/app/hotkeys"
import { frameBox } from "../src/canvas/Frames"
import {
  addFrame,
  applyOps,
  BoardError,
  createDocumentStore,
  parseProject,
  projectGradients,
  removeFrame,
  removeGradient,
  saveGradient,
  serializeProject,
  updateFrame,
  type GradientStop,
  type Project
} from "../src/doc"
import { resolveGraph } from "../src/engine/validate"
import { gradientFromSamples, sampleLine, type Rgba } from "../src/inspector/gradient"
import { sequenceLayout } from "../src/inspector/sequence"
import { registry, setProjectFunctions } from "../src/nodes"
import { applyProfile, cleanPreferences, currentProfile, getPreferences, parseProfile, setPreferences } from "../src/app/preferences"
import { examples } from "../src/library/examples"

const fire = (): Project => parseProject(readFileSync("src/library/examples/cel_fire.vfxf", "utf8"))
const human = { kind: "human" } as const
const RED: Rgba = [1, 0, 0, 1]
const YELLOW: Rgba = [1, 1, 0, 1]
const WHITE: Rgba = [1, 1, 1, 1]
const stops: GradientStop[] = [
  { position: 0, color: [0, 0, 0, 1] },
  { position: 1, color: [1, 0.5, 0, 1], hardness: 1 }
]
const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

describe("gradients saved with the project", () => {
  it("saves, replaces by name and removes, and survives a save and load", () => {
    const store = createDocumentStore(fire())
    const apply = (op: ReturnType<typeof saveGradient>): unknown => store.apply([op], { label: "Gradient", author: human })
    apply(saveGradient(store.getState().project, " Fire ", stops))
    apply(saveGradient(store.getState().project, "Smoke", [stops[0]]))
    expect(projectGradients(store.getState().project).map((g) => [g.id, g.name])).toEqual([["gr1", "Fire"], ["gr2", "Smoke"]])
    apply(saveGradient(store.getState().project, "Fire", [stops[1]]))
    expect(projectGradients(store.getState().project).map((g) => g.stops.length)).toEqual([1, 1])
    const again = parseProject(serializeProject(store.getState().project))
    expect(projectGradients(again)).toEqual(projectGradients(store.getState().project))
    apply(removeGradient(store.getState().project, "Fire"))
    apply(removeGradient(store.getState().project, "Smoke"))
    expect(store.getState().project.gradients).toEqual([])
    store.undo()
    expect(projectGradients(store.getState().project).map((g) => g.name)).toEqual(["Smoke"])
  })

  it("refuses a gradient without a name, without stops, or with broken stops", () => {
    const project = fire()
    expect(() => saveGradient(project, "  ", stops)).toThrow(BoardError)
    expect(() => saveGradient(project, "x", [])).toThrow(BoardError)
    expect(() => removeGradient(project, "nope")).toThrow(BoardError)
    expect(() => applyOps(project, [{ op: "set_gradients", gradients: [{ id: "a", name: "A", gradients: [{ id: "g", name: "G", stops: [{ position: 0 } as GradientStop] }] }] }])).toThrow(/position and a color/)
  })
})

describe("a gradient from a picture", () => {
  it("turns flat cel colors into hard steps where the color jumps", () => {
    const samples = [...Array<Rgba>(20).fill(RED), [1, 0.5, 0, 1] as Rgba, ...Array<Rgba>(22).fill(YELLOW), ...Array<Rgba>(21).fill(WHITE)]
    const made = gradientFromSamples(samples)
    expect(made.map((s) => s.color)).toEqual([RED, YELLOW, WHITE])
    expect(made.map((s) => s.hardness)).toEqual([undefined, 1, 1])
    expect(made[1].position).toBeCloseTo(21 / 64, 2)
  })

  it("turns a smooth ramp into evenly spaced soft stops", () => {
    const samples = Array.from({ length: 64 }, (_, i): Rgba => [i / 63, 0, 0, 1])
    const made = gradientFromSamples(samples, 5)
    expect(made.map((s) => s.position)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(made.every((s) => s.hardness === undefined)).toBe(true)
    expect(made[4].color[0]).toBe(1)
  })

  it("reads colors along a line across the picture", () => {
    // 4x1: black, red, green, white.
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255])
    const line = sampleLine({ width: 4, height: 1, data }, [0, 0.5], [1, 0.5], 4)
    expect(line).toEqual([[0, 0, 0, 1], [1, 0, 0, 1], [0, 1, 0, 1], [1, 1, 1, 1]])
    expect(sampleLine({ width: 4, height: 1, data }, [1, 0], [0, 0], 2)).toEqual([[1, 1, 1, 1], [0, 0, 0, 1]])
  })
})

describe("frames", () => {
  it("go around nodes, can be renamed and colored, and are undone as one step", () => {
    const store = createDocumentStore(fire())
    const graph = () => store.getState().project.graphs[0]
    const ids = graph().nodes.slice(0, 2).map((n) => n.id)
    const { op, id } = addFrame(graph(), [...ids, ids[0]], "  Noise  ", { note: "the breakup" })
    store.apply([op], { label: "Frame", author: human })
    expect(graph().frames).toEqual([{ id: "f1", title: "Noise", nodeIds: ids, note: "the breakup" }])
    store.apply([updateFrame(graph(), id, { title: "Breakup", color: "blue", note: "" })], { label: "Edit", author: human })
    expect(graph().frames[0]).toEqual({ id: "f1", title: "Breakup", nodeIds: ids, color: "blue" })
    expect(graphText(graph(), registry, 0)).toContain(`frame f1 "Breakup": ${ids.join(", ")}`)
    expect(parseProject(serializeProject(store.getState().project)).graphs[0].frames).toEqual(graph().frames)
    store.apply([removeFrame(graph(), id)], { label: "Remove", author: human })
    expect(graph().frames).toEqual([])
    store.undo()
    expect(graph().frames).toHaveLength(1)
  })

  it("lose removed nodes, and go away with their last node", () => {
    const project = fire()
    const [a, b] = project.graphs[0].nodes.map((n) => n.id)
    const framed = applyOps(project, [addFrame(project.graphs[0], [a, b], "Two").op]).project
    const one = applyOps(framed, [{ op: "remove_node", graphId: framed.graphs[0].id, id: a }])
    expect(one.project.graphs[0].frames[0].nodeIds).toEqual([b])
    const none = applyOps(one.project, [{ op: "remove_node", graphId: framed.graphs[0].id, id: b }])
    expect(none.project.graphs[0].frames).toEqual([])
    // Undoing brings the node and its frame back.
    expect(applyOps(none.project, none.inverse).project.graphs[0].frames[0].nodeIds).toEqual([b])
  })

  it("refuse unknown nodes, an empty selection and unknown colors", () => {
    const graph = fire().graphs[0]
    expect(() => addFrame(graph, [], "x")).toThrow(BoardError)
    expect(() => addFrame(graph, ["nope"], "x")).toThrow(/no node "nope"/)
    expect(() => addFrame(graph, [graph.nodes[0].id], "x", { color: "pink" })).toThrow(/color/)
    expect(() => applyOps(fire(), [{ op: "set_frames", graphId: graph.id, frames: [{ id: "f1", title: "x", nodeIds: ["nope"] }] }])).toThrow(/no node "nope"/)
  })

  it("are drawn around their nodes", () => {
    const nodes = [
      { id: "a", position: { x: 0, y: 0 }, measured: { width: 120, height: 136 } },
      { id: "b", position: { x: 200, y: 80 } },
      { id: "c", position: { x: 900, y: 900 } }
    ]
    expect(frameBox({ id: "f1", title: "t", nodeIds: ["a", "b"] }, nodes)).toEqual({ x: -24, y: -52, width: 368, height: 292 })
    expect(frameBox({ id: "f1", title: "t", nodeIds: ["gone"] }, nodes)).toBeNull()
  })
})

describe("the new nodes", () => {
  it("a reroute point passes on the type of its wire and changes nothing else", () => {
    const project = fire()
    const graph = project.graphs[0]
    const link = graph.links[0]
    const next = applyOps(project, [
      { op: "add_node", graphId: graph.id, type: "reroute", id: "r1" },
      { op: "connect", graphId: graph.id, from: link.from, to: "r1.in" },
      { op: "connect", graphId: graph.id, from: "r1.out", to: link.to }
    ]).project.graphs[0]
    const before = resolveGraph(graph, registry)
    const after = resolveGraph(next, registry)
    expect(after.problems).toEqual(before.problems)
    expect(after.outputTypes.get("r1.out")).toBe(before.outputTypes.get(link.from))
    expect(registry.get("reroute")?.passthrough).toBe(true)
  })

  it("Multi Blend takes up to six optional layers, Image Sequence plays packed frames", () => {
    const multi = registry.get("multi_blend")!
    expect(Object.keys(multi.inputs)).toEqual(["layer1", "layer2", "layer3", "layer4", "layer5", "layer6"])
    expect(Object.values(multi.inputs).every((input) => input.optional)).toBe(true)
    const sequence = registry.get("image_sequence")!
    expect(sequence.asset).toBe("file")
    expect(sequence.usesTime).toBe(true)
  })

  it("packs a sequence into a near-square sheet, scaled down only when it must be", () => {
    expect(sequenceLayout(1, 256, 256)).toEqual({ cols: 1, rows: 1, cell: [256, 256], scaled: false })
    expect(sequenceLayout(16, 256, 128)).toEqual({ cols: 4, rows: 4, cell: [256, 128], scaled: false })
    expect(sequenceLayout(10, 64, 64)).toMatchObject({ cols: 4, rows: 3 })
    const big = sequenceLayout(64, 1024, 512)
    expect(big).toEqual({ cols: 8, rows: 8, cell: [512, 256], scaled: true })
  })
})

describe("hotkeys", () => {
  it("name key presses the same way on every platform", () => {
    expect(comboOf(key("d", { ctrlKey: true }))).toBe("Mod+D")
    expect(comboOf(key("D", { metaKey: true, shiftKey: true }))).toBe("Mod+Shift+D")
    expect(comboOf(key(" "))).toBe("Space")
    expect(comboOf(key(","))).toBe(",")
    expect(comboOf(key("Shift", { shiftKey: true }))).toBeNull()
    expect(comboOf(key("F2", { altKey: true }))).toBe("Alt+F2")
  })

  it("have defaults that do not clash", () => {
    expect(new Set(HOTKEYS.map((h) => h.combo)).size).toBe(HOTKEYS.length)
    expect(actionFor(key("b"))).toBe("node.bypass")
    expect(actionFor(key("a", { ctrlKey: true }))).toBe("select.all")
    expect(actionFor(key("a"))).toBe("view.fitAll")
    expect(actionFor(key("q"))).toBeNull()
  })

  it("can be changed, refuse a key that is taken or reserved, and can be reset", () => {
    expect(setHotkey("node.bypass", "Q")).toBeNull()
    expect(actionFor(key("q"))).toBe("node.bypass")
    expect(actionFor(key("b"))).toBeNull()
    expect(setHotkey("graph.align", "Q")).toMatch(/already used by “Bypass”/)
    expect(setHotkey("graph.align", "Mod+S")).toMatch(/kept for the menu/)
    expect(comboFor("graph.align")).toBe("L")
    resetHotkeys()
    expect(actionFor(key("b"))).toBe("node.bypass")
    expect(comboFor("node.bypass")).toBe("B")
  })
})

describe("agent tools for the leftovers", () => {
  it("are listed and described", () => {
    const names = TOOL_SPECS.map((t) => t.name)
    expect(names).toContain("list_gradients")
    expect(names).toContain("sample_gradient")
    const apply = TOOL_SPECS.find((t) => t.name === "apply")!.description
    for (const op of ["add_frame", "remove_frame", "save_gradient", "remove_gradient"]) expect(apply).toContain(`"op": "${op}"`)
  })
})

describe("preferences and the settings profile", () => {
  it("keeps only what it knows", () => {
    expect(cleanPreferences({ wireStyle: "stepped", other: 1 })).toEqual({ wireStyle: "stepped" })
    expect(cleanPreferences({ wireStyle: "wavy" })).toEqual({ wireStyle: "curved" })
    expect(cleanPreferences(null)).toEqual({ wireStyle: "curved" })
  })

  it("round-trips through a profile file", () => {
    setPreferences({ wireStyle: "straight" })
    setHotkey("node.bypass", "Q")
    const text = JSON.stringify(currentProfile())
    resetHotkeys()
    setPreferences({ wireStyle: "curved" })
    expect(applyProfile(parseProfile(text))).toBe(0)
    expect(getPreferences().wireStyle).toBe("straight")
    expect(comboFor("node.bypass")).toBe("Q")
    resetHotkeys()
    setPreferences({ wireStyle: "curved" })
  })

  it("refuses other files, and leaves out hotkeys that cannot work", () => {
    expect(() => parseProfile("not json")).toThrow(/not a VFXForge settings profile/)
    expect(() => parseProfile(JSON.stringify({ version: 1, graphs: [] }))).toThrow(/not a VFXForge settings profile/)
    const profile = parseProfile(JSON.stringify({ vfxforgeProfile: 1, theme: "neon", preferences: { wireStyle: 3 }, hotkeys: { "node.bypass": "Mod+S", "graph.align": "F", "view.fitAll": "Z", "made.up": "X", "tool.pan": 7 } }))
    expect(profile.theme).toBe("dark")
    expect(profile.preferences).toEqual({ wireStyle: "curved" })
    expect(Object.keys(profile.hotkeys).sort()).toEqual(["graph.align", "node.bypass", "view.fitAll"])
    // Mod+S is reserved; F is the default of "Zoom to selection", which keeps it.
    expect(applyProfile(profile)).toBe(2)
    expect(comboFor("node.bypass")).toBe("B")
    expect(comboFor("graph.align")).toBe("L")
    expect(comboFor("view.fitAll")).toBe("Z")
    expect(actionFor(key("f"))).toBe("view.fitSelection")
    resetHotkeys()
  })

  it("a profile holds nothing but theme, preferences and hotkeys", () => {
    expect(Object.keys(currentProfile()).sort()).toEqual(["hotkeys", "preferences", "theme", "vfxforgeProfile"])
  })
})

describe("example projects", () => {
  it("ship four, each valid and without problems", () => {
    expect(examples.map((e) => e.id)).toEqual(["cel_fire", "slash_swipe", "smoke_dissolve", "ring_and_bolt"])
    for (const example of examples) {
      const project = parseProject(example.text)
      setProjectFunctions(project.graphs)
      for (const graph of project.graphs) expect(resolveGraph(graph, registry).problems, `${example.id}/${graph.id}`).toEqual([])
      expect(example.description.length, example.id).toBeGreaterThan(20)
    }
    setProjectFunctions([])
  })
})
