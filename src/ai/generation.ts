/**
 * Generating pictures for AI Image nodes. The window only asks; the main
 * process holds the key and talks to OpenAI (electron/ai.ts).
 */

import { useSyncExternalStore } from "react"
import { assets } from "../app/assetStore"
import { session } from "../app/session"
import { BatchError, type Graph, type Node } from "../doc"
import { registry } from "../nodes"
import type { AiImageRequest, AiStatus } from "./imageOptions"

export type GenerationState = {
  /** Null until the main process answered (and outside Electron). */
  status: AiStatus | null
  /** Nodes with a request in flight, by `graphId/nodeId`. */
  busy: Readonly<Record<string, true>>
  /** What went wrong the last time, by `graphId/nodeId`. */
  errors: Readonly<Record<string, string>>
}

let state: GenerationState = { status: null, busy: {}, errors: {} }
const listeners = new Set<() => void>()

function set(patch: Partial<GenerationState>): void {
  state = { ...state, ...patch }
  for (const listener of [...listeners]) listener()
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}

export const generation = {
  getState: (): GenerationState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  setStatus: (status: AiStatus): void => set({ status }),
  async refreshStatus(): Promise<AiStatus | null> {
    const status = (await window.vfxforge?.aiStatus()) ?? null
    if (status) set({ status })
    return status
  }
}

export function useGeneration(): GenerationState {
  return useSyncExternalStore(generation.subscribe, generation.getState)
}

export const generationKey = (graphId: string, nodeId: string): string => `${graphId}/${nodeId}`

/** The request an AI Image node stands for, with defaults filled in. */
export function requestOf(node: Node): AiImageRequest {
  const def = registry.get("ai_image")!
  const value = (name: string): string => String(name in node.params ? node.params[name] : def.params[name].default)
  return { prompt: value("prompt"), mode: value("mode"), size: value("size"), quality: value("quality") } as AiImageRequest
}

export type Requester = { kind: "human" } | { kind: "agent"; id: string; name: string }

/**
 * Generates the picture of one AI Image node and stores its reference on the
 * node as one undoable step. Returns null, or what went wrong in plain words.
 */
export async function generateFor(graph: Graph, nodeId: string, by: Requester): Promise<string | null> {
  const api = window.vfxforge
  const key = generationKey(graph.id, nodeId)
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node || node.type !== "ai_image") return `"${nodeId}" is not an AI Image node.`
  if (!api) return "Pictures can only be generated inside the VFXForge app."
  if (state.busy[key]) return "This node is already generating a picture."
  if (node.locked && by.kind === "agent") return `"${nodeId}" is locked by the artist.`

  set({ busy: { ...state.busy, [key]: true }, errors: without(state.errors, key) })
  // The artist sees their own failures on the node. An agent gets its answer through the tool instead.
  const fail = (error: string): string => {
    set({ busy: without(state.busy, key), errors: by.kind === "human" ? { ...state.errors, [key]: error } : state.errors })
    return error
  }
  let result
  try {
    result = await api.aiGenerate(session.getState().path, requestOf(node), by.kind === "agent" ? by.id : undefined)
  } catch {
    return fail("The picture could not be generated.")
  }
  if (!result.ok) return fail(result.error)

  assets.forget(result.ref)
  await assets.ensure(result.ref)
  const ops = [{ op: "set_params" as const, graphId: graph.id, id: nodeId, params: { image: result.ref } }]
  try {
    if (by.kind === "agent") session.agentApply(by, graph.id, ops, "Generate image", [nodeId])
    else session.store.apply(ops, { label: "Generate image" })
  } catch (error) {
    // The node went away, or was locked, while the picture was being made.
    return fail(error instanceof BatchError ? error.message : "The node changed while the picture was being generated.")
  }
  set({ busy: without(state.busy, key) })
  return null
}
