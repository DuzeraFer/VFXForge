import { describe, expect, it } from "vitest"
import {
  applyOp,
  applyOps,
  BatchError,
  commit,
  createDocumentStore,
  createProject,
  EMPTY_HISTORY,
  nextId,
  OpError,
  parseProject,
  ParseError,
  redo,
  serializeProject,
  undo,
  type DocState,
  type Op,
  type Project
} from "../src/doc"

const G = "g1"
const NOW = (): Date => new Date("2026-01-01T00:00:00Z")

/** time -> perlin -> warp <- shape, perlin.evolution driven by time. */
function fireOps(): Op[] {
  return [
    { op: "add_graph", name: "fire", settings: { frames: 16 } },
    { op: "add_node", graphId: G, type: "time" },
    { op: "add_node", graphId: G, type: "perlin", params: { scale: 3 } },
    { op: "add_node", graphId: G, type: "shape" },
    { op: "add_node", graphId: G, type: "warp", params: { intensity: 0.45 } },
    { op: "drive_param", graphId: G, id: "n2", param: "evolution", from: "n1.phase" },
    { op: "connect", graphId: G, from: "n3.out", to: "n4.in" },
    { op: "connect", graphId: G, from: "n2.out", to: "n4.map" }
  ]
}

function fire(): Project {
  return applyOps(createProject("fire"), fireOps()).project
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(OpError)
    expect((error as OpError).code).toBe(code)
    return
  }
  throw new Error(`expected OpError ${code}`)
}

/** Node versions are runtime counters and are not part of document equality. */
function content(project: Project): string {
  return serializeProject(project)
}

describe("nextId", () => {
  it("counts up from the highest id in use", () => {
    expect(nextId([], "n")).toBe("n1")
    expect(nextId(["n1", "n7", "noise", "n2"], "n")).toBe("n8")
  })
})

describe("ops", () => {
  it("builds a graph and reports created ids", () => {
    const result = applyOps(createProject(), fireOps())
    expect(result.created.slice(0, 5)).toEqual(["g1", "n1", "n2", "n3", "n4"])
    const graph = result.project.graphs[0]
    expect(graph.settings.frames).toBe(16)
    expect(graph.settings.width).toBe(256)
    expect(graph.nodes.map((n) => n.type)).toEqual(["time", "perlin", "shape", "warp"])
    expect(graph.links).toEqual([
      { from: "n3.out", to: "n4.in" },
      { from: "n2.out", to: "n4.map" }
    ])
    expect(graph.nodes[1].driven).toEqual({ evolution: "n1.phase" })
  })

  it("never mutates its input", () => {
    const before = fire()
    const snapshot = JSON.stringify(before)
    applyOps(before, [
      { op: "set_params", graphId: G, id: "n2", params: { scale: 5 } },
      { op: "remove_node", graphId: G, id: "n1" },
      { op: "disconnect", graphId: G, to: "n4.map" }
    ])
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it("every op is undone exactly by its inverse", () => {
    const base = fire()
    const cases: Op[] = [
      { op: "add_graph", name: "second" },
      { op: "remove_graph", graphId: G },
      { op: "set_project", name: "renamed", seed: 7 },
      { op: "set_graph", graphId: G, name: "flames", settings: { width: 512, loop: false } },
      { op: "add_node", graphId: G, type: "band", position: [40, 80] },
      { op: "remove_node", graphId: G, id: "n1" },
      { op: "remove_node", graphId: G, id: "n4" },
      { op: "remove_node", graphId: G, id: "n2" },
      { op: "set_params", graphId: G, id: "n2", params: { scale: 5, octaves: 2 } },
      { op: "set_params", graphId: G, id: "n2", params: { scale: null } },
      { op: "connect", graphId: G, from: "n2.out", to: "n4.in" },
      { op: "connect", graphId: G, from: "n1.phase", to: "n3.size" },
      { op: "disconnect", graphId: G, to: "n4.map" },
      { op: "drive_param", graphId: G, id: "n4", param: "intensity", from: "n1.phase" },
      { op: "drive_param", graphId: G, id: "n2", param: "evolution", from: null },
      { op: "move_node", graphId: G, id: "n3", position: [8, 16] },
      { op: "rename", graphId: G, id: "n3", name: "Flame" },
      { op: "set_node_flags", graphId: G, id: "n3", locked: true, bypass: true }
    ]
    for (const op of cases) {
      const applied = applyOp(base, op)
      expect(content(applied.project), op.op).not.toBe(content(base))
      const reverted = applyOps(applied.project, applied.inverse).project
      expect(content(reverted), op.op).toBe(content(base))
    }
  })

  it("connecting to an occupied input replaces the link", () => {
    const { project } = applyOp(fire(), { op: "connect", graphId: G, from: "n2.out", to: "n4.in" })
    expect(project.graphs[0].links.filter((l) => l.to === "n4.in")).toEqual([{ from: "n2.out", to: "n4.in" }])
  })

  it("removing a node removes its links and the params it drives", () => {
    const { project } = applyOp(fire(), { op: "remove_node", graphId: G, id: "n1" })
    expect(project.graphs[0].nodes.find((n) => n.id === "n2")!.driven).toEqual({})
    const without = applyOp(fire(), { op: "remove_node", graphId: G, id: "n2" }).project
    expect(without.graphs[0].links).toEqual([{ from: "n3.out", to: "n4.in" }])
  })

  it("refuses loops, through links and through driven params", () => {
    expectCode(() => applyOp(fire(), { op: "connect", graphId: G, from: "n4.out", to: "n2.in" }), "cycle")
    expectCode(() => applyOp(fire(), { op: "connect", graphId: G, from: "n4.out", to: "n4.in" }), "cycle")
    expectCode(
      () => applyOp(fire(), { op: "drive_param", graphId: G, id: "n1", param: "speed", from: "n4.out" }),
      "cycle"
    )
  })

  it("reports bad references", () => {
    expectCode(() => applyOp(fire(), { op: "add_node", graphId: "nope", type: "x" }), "unknown_graph")
    expectCode(() => applyOp(fire(), { op: "set_params", graphId: G, id: "n99", params: {} }), "unknown_node")
    expectCode(() => applyOp(fire(), { op: "add_node", graphId: G, type: "x", id: "n1" }), "duplicate_id")
    expectCode(() => applyOp(fire(), { op: "add_node", graphId: G, type: "x", id: "a.b" }), "invalid_id")
    expectCode(() => applyOp(fire(), { op: "connect", graphId: G, from: "n2", to: "n4.in" }), "invalid_socket")
    expectCode(() => applyOp(fire(), { op: "disconnect", graphId: G, to: "n2.in" }), "no_link")
    expectCode(() => applyOp(fire(), { op: "set_graph", graphId: G, settings: { width: 0 } }), "invalid_value")
  })

  it("is all or nothing, and says which op failed", () => {
    const base = fire()
    try {
      applyOps(base, [
        { op: "set_params", graphId: G, id: "n2", params: { scale: 9 } },
        { op: "remove_node", graphId: G, id: "missing" }
      ])
      throw new Error("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(BatchError)
      expect((error as BatchError).opIndex).toBe(1)
      expect((error as BatchError).code).toBe("unknown_node")
    }
    expect(base.graphs[0].nodes[1].params.scale).toBe(3)
  })

  it("bumps node versions and checks ifVersion", () => {
    const base = fire()
    const perlin = base.graphs[0].nodes[1]
    const { project } = applyOp(base, { op: "set_params", graphId: G, id: "n2", params: { scale: 4 } })
    expect(project.graphs[0].nodes[1].version).toBe(perlin.version + 1)
    expectCode(
      () => applyOp(project, { op: "set_params", graphId: G, id: "n2", params: { scale: 5 }, ifVersion: perlin.version }),
      "version_conflict"
    )
    applyOp(project, { op: "set_params", graphId: G, id: "n2", params: { scale: 5 }, ifVersion: perlin.version + 1 })
  })

  it("locked nodes refuse agent edits but not human ones", () => {
    const locked = applyOp(fire(), { op: "set_node_flags", graphId: G, id: "n2", locked: true }).project
    const edit: Op = { op: "set_params", graphId: G, id: "n2", params: { scale: 8 } }
    expectCode(() => applyOp(locked, edit, { respectLocks: true }), "locked")
    expectCode(() => applyOp(locked, { op: "remove_node", graphId: G, id: "n2" }, { respectLocks: true }), "locked")
    expect(applyOp(locked, edit).project.graphs[0].nodes[1].params.scale).toBe(8)
  })
})

describe("history", () => {
  const start = (): DocState => ({ project: createProject("fire"), history: EMPTY_HISTORY })

  it("undoes and redoes whole transactions", () => {
    const built = commit(start(), fireOps(), { label: "Build fire", now: NOW }).state
    const edited = commit(built, [{ op: "set_params", graphId: G, id: "n4", params: { intensity: 0.6 } }], {
      label: "Stronger warp",
      now: NOW
    }).state

    const back1 = undo(edited)
    expect(content(back1.project)).toBe(content(built.project))
    const back2 = undo(back1)
    expect(back2.project.graphs).toEqual([])
    expect(undo(back2)).toBe(back2)

    const forward = redo(redo(back2))
    expect(content(forward.project)).toBe(content(edited.project))
    expect(redo(forward)).toBe(forward)
  })

  it("redo recreates the same ids", () => {
    const built = commit(start(), fireOps(), { label: "Build fire", now: NOW }).state
    const again = redo(undo(built))
    expect(again.project.graphs[0].nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4"])
  })

  it("a new edit clears the redo stack", () => {
    const built = commit(start(), fireOps(), { label: "Build fire", now: NOW }).state
    const undone = undo(built)
    const next = commit(undone, [{ op: "set_project", name: "other" }], { label: "Rename", now: NOW }).state
    expect(next.history.undone).toEqual([])
  })

  it("records label, author and time; skips no-op batches", () => {
    const author = { kind: "agent", name: "Claude" } as const
    const { state, transaction } = commit(start(), fireOps(), { label: "Build fire", author, now: NOW })
    expect(transaction).toMatchObject({ id: 1, label: "Build fire", author, timestamp: "2026-01-01T00:00:00.000Z" })
    const same = commit(state, [{ op: "connect", graphId: G, from: "n3.out", to: "n4.in" }], { label: "Nothing", now: NOW })
    expect(same.transaction).toBeNull()
    expect(same.state).toBe(state)
  })
})

describe("gesture merging", () => {
  it("folds edits with the same key into one undo step", () => {
    const store = createDocumentStore(fire(), NOW)
    const before = content(store.getState().project)
    for (const scale of [4, 5, 6]) {
      store.apply([{ op: "set_params", graphId: G, id: "n2", params: { scale } }], { label: "Scale", mergeKey: "drag-1" })
    }
    store.apply([{ op: "set_params", graphId: G, id: "n2", params: { scale: 9 } }], { label: "Scale", mergeKey: "drag-2" })
    expect(store.getState().history.done).toHaveLength(2)
    store.undo()
    expect(store.getState().project.graphs[0].nodes[1].params.scale).toBe(6)
    store.undo()
    expect(content(store.getState().project)).toBe(before)
    store.redo()
    expect(store.getState().project.graphs[0].nodes[1].params.scale).toBe(6)
  })

  it("jumps to any point in history", () => {
    const store = createDocumentStore(fire(), NOW)
    for (const scale of [4, 5, 6]) store.apply([{ op: "set_params", graphId: G, id: "n2", params: { scale } }], { label: "Scale" })
    store.jumpTo(1)
    expect(store.getState().project.graphs[0].nodes[1].params.scale).toBe(4)
    store.jumpTo(3)
    expect(store.getState().project.graphs[0].nodes[1].params.scale).toBe(6)
    store.jumpTo(0)
    expect(store.getState().project.graphs[0].nodes[1].params.scale).toBe(3)
  })
})

describe("store", () => {
  it("notifies subscribers and keeps a stable state reference", () => {
    const store = createDocumentStore(createProject(), NOW)
    const kinds: string[] = []
    const unsubscribe = store.subscribe((event) => kinds.push(event.kind))
    const first = store.getState()
    expect(store.getState()).toBe(first)

    const { created } = store.apply(fireOps(), { label: "Build fire" })
    expect(created[1]).toBe("n1")
    expect(store.undo()).toBe(true)
    expect(store.redo()).toBe(true)
    expect(store.redo()).toBe(false)
    expect(kinds).toEqual(["apply", "undo", "redo"])

    unsubscribe()
    store.undo()
    expect(kinds).toHaveLength(3)
  })

  it("leaves the document alone when a batch fails", () => {
    const store = createDocumentStore(fire(), NOW)
    const before = store.getState()
    expect(() => store.apply([{ op: "remove_node", graphId: G, id: "missing" }], { label: "Bad" })).toThrow(BatchError)
    expect(store.getState()).toBe(before)
  })
})

describe(".vfxf format", () => {
  it("round-trips", () => {
    const project = fire()
    const text = serializeProject(project)
    expect(serializeProject(parseProject(text))).toBe(text)
    expect(parseProject(text).graphs[0].nodes[3].params).toEqual({ intensity: 0.45 })
  })

  it("writes one line per node and link, keys in a fixed order", () => {
    const a = applyOps(fire(), [{ op: "set_params", graphId: G, id: "n2", params: { octaves: 2, amplitude: 1 } }]).project
    const text = serializeProject(a)
    expect(text).toContain(
      '      {"id":"n2","type":"perlin","position":[0,0],"params":{"amplitude":1,"octaves":2,"scale":3},"driven":{"evolution":"n1.phase"}}'
    )
    expect(text).toContain('      {"from":"n3.out","to":"n4.in"}')
    expect(text.endsWith("}\n")).toBe(true)
    expect(JSON.parse(text).version).toBe(1)
  })

  it("rejects broken files with the path of the problem", () => {
    const good = JSON.parse(serializeProject(fire()))
    const broken = (change: (p: any) => void): string => {
      const copy = structuredClone(good)
      change(copy)
      return JSON.stringify(copy)
    }
    expect(() => parseProject("{")).toThrow(ParseError)
    expect(() => parseProject(broken((p) => (p.version = 2)))).toThrow(/project\.version/)
    expect(() => parseProject(broken((p) => (p.graphs[0].nodes[1].id = "n1")))).toThrow(/duplicate node id/)
    expect(() => parseProject(broken((p) => p.graphs[0].links.push({ from: "n9.out", to: "n1.x" })))).toThrow(/unknown node/)
    expect(() => parseProject(broken((p) => p.graphs[0].links.push({ from: "n1.phase", to: "n4.in" })))).toThrow(/already has a link/)
    expect(() => parseProject(broken((p) => p.graphs[0].links.push({ from: "n4.out", to: "n2.in" })))).toThrow(/loop/)
    expect(() => parseProject(broken((p) => (p.graphs[0].settings.width = 0)))).toThrow(/settings\.width/)
  })
})
