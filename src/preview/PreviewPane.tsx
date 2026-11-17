import { useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { nodeTitle } from "../app/commands"
import { Icon } from "../app/components/Icon"
import { usePlayback } from "../app/playback"
import { session } from "../app/session"
import type { Graph } from "../doc/types"
import type { Engine } from "../engine/evaluator"
import type { GpuContext } from "../engine/gpu"
import type { Target } from "../engine/render"
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
    if (node.type !== "output") continue
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
  const { frame } = usePlayback()
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("node")
  const [channel, setChannel] = useState<Channel>("RGBA")
  const [zoom, setZoom] = useState<Zoom>("fit")
  const [pan, setPan] = useState<[number, number]>([0, 0])
  const [tile, setTile] = useState(false)
  const [background, setBackground] = useState<Background>("Checker")

  const target = useMemo(
    () => (graph && resolved ? pickTarget(graph, resolved, mode, pinnedNodeId, selection) : null),
    [graph, resolved, mode, pinnedNodeId, selection]
  )
  const targetNode = target && graph ? graph.nodes.find((n) => n.id === target.nodeId) : undefined
  const imageWidth = graph?.settings.width ?? 1
  const imageHeight = graph?.settings.height ?? 1
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
      presenter.present(engine.evaluate(target.nodeId, target.output, frame), { channel, tile: repeats })
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
  }, [engine, presenter, graph, projectSeed, target, frame, channel, repeats, width, height])

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
        </div>
        {!target && !error && <div className="preview-empty">{graph?.nodes.length ? "Select a node with an image output." : "Nothing to show yet."}</div>}
        {error && <div className="preview-error">{error}</div>}
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
        <span className="toolbar-spacer" />
        <span className="preview-frame">
          {animated ? `frame ${String(frame + 1).padStart(2, "0")}` : "still"}
        </span>
      </div>
    </section>
  )
}
