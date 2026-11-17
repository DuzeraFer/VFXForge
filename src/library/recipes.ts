/**
 * The functions that ship with VFXForge (docs/04 §4.12): ordinary function
 * files, built from the same nodes an artist has. Using one copies it into
 * the project, where it can be opened and changed like any other function.
 */

import { parseFunctionFile, type Graph } from "../doc"

const files = import.meta.glob<string>("./functions/*.vfxfn", { query: "?raw", import: "default", eager: true })

export type Recipe = { id: string; name: string; description: string; text: string; graphs: Graph[] }

const ORDER = ["cel_fire", "cel_smoke_puff", "cel_slash", "impact_burst", "magic_ring", "cel_lightning", "dissolve_mask"]

export const recipes: Recipe[] = Object.values(files)
  .map((text) => {
    const graphs = parseFunctionFile(text)
    return { id: graphs[0].id, name: graphs[0].name, description: graphs[0].description ?? "", text, graphs }
  })
  .sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99) || a.name.localeCompare(b.name))

export function recipe(id: string): Recipe | undefined {
  return recipes.find((r) => r.id === id)
}
