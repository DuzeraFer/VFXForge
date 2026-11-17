/**
 * The variation explorer (docs/05 §5.7): several versions of one image, made
 * by an agent or from the Preview, shown in a grid. Picking one applies its
 * values as a normal undoable step. The offer itself is not part of the document.
 */

import { useSyncExternalStore } from "react"
import type { Op, ParamValue } from "../doc"
import type { Rgba8Image } from "../engine/render"
import type { Variation } from "../engine/sweep"
import { session } from "./session"

export type VariationOffer = {
  /** Who made them: an agent's name, or null for the artist's own. */
  from: string | null
  graphId: string
  target: string
  note?: string
  items: { variation: Variation; image: Rgba8Image }[]
}

let offer: VariationOffer | null = null
const listeners = new Set<() => void>()
function set(next: VariationOffer | null): void {
  offer = next
  for (const listener of [...listeners]) listener()
}

export function offerVariations(next: VariationOffer): void {
  set(next)
}
export function closeVariations(): void {
  set(null)
}
export function useVariationOffer(): VariationOffer | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => offer
  )
}

/** The ops that make a variation the real thing. */
export function variationOps(graphId: string, variation: Variation, projectSeed: number): Op[] {
  const ops: Op[] = []
  for (const [id, values] of Object.entries(variation.params ?? {})) {
    const params: Record<string, ParamValue> = { ...values }
    ops.push({ op: "set_params", graphId, id, params })
  }
  if (variation.seed !== undefined && variation.seed !== projectSeed) ops.push({ op: "set_project", seed: variation.seed })
  return ops
}

/** The artist chose one: apply it and close the grid. */
export function pickVariation(index: number): void {
  const current = offer
  const item = current?.items[index]
  if (!current || !item) return
  const { project } = session.getState()
  const graph = project.graphs.find((g) => g.id === current.graphId)
  if (!graph) {
    session.say("The graph these variations were made for is gone.", true)
    set(null)
    return
  }
  // A parameter that something drives keeps following its driver unless the driver is taken off.
  const ops: Op[] = []
  for (const [id, values] of Object.entries(item.variation.params ?? {})) {
    const node = graph.nodes.find((n) => n.id === id)
    for (const param of Object.keys(values)) if (node && param in node.driven) ops.push({ op: "drive_param", graphId: graph.id, id, param, from: null })
  }
  ops.push(...variationOps(graph.id, item.variation, project.seed))
  if (ops.length === 0 || session.apply(ops, `Pick variation: ${item.variation.label}`)) {
    if (current.from) session.agentLog(current.from, `You picked "${item.variation.label}"`)
    lastPick = { label: item.variation.label, graphId: graph.id, target: current.target }
    set(null)
  }
}

let lastPick: { label: string; graphId: string; target: string } | null = null
/** What the artist last picked from a grid, for an agent that asks. */
export function lastPickedVariation(): typeof lastPick {
  return lastPick
}
