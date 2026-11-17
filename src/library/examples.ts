/** The example projects that ship with VFXForge. Opening one starts a new, unsaved project from it. */

import { parseProject } from "../doc"

const files = import.meta.glob<string>("./examples/*.vfxf", { query: "?raw", import: "default", eager: true })

export type Example = { id: string; name: string; description: string; text: string }

const ORDER = ["cel_fire", "slash_swipe", "smoke_dissolve", "ring_and_bolt"]

export const examples: Example[] = Object.entries(files)
  .map(([path, text]) => {
    const project = parseProject(text)
    const id = path.replace(/^.*\//, "").replace(/\.vfxf$/, "")
    const name = project.name.replace(/_/g, " ")
    return { id, name: name.charAt(0).toUpperCase() + name.slice(1), description: project.graphs[0]?.description ?? "A looping cel-shaded flame, built node by node.", text }
  })
  .sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99) || a.name.localeCompare(b.name))
