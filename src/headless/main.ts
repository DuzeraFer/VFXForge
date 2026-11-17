/**
 * Headless renderer entry: the same engine as the app, in a hidden window with
 * no UI mounted (docs/06 §6.2). The main process calls `window.vfxRunJob`.
 */

import { parseProject } from "../doc/serialize"
import type { Graph, Project } from "../doc/types"
import { Engine } from "../engine/evaluator"
import { initGpu } from "../engine/gpu"
import { compositeOver, renderFrame, renderSheet, resolveTarget, type Rgba8Image } from "../engine/render"
import { registry } from "../nodes"
import { decodeImage } from "../app/assets"
import type { Job, JobImage, JobResult } from "./jobs"

declare global {
  interface Window {
    vfxRunJob: (job: Job) => Promise<JobResult>
  }
}

let enginePromise: Promise<Engine> | null = null

function getEngine(): Promise<Engine> {
  enginePromise ??= initGpu().then((result) => {
    if (!result.ok) throw new Error(`${result.failure.message}${result.failure.detail ? ` (${result.failure.detail})` : ""}`)
    return new Engine(result.gpu, registry)
  })
  return enginePromise
}

function pickGraph(project: Project, graphId?: string): Graph {
  const graph = graphId ? project.graphs.find((g) => g.id === graphId || g.name === graphId) : project.graphs[0]
  if (!graph) throw new Error(graphId ? `No graph "${graphId}" in the project.` : "The project has no graphs.")
  return graph
}

function useGraph(engine: Engine, graph: Graph, project: Project): void {
  const { problems } = engine.setGraph(graph, project.seed)
  if (problems.length > 0) {
    throw new Error(problems.map((p) => `${graph.id}/${p.nodeId}: ${p.message}`).join("\n"))
  }
}

function toJobImage(name: string, image: Rgba8Image): JobImage {
  return { name, width: image.width, height: image.height, data: new Uint8Array(image.data.buffer) }
}

async function run(job: Job): Promise<JobImage[]> {
  const engine = await getEngine()
  const project = parseProject(job.projectText)
  for (const [ref, encoded] of Object.entries(job.assets ?? {})) {
    if (!engine.hasAsset(ref)) engine.setAsset(ref, await decodeImage(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))))
  }

  if (job.kind === "render") {
    const graph = pickGraph(project, job.graphId)
    useGraph(engine, graph, project)
    const target = resolveTarget(graph, registry, job.target)
    let image: Rgba8Image =
      job.frame === "sheet"
        ? await renderSheet(engine, target, graph.settings.frames, job.cols)
        : await renderFrame(engine, target, job.frame)
    if (job.background) image = compositeOver(image, job.background)
    return [toJobImage(graph.name, image)]
  }

  const images: JobImage[] = []
  for (const graph of project.graphs) {
    useGraph(engine, graph, project)
    for (const node of graph.nodes.filter((n) => n.type === "output")) {
      const target = resolveTarget(graph, registry, node.id)
      const name = `${graph.name}.${String(node.params.name ?? "output")}`
      images.push(toJobImage(name, await renderFrame(engine, target, 0)))
      if (graph.settings.frames > 1) {
        const mid = Math.floor(graph.settings.frames / 2)
        images.push(toJobImage(`${name}.f${mid}`, await renderFrame(engine, target, mid)))
      }
    }
  }
  return images
}

window.vfxRunJob = async (job) => {
  try {
    return { ok: true, images: await run(job) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
