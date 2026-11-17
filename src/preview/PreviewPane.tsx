import { useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { nodeTitle } from "../app/commands"
import { Icon } from "../app/components/Icon"
import { usePlayback } from "../app/playback"
import { deleteSnapshot, takeSnapshot, useAssetUrl } from "../app/board"
import { session, useSession } from "../app/session"
import { offerVariations } from "../app/variations"
import { seedVariations } from "../engine/variations"
import type { Graph } from "../doc/types"
import type { Engine } from "../engine/evaluator"
import type { GpuContext } from "../engine/gpu"
import { toRgba8 } from "../engine/evaluator"
import { measureMotion } from "../engine/measure"
import { isResultNode, type Target } from "../engine/render"
import { parseSocketRef } from "../doc/types"
import type { ResolvedGraph } from "../engine/validate"
import { registry } from "../nodes"
import { CHANNELS, createPresenter, type Channel } from "./present"

type Props = {
  gpu: GpuContext | null
  engine: Engine | null
  graph: Graph | null
  resolved: ResolvedGraph | null
  projectSeed: number
  selection: readonly string[]
  pinnedNodeId: string | null
}

type Mode = "node" | "output"
/** "fit" follows the pane; a number is screen pixels per image pixel. */
type Zoom = "fit" | number

const BACKGROUNDS = ["Checker", "Black", "Gray", "White"] as const
type Background = (typeof BACKGROUNDS)[number]

const PADDING = 12
const MAX_CANVAS = 4096

/** First image output of a node, if it has one that resolved. */
function imageTarget(graph: Graph, resolved: ResolvedGraph, nodeId: string): Target | null {
  const node = graph.nodes.find((n) => n.id === nodeId)
  const def = node && registry.get(node.type)
  if (!def) return null
  for (const output of Object.keys(def.outputs)) {
    const type = resolved.outputTypes.get(`${nodeId}.${output}`)
    if (type && type !== "value") return { nodeId, output }
  }
  return null
}

export function pickTarget(graph: Graph, resolved: ResolvedGraph, mode: Mode, pinned: string | null, selection: readonly string[]): Target | null {
  if (pinned) {
    const target = imageTarget(graph, resolved, pinned)
    if (target) return target
  }
  if (mode === "node") {
    for (const id of selection) {
      const target = imageTarget(graph, resolved, id)
      if (target) return target
    }
  }
  for (const node of graph.nodes) {
    if (!isResultNode(node.type)) continue
    const target = imageTarget(graph, resolved, node.id)
    if (target) return target
  }
  if (mode === "output") return null
  // Nothing selected and no Output yet: show the node furthest downstream.
  for (let i = resolved.order.length - 1; i >= 0; i--) {
    const target = imageTarget(graph, resolved, resolved.order[i].id)
    if (target) return target
  }
  return null
}

export function PreviewPane({ gpu, engine, graph, resolved, projectSeed, selection, pinnedNodeId }: Props): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const { frame, onion } = usePlayback()
  /** Whole sheet instead of one frame. */
  const [sheet, setSheet] = useState(false)
  /** Difference between the last frame and the first. */
  const [seam, setSeam] = useState(false)
  const [seamNote, setSeamNote] = useState("")
  /** Size of what is on screen; a sheet is larger than the graph. */
  const [shown, setShown] = useState<{ width: number; height: number } | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("node")
  const [channel, setChannel] = useState<Channel>("RGBA")
  const [zoom, setZoom] = useState<Zoom>("fit")
  const [pan, setPan] = useState<[number, number]>([0, 0])
  const [tile, setTile] = useState(false)
  const [background, setBackground] = useState<Background>("Checker")
  /** What the image is compared with: "ref:<id>" or "snap:<id>", shown right of a movable split. */
  const [compare, setCompare] = useState("")
  const [split, setSplit] = useState(0.5)
  const { project } = useSession()
  const snapshots = (project.snapshots ?? []).filter((snap) => snap.graphId === graph?.id)
  const compared = compare.startsWith("ref:") ? project.references.find((r) => r.id === compare.slice(4)) : snapshots.find((snap) => snap.id === compare.slice(5))
  const compareUrl = useAssetUrl(compared?.image)
  const comparedName = compared ? ("target" in compared ? compared.name : (compared.name ?? compared.id)) : ""

  const target = useMemo(
    () => (graph && resolved ? pickTarget(graph, resolved, mode, pinnedNodeId, selection) : null),
    [graph, resolved, mode, pinnedNodeId, selection]
  )
  const targetNode = target && graph ? graph.nodes.find((n) => n.id === target.nodeId) : undefined
  const imageWidth = shown?.width ?? graph?.settings.width ?? 1
  const imageHeight = shown?.height ?? graph?.settings.height ?? 1
  const frames = graph?.settings.frames ?? 1
  // One frame of a Sheet Output is the frame of what feeds it.
  const frameTarget = useMemo((): Target | null => {
    if (!target || !graph || targetNode?.type !== "sheet_output") return target
    const link = graph.links.find((l) => l.to === `${target.nodeId}.in`)
    const from = link && parseSocketRef(link.from)
    return from ? { nodeId: from.nodeId, output: from.socket } : target
  }, [target, graph, targetNode?.type])
  const repeats = tile ? 2 : 1

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width - PADDING * 2, height: entry.contentRect.height - PADDING * 2 })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const fitScale = Math.max(0, Math.min(box.width / (imageWidth * repeats), box.height / (imageHeight * repeats)))
  const scale = zoom === "fit" ? fitScale : zoom
  const width = Math.floor(imageWidth * repeats * scale)
  const height = Math.floor(imageHeight * repeats * scale)
  const offset = zoom === "fit" ? [0, 0] : pan

  useEffect(() => {
    if (!canvas) return
    const ratio = Math.min(window.devicePixelRatio, MAX_CANVAS / Math.max(1, width, height))
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
  }, [canvas, width, height])

  const presenter = useMemo(() => {
    if (!gpu || !canvas) return null
    try {
      return createPresenter(gpu, canvas)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [gpu, canvas])
  useEffect(() => () => presenter?.destroy(), [presenter])

  // Image files load in the background; redraw when one arrives.
  const [assetRevision, setAssetRevision] = useState(0)
  useEffect(() => engine?.onAssets(() => setAssetRevision((n) => n + 1)), [engine])
  // Functions of the project are node types; when one changes, graphs that use it render differently.
  const functionsRevision = registry.revision?.() ?? 0

  // Redraw whenever what is shown, or how, changes. The engine's cache makes
  // an unchanged image a lookup.
  useEffect(() => {
    if (!engine || !presenter || !graph) return
    let stale = false
    if (!target) {
      presenter.clear()
      setError(null)
      return
    }
    try {
      engine.setGraph(graph, projectSeed)
      const at = frameTarget ?? target
      const image = (f: number): ReturnType<Engine["evaluate"]> => engine.evaluate(at.nodeId, at.output, f)
      let main: ReturnType<Engine["evaluate"]>
      if (seam && frames > 1) {
        main = image(frames - 1)
        presenter.present(main, { tile: repeats, difference: image(0) })
      } else if (sheet) {
        main = targetNode?.type === "sheet_output" ? engine.evaluate(target.nodeId, target.output, frame) : engine.evaluateSheet(target.nodeId, target.output)
        presenter.present(main, { channel, tile: repeats })
      } else if (onion && frames > 1) {
        main = image(frame)
        presenter.presentLayers(
          [
            { image: image(frame - 1), opacity: 0.35, tint: [1, 0.45, 0.2] },
            { image: image(frame + 1), opacity: 0.35, tint: [0.3, 0.6, 1] },
            { image: main }
          ],
          { channel, tile: repeats }
        )
      } else {
        main = image(frame)
        presenter.present(main, { channel, tile: repeats })
      }
      if (main.width !== shown?.width || main.height !== shown?.height) setShown({ width: main.width, height: main.height })
      // Shader compile errors arrive late; show them when they do.
      void engine.settle().then(
        () => !stale && setError(null),
        (e: unknown) => !stale && setError(e instanceof Error ? e.message : String(e))
      )
    } catch (e) {
      presenter.clear()
      setError(e instanceof Error ? e.message : String(e))
    }
    return () => {
      stale = true
    }
  }, [engine, presenter, graph, projectSeed, target, frameTarget, targetNode?.type, frame, frames, channel, repeats, width, height, assetRevision, functionsRevision, sheet, seam, onion, shown])

  // Seam check in numbers: how big the step from the last frame to the first is, next to the other steps.
  useEffect(() => {
    setSeamNote("")
    const at = frameTarget ?? target
    if (!seam || !engine || !graph || !at || frames < 2) return
    let stale = false
    void (async () => {
      try {
        const images = []
        for (let f = 0; f < frames; f++) {
          engine.setGraph(graph, projectSeed)
          const result = engine.evaluate(at.nodeId, at.output, f)
          images.push({ width: result.width, height: result.height, data: toRgba8(await engine.readPixels(result)) })
          if (stale) return
        }
        const motion = measureMotion(images)
        const ratio = Number.isFinite(motion.loopSeamRatio) ? `${motion.loopSeamRatio}×` : "far above"
        setSeamNote(motion.frameToFrame.mean === 0 ? "nothing moves" : `seam step ${ratio} the average step`)
      } catch {
        setSeamNote("")
      }
    })()
    return () => {
      stale = true
    }
  }, [seam, engine, graph, projectSeed, frameTarget, target, frames, assetRevision, functionsRevision])

  const snapshot = async (): Promise<void> => {
    const at = frameTarget ?? target
    if (!engine || !graph || !at) return
    try {
      engine.setGraph(graph, projectSeed)
      const result = engine.evaluate(at.nodeId, at.output, frame)
      const data = toRgba8(await engine.readPixels(result))
      const id = await takeSnapshot({ width: result.width, height: result.height, data }, { graphId: graph.id, target: `${at.nodeId}.${at.output}`, frame })
      if (id) setCompare(`snap:${id}`)
    } catch (e) {
      session.say(e instanceof Error ? e.message : String(e), true)
    }
  }

  const tryVariations = async (): Promise<void> => {
    const at = frameTarget ?? target
    if (!engine || !graph || !at) return
    try {
      const items = []
      for (const variation of seedVariations(projectSeed, 8)) {
        engine.setGraph(graph, variation.seed!)
        const result = engine.evaluate(at.nodeId, at.output, frame)
        items.push({ variation, image: { width: result.width, height: result.height, data: toRgba8(await engine.readPixels(result)) } })
      }
      engine.setGraph(graph, projectSeed)
      offerVariations({ from: null, graphId: graph.id, target: `${at.nodeId}.${at.output}`, note: "The same graph with eight other seeds. Click one to use that seed.", items })
    } catch (e) {
      session.say(e instanceof Error ? e.message : String(e), true)
    }
  }

  const dragSplit = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    const box = e.currentTarget.parentElement!.getBoundingClientRect()
    const move = (event: PointerEvent): void => setSplit(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)))
    const stop = (): void => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
  }

  const zoomBy = (factor: number): void => {
    const next = Math.min(32, Math.max(0.05, scale * factor))
    setZoom(next)
  }

  const percent = `${Math.round(scale * 100)}%`
  const animated = (graph?.settings.frames ?? 1) > 1

  return (
    <section className="preview">
      <header className="preview-header">
        <span className="label">Preview</span>
        <span className="preview-target" data-testid="preview-target">
          {targetNode ? `${nodeTitle(targetNode)} · ${imageWidth}×${imageHeight}` : ""}
        </span>
        {pinnedNodeId && (
          <button className="chip chip-on" title="Unpin (1)" onClick={() => session.togglePin(pinnedNodeId)}>
            <Icon name="pin" size={11} /> Pinned
          </button>
        )}
        <span className="toolbar-spacer" />
        <div className="segmented" role="tablist" aria-label="What Preview shows">
          <button role="tab" aria-selected={mode === "node"} onClick={() => setMode("node")} title="Show the selected node">
            Node
          </button>
          <button role="tab" aria-selected={mode === "output"} onClick={() => setMode("output")} title="Always show the graph's Output">
            Output
          </button>
        </div>
      </header>

      <div
        className="preview-stage"
        ref={stageRef}
        onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.25 : 0.8)}
        onPointerDown={(e) => {
          if (zoom === "fit") return
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (zoom !== "fit" && e.buttons === 1) setPan(([x, y]) => [x + e.movementX, y + e.movementY])
        }}
        onDoubleClick={() => setZoom("fit")}
      >
        <div
          className="preview-image"
          data-background={background}
          style={{ width, height, transform: `translate(${offset[0]}px, ${offset[1]}px)`, visibility: target ? "visible" : "hidden" }}
        >
          <canvas
            ref={setCanvas}
            className="preview-canvas"
            style={{ width, height, imageRendering: scale >= 2 ? "pixelated" : "auto" }}
            data-testid="preview-canvas"
          />
          {compared && compareUrl && (
            <>
              <img
                className="preview-compare"
                src={compareUrl}
                alt={comparedName}
                draggable={false}
                style={{ clipPath: `inset(0 0 0 ${split * 100}%)`, imageRendering: scale >= 2 ? "pixelated" : "auto" }}
                data-testid="preview-compare"
              />
              <div className="preview-split" style={{ left: `${split * 100}%` }} onPointerDown={dragSplit} title="Drag to move the split" data-testid="preview-split">
                <span className="preview-split-label preview-split-now">now</span>
                <span className="preview-split-label preview-split-other">{comparedName}</span>
              </div>
            </>
          )}
        </div>
        {!target && !error && <div className="preview-empty">{graph?.nodes.length ? "Select a node with an image output." : "Nothing to show yet."}</div>}
        {error && <div className="preview-error">{error}</div>}
        <span className="preview-status" data-testid="preview-status">
          {seam && animated ? seamNote || "checking…" : sheet ? `${frames} frames` : animated ? `frame ${String(frame + 1).padStart(2, "0")}` : "still"}
        </span>
      </div>

      <div className="preview-toolbar">
        <label className="chip chip-select" title="Channels">
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} aria-label="Channels">
            {CHANNELS.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <Icon name="chevron" size={10} />
        </label>
        <span className="mono preview-zoom" data-testid="preview-zoom">
          {percent}
        </span>
        <button className="text-button" data-on={zoom === "fit" || undefined} onClick={() => setZoom("fit")}>
          Fit
        </button>
        <button
          className="text-button"
          data-on={zoom === 1 || undefined}
          onClick={() => {
            setZoom(1)
            setPan([0, 0])
          }}
          title="One image pixel per screen pixel"
        >
          1:1
        </button>
        <button className="text-button" data-on={tile || undefined} onClick={() => setTile((v) => !v)} title="Repeat 2×2 to check seams">
          Tile
        </button>
        <label className="chip chip-select" title="Background behind transparent pixels">
          <select value={background} onChange={(e) => setBackground(e.target.value as Background)} aria-label="Background">
            {BACKGROUNDS.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <Icon name="chevron" size={10} />
        </label>
        {(project.references.length > 0 || snapshots.length > 0) && (
          <label className="chip chip-select" title="Show a reference or a snapshot next to the image, with a split you can drag" data-on={compared ? true : undefined}>
            <select value={compared ? compare : ""} onChange={(e) => setCompare(e.target.value)} aria-label="Compare with" data-testid="compare-select">
              <option value="">Compare</option>
              {project.references.length > 0 && (
                <optgroup label="References">
                  {project.references.map((r) => (
                    <option key={r.id} value={`ref:${r.id}`}>
                      {r.name ?? r.id}
                    </option>
                  ))}
                </optgroup>
              )}
              {snapshots.length > 0 && (
                <optgroup label="Snapshots">
                  {snapshots.map((snap) => (
                    <option key={snap.id} value={`snap:${snap.id}`}>
                      {snap.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <Icon name="chevron" size={10} />
          </label>
        )}
        {compared && "target" in compared && (
          <button
            className="text-button"
            title="Delete this snapshot"
            onClick={() => {
              deleteSnapshot(compared.id)
              setCompare("")
            }}
          >
            Delete
          </button>
        )}
        <button className="text-button" disabled={!target} onClick={() => void snapshot()} title="Keep a picture of this image as it is now, to compare with later versions" data-testid="snapshot-button">
          Snapshot
        </button>
        <button className="text-button" disabled={!target} onClick={() => void tryVariations()} title="Show this image with eight other seeds and pick one" data-testid="variations-button">
          Seeds
        </button>
        {(animated || targetNode?.type === "sheet_output") && (
          <button
            className="text-button"
            data-on={(sheet && !seam) || undefined}
            onClick={() => {
              setSheet((v) => !v || seam)
              setSeam(false)
            }}
            title="Show every frame in one grid"
            data-testid="sheet-toggle"
          >
            Sheet
          </button>
        )}
        {animated && (
          <button
            className="text-button"
            data-on={seam || undefined}
            onClick={() => setSeam((v) => !v)}
            title="Seam check: where the last frame differs from the first, and how that step compares with the others"
            data-testid="seam-toggle"
          >
            Seam
          </button>
        )}
      </div>
    </section>
  )
}
