import { Handle, Position, useUpdateNodeInternals, type NodeProps, type Node as FlowNode } from "@xyflow/react"
import { memo, useEffect, useRef, useState, type ReactElement } from "react"
import { nodeTitle, prettyName } from "../app/commands"
import { Icon } from "../app/components/Icon"
import { session } from "../app/session"
import type { Node } from "../doc/types"
import { isDrivable, type DataType, type ResolvedNodeDef } from "../engine/nodeDef"
import type { Problem } from "../engine/validate"
import { THUMBNAIL_SIZE } from "../preview/thumbnails"
import { useEditor } from "./context"

export type CardData = {
  node: Node
  def: ResolvedNodeDef | undefined
  problems: Problem[]
  pinned: boolean
  /** Resolved type of each output, by output name. */
  outputTypes: Record<string, DataType | undefined>
}

export type CardNode = FlowNode<CardData, "vfx">

/** Handle id of a parameter socket. Image inputs use the bare input name. */
export const PARAM_HANDLE = "param:"

function Thumbnail({ nodeId, output }: { nodeId: string; output: string }): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  const { thumbnails } = useEditor()
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !thumbnails) return
    canvas.width = thumbnails.pixelSize
    canvas.height = thumbnails.pixelSize
    return thumbnails.watch(nodeId, output, canvas)
  }, [thumbnails, nodeId, output])
  return <canvas ref={ref} className="node-thumb" style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }} />
}

function format(value: unknown): string {
  if (typeof value === "number") return String(Math.round(value * 100) / 100)
  if (typeof value === "boolean") return value ? "on" : "off"
  if (typeof value === "string") return value
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) return value.map(format).join(" · ")
  return "…"
}

/** One quiet line under the thumbnail: what was changed from the defaults, and what drives the node. */
function summaryOf(node: Node, def: ResolvedNodeDef | undefined): { text: string; driver: string | null } {
  const parts: string[] = []
  for (const [name, value] of Object.entries(node.params)) {
    if (name in node.driven || def?.params[name]?.type === "gradient") continue
    parts.push(def?.params[name]?.type === "floatList" ? format(value) : `${name.replace(/_/g, " ")} ${format(value)}`)
    if (parts.length === 2) break
  }
  const drivers = Object.values(node.driven)
  return { text: parts.join("  "), driver: drivers.length > 0 ? drivers[0].split(".")[0] : null }
}

function NodeCardView({ id, data, selected }: NodeProps<CardNode>): ReactElement {
  const { node, def, problems, pinned, outputTypes } = data
  const [showParams, setShowParams] = useState(false)
  const updateInternals = useUpdateNodeInternals()

  const drivable = def ? Object.keys(def.params).filter((name) => isDrivable(def.params[name])) : []
  const paramRows = showParams ? drivable : drivable.filter((name) => name in node.driven)
  const inputs = def ? Object.entries(def.inputs) : []
  const outputs = def ? Object.keys(def.outputs) : []
  // Once a parameter is wired the full list has done its job: fold back to the driven rows.
  const drivenCount = Object.keys(node.driven).length
  useEffect(() => setShowParams(false), [drivenCount])
  // Sockets moved or changed: React Flow has to measure the handles again.
  useEffect(() => updateInternals(id), [id, paramRows.length, updateInternals])

  const imageOutput = def ? outputs.find((name) => def.outputs[name] !== "value") : undefined
  const summary = summaryOf(node, def)
  // Sockets sit on the card's edges, spread over the body below the header.
  const spread = (index: number, count: number): string => `${((index + 1) / (count + 1)) * 100}%`

  return (
    <div
      className="node-card"
      data-selected={selected || undefined}
      // A socket still waiting for a wire is marked with the dot only; real errors get the red border.
      data-error={problems.some((p) => p.code !== "missing_input") || undefined}
      data-bypass={node.bypass || undefined}
      data-pinned={pinned || undefined}
      title={problems.map((p) => p.message).join("\n") || undefined}
    >
      <header className="node-header">
        <span className="node-title">{nodeTitle(node)}</span>
        {problems.length > 0 && <span className="node-error-dot" aria-label="Error" />}
        {drivable.length > 0 && (
          <button
            className="node-header-button nodrag"
            data-on={showParams || undefined}
            title="Show parameter sockets"
            aria-label="Show parameter sockets"
            onClick={() => setShowParams((v) => !v)}
          >
            <Icon name="link" size={11} />
          </button>
        )}
        {imageOutput && (
          <button
            className="node-header-button nodrag"
            data-on={pinned || undefined}
            title="Pin to Preview (1)"
            aria-label="Pin to Preview"
            onClick={() => session.togglePin(node.id)}
          >
            <Icon name="pin" size={11} />
          </button>
        )}
      </header>

      {imageOutput ? (
        <div className="node-body">
          <Thumbnail nodeId={node.id} output={imageOutput} />
          {inputs.map(([name, input], index) => (
            <Handle
              key={name}
              type="target"
              position={Position.Left}
              id={name}
              className="socket"
              data-type={input.type}
              style={{ top: spread(index, inputs.length) }}
            >
              <span className="socket-label socket-label-in">{prettyName(name)}</span>
            </Handle>
          ))}
          {outputs.map((name, index) => (
            <Handle
              key={name}
              type="source"
              position={Position.Right}
              id={name}
              className="socket"
              data-type={outputTypes[name] ?? "color"}
              style={{ top: spread(index, outputs.length) }}
            >
              {outputs.length > 1 && <span className="socket-label socket-label-out">{prettyName(name)}</span>}
            </Handle>
          ))}
        </div>
      ) : (
        // Value nodes have no picture: one row per socket instead.
        <div className="node-rows">
          {inputs.map(([name, input]) => (
            <div key={name} className="socket-row">
              <Handle type="target" position={Position.Left} id={name} className="socket" data-type={input.type} />
              <span>{prettyName(name)}</span>
            </div>
          ))}
          {outputs.map((name) => (
            <div key={name} className="socket-row socket-row-out">
              <span>{prettyName(name)}</span>
              <Handle type="source" position={Position.Right} id={name} className="socket" data-type="value" />
            </div>
          ))}
        </div>
      )}

      {(summary.text || summary.driver) && (
        <footer className="node-summary">
          <span className="node-summary-text">{summary.text}</span>
          {summary.driver && <span className="node-summary-driver">← {summary.driver}</span>}
        </footer>
      )}

      {paramRows.length > 0 && (
        <div className="node-params">
          {paramRows.map((name) => (
            <div key={name} className="socket-row" data-driven={name in node.driven || undefined}>
              <Handle type="target" position={Position.Left} id={`${PARAM_HANDLE}${name}`} className="socket" data-type="value" />
              <span>{prettyName(name)}</span>
            </div>
          ))}
        </div>
      )}
      {!def && <div className="node-missing">Unknown type “{node.type}”</div>}
    </div>
  )
}

export const NodeCard = memo(NodeCardView)
