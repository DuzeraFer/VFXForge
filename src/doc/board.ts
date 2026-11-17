/**
 * The parts of a project that are about working on it rather than what it
 * renders: the reference board, comment threads and snapshots (docs/05 §5.7).
 * Each function returns the op that makes the change, so the editor and
 * agents go through the same undoable path.
 */

import type { Op } from "./ops"
import type { CommentBox, CommentMessage, CommentThread, Gradient, GradientStop, Graph, Project, Reference, Snapshot } from "./types"

export class BoardError extends Error {}

function freshId(taken: readonly { id: string }[], prefix: string): string {
  const ids = new Set(taken.map((item) => item.id))
  for (let i = taken.length + 1; ; i++) if (!ids.has(`${prefix}${i}`)) return `${prefix}${i}`
}

const clean = (text: string, limit: number): string => text.replace(/\r\n/g, "\n").trim().slice(0, limit)

// ── References ────────────────────────────────────────────

export function addReference(project: Project, image: string, name?: string, note?: string): { op: Op; id: string } {
  const existing = project.references.find((r) => r.image === image)
  if (existing) throw new BoardError(`That picture is already on the board as ${existing.id}.`)
  const id = freshId(project.references, "ref")
  const reference: Reference = { id, image }
  if (name && clean(name, 80)) reference.name = clean(name, 80)
  if (note && clean(note, 2000)) reference.note = clean(note, 2000)
  return { op: { op: "set_references", references: [...project.references, reference] }, id }
}

export function updateReference(project: Project, id: string, patch: { name?: string; note?: string }): Op {
  if (!project.references.some((r) => r.id === id)) throw new BoardError(`There is no reference "${id}".`)
  return {
    op: "set_references",
    references: project.references.map((r) => {
      if (r.id !== id) return r
      const next: Reference = { ...r }
      for (const key of ["name", "note"] as const) {
        if (patch[key] === undefined) continue
        const text = clean(patch[key], key === "name" ? 80 : 2000)
        if (text) next[key] = text
        else delete next[key]
      }
      return next
    })
  }
}

export function removeReference(project: Project, id: string): Op {
  if (!project.references.some((r) => r.id === id)) throw new BoardError(`There is no reference "${id}".`)
  return { op: "set_references", references: project.references.filter((r) => r.id !== id) }
}

// ── Comments ──────────────────────────────────────────────

export type Speaker = { author: string; agent?: boolean }

function message(text: string, who: Speaker, now: Date): CommentMessage {
  const body = clean(text, 4000)
  if (!body) throw new BoardError("A comment needs some text.")
  return { author: who.author, text: body, timestamp: now.toISOString(), ...(who.agent ? { agent: true } : {}) }
}

/** Starts a thread on a node, or on a graph when no node is given. */
export function addComment(project: Project, where: { graphId: string; nodeId?: string }, text: string, who: Speaker, now = new Date()): { op: Op; id: string } {
  const graph = project.graphs.find((g) => g.id === where.graphId)
  if (!graph) throw new BoardError(`There is no graph "${where.graphId}".`)
  if (where.nodeId !== undefined && !graph.nodes.some((n) => n.id === where.nodeId)) throw new BoardError(`Graph "${graph.id}" has no node "${where.nodeId}".`)
  const id = freshId(project.comments, "c")
  const thread: CommentThread = { id, graphId: graph.id, ...(where.nodeId ? { nodeId: where.nodeId } : {}), messages: [message(text, who, now)] }
  return { op: { op: "set_comments", comments: [...project.comments, thread] }, id }
}

function changeThread(project: Project, id: string, change: (thread: CommentThread) => CommentThread): Op {
  if (!project.comments.some((c) => c.id === id)) throw new BoardError(`There is no comment thread "${id}".`)
  return { op: "set_comments", comments: project.comments.map((c) => (c.id === id ? change(c) : c)) }
}

/** Adds a message to a thread. Answering a resolved thread opens it again, unless `resolve` closes it. */
export function replyToComment(project: Project, id: string, text: string, who: Speaker, resolve?: boolean, now = new Date()): Op {
  return changeThread(project, id, (thread) => {
    const next: CommentThread = { ...thread, messages: [...thread.messages, message(text, who, now)] }
    if (resolve) next.resolved = true
    else delete next.resolved
    return next
  })
}

export function resolveComment(project: Project, id: string, resolved: boolean): Op {
  return changeThread(project, id, (thread) => {
    const next: CommentThread = { ...thread }
    if (resolved) next.resolved = true
    else delete next.resolved
    return next
  })
}

export function removeComment(project: Project, id: string): Op {
  if (!project.comments.some((c) => c.id === id)) throw new BoardError(`There is no comment thread "${id}".`)
  return { op: "set_comments", comments: project.comments.filter((c) => c.id !== id) }
}

/** Threads of a graph whose node still exists (a thread on a deleted node is kept in the file but not shown). */
export function threadsOf(project: Project, graphId: string, nodeId?: string): CommentThread[] {
  const graph = project.graphs.find((g) => g.id === graphId)
  if (!graph) return []
  return project.comments.filter((c) => c.graphId === graphId && (nodeId === undefined ? c.nodeId === undefined || graph.nodes.some((n) => n.id === c.nodeId) : c.nodeId === nodeId))
}

// ── Snapshots ─────────────────────────────────────────────

export const MAX_SNAPSHOTS = 40

export function addSnapshot(project: Project, shot: Omit<Snapshot, "id" | "timestamp" | "name"> & { name?: string }, now = new Date()): { op: Op; id: string } {
  const all = project.snapshots ?? []
  const id = freshId(all, "s")
  const name = clean(shot.name ?? "", 60) || `Snapshot ${all.length + 1}`
  const snapshot: Snapshot = { id, name, image: shot.image, graphId: shot.graphId, target: shot.target, frame: shot.frame, timestamp: now.toISOString(), ...(shot.by ? { by: shot.by } : {}) }
  // The oldest make room, so a long session does not fill the project with pictures.
  return { op: { op: "set_snapshots", snapshots: [...all, snapshot].slice(-MAX_SNAPSHOTS) }, id }
}

export function removeSnapshot(project: Project, id: string): Op {
  const all = project.snapshots ?? []
  if (!all.some((s) => s.id === id)) throw new BoardError(`There is no snapshot "${id}".`)
  return { op: "set_snapshots", snapshots: all.filter((s) => s.id !== id) }
}

// ── Gradients ─────────────────────────────────────────────

const PROJECT_LIBRARY = "project"

/** The gradients saved with the project, in the order they were saved. */
export function projectGradients(project: Project): Gradient[] {
  return project.gradients.flatMap((lib) => lib.gradients)
}

/** Saves a gradient under a name. A gradient of that name is replaced. */
export function saveGradient(project: Project, name: string, stops: readonly GradientStop[]): Op {
  const title = clean(name, 60)
  if (!title) throw new BoardError("Give the gradient a name.")
  if (stops.length === 0) throw new BoardError("A gradient needs at least one stop.")
  if (stops.length > 16) throw new BoardError("A gradient holds at most 16 stops.")
  const copy = stops.map((stop) => ({ ...stop, color: [...stop.color] as GradientStop["color"] }))
  const home = project.gradients.find((lib) => lib.gradients.some((g) => g.name === title)) ?? project.gradients.find((lib) => lib.id === PROJECT_LIBRARY)
  if (!home) return { op: "set_gradients", gradients: [...project.gradients, { id: PROJECT_LIBRARY, name: "This project", gradients: [{ id: "gr1", name: title, stops: copy }] }] }
  const existing = home.gradients.find((g) => g.name === title)
  const gradients = existing ? home.gradients.map((g) => (g === existing ? { ...g, stops: copy } : g)) : [...home.gradients, { id: freshId(projectGradients(project), "gr"), name: title, stops: copy }]
  return { op: "set_gradients", gradients: project.gradients.map((lib) => (lib === home ? { ...lib, gradients } : lib)) }
}

export function removeGradient(project: Project, name: string): Op {
  if (!projectGradients(project).some((g) => g.name === name)) throw new BoardError(`The project has no gradient called "${name}".`)
  return { op: "set_gradients", gradients: project.gradients.map((lib) => ({ ...lib, gradients: lib.gradients.filter((g) => g.name !== name) })).filter((lib) => lib.gradients.length > 0) }
}

// ── Frames ────────────────────────────────────────────────

/** Colors a frame can have; the names are theme tokens, not values. */
export const FRAME_COLORS = ["gray", "blue", "green", "amber", "red", "violet"] as const

/** Puts a titled frame around nodes of a graph. */
export function addFrame(graph: Graph, nodeIds: readonly string[], title: string, extra: { note?: string; color?: string } = {}): { op: Op; id: string } {
  const ids = [...new Set(nodeIds)]
  if (ids.length === 0) throw new BoardError("Select the nodes the frame should go around.")
  const missing = ids.find((id) => !graph.nodes.some((n) => n.id === id))
  if (missing !== undefined) throw new BoardError(`There is no node "${missing}" in graph "${graph.id}".`)
  if (extra.color !== undefined && !(FRAME_COLORS as readonly string[]).includes(extra.color)) throw new BoardError(`A frame's color is one of: ${FRAME_COLORS.join(", ")}.`)
  const id = freshId(graph.frames, "f")
  const note = extra.note ? clean(extra.note, 400) : ""
  const frame: CommentBox = { id, title: clean(title, 80) || "Frame", nodeIds: ids, ...(extra.color ? { color: extra.color } : {}), ...(note ? { note } : {}) }
  return { op: { op: "set_frames", graphId: graph.id, frames: [...graph.frames, frame] }, id }
}

export function updateFrame(graph: Graph, id: string, patch: { title?: string; note?: string; color?: string; nodeIds?: readonly string[] }): Op {
  const frame = graph.frames.find((f) => f.id === id)
  if (!frame) throw new BoardError(`There is no frame "${id}" in graph "${graph.id}".`)
  if (patch.color !== undefined && !(FRAME_COLORS as readonly string[]).includes(patch.color)) throw new BoardError(`A frame's color is one of: ${FRAME_COLORS.join(", ")}.`)
  const next: CommentBox = { ...frame }
  if (patch.title !== undefined) next.title = clean(patch.title, 80) || "Frame"
  if (patch.color !== undefined) next.color = patch.color
  if (patch.nodeIds !== undefined) next.nodeIds = [...new Set(patch.nodeIds)]
  if (patch.note !== undefined) {
    const note = clean(patch.note, 400)
    if (note) next.note = note
    else delete next.note
  }
  return { op: "set_frames", graphId: graph.id, frames: graph.frames.map((f) => (f === frame ? next : f)) }
}

export function removeFrame(graph: Graph, id: string): Op {
  if (!graph.frames.some((f) => f.id === id)) throw new BoardError(`There is no frame "${id}" in graph "${graph.id}".`)
  return { op: "set_frames", graphId: graph.id, frames: graph.frames.filter((f) => f.id !== id) }
}
