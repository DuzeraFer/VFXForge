import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  NodeChangeset,
  type OnConnectStartParams
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import {
  accepts,
  addNode,
  autoAlign,
  copySelection,
  deleteNodes,
  duplicateSelection,
  setViewCenterProvider,
  paste,
  toggleBypass,
  type PendingWire
} from "../app/commands"
import { session } from "../app/session"
import { parseSocketRef, type Graph, type Op } from "../doc"
import { isDrivable, type DataType } from "../engine/nodeDef"
import type { ResolvedGraph } from "../engine/validate"
import { registry } from "../nodes"
import { NodeCard, PARAM_HANDLE, type CardNode } from "./NodeCard"
import { NodeSearch } from "./NodeSearch"

const nodeTypes = { vfx: NodeCard }

type Props = {
  graph: Graph
  resolved: ResolvedGraph
  selection: readonly string[]
  pinnedNodeId: string | null
  tool: string
}

type SearchState = { x: number; y: number; flow: [number, number]; wire: PendingWire | null }

function buildNodes(graph: Graph, resolved: ResolvedGraph, selection: readonly string[], pinned: string | null, previous: CardNode[]): CardNode[] {
  const before = new Map(previous.map((n) => [n.id, n]))
  const selected = new Set(selection)
  return graph.nodes.map((node) => {
    const def = registry.get(node.type)
    const outputTypes: Record<string, DataType | undefined> = {}
    for (const name of Object.keys(def?.outputs ?? {})) outputTypes[name] = resolved.outputTypes.get(`${node.id}.${name}`)
    return {
      // Keeping the previous object's measured size avoids a flicker on every edit.
      ...before.get(node.id),
      id: node.id,
      type: "vfx" as const,
      position: { x: node.position[0], y: node.position[1] },
      selected: selected.has(node.id),
      data: { node, def, problems: resolved.problems.filter((p) => p.nodeId === node.id), pinned: pinned === node.id, outputTypes }
    }
  })
}

function buildEdges(graph: Graph, resolved: ResolvedGraph): Edge[] {
  const edges: Edge[] = []
  const edge = (id: string, fromRef: string, target: string, targetHandle: string): void => {
    const from = parseSocketRef(fromRef)
    if (!from) return
    edges.push({
      id,
      source: from.nodeId,
      sourceHandle: from.socket,
      target,
      targetHandle,
      className: `wire wire-${resolved.outputTypes.get(fromRef) ?? "color"}`
    })
  }
  for (const link of graph.links) {
    const to = parseSocketRef(link.to)
    if (to) edge(`link:${link.to}`, link.from, to.nodeId, to.socket)
  }
  for (const node of graph.nodes) {
    for (const [param, ref] of Object.entries(node.driven)) edge(`drive:${node.id}.${param}`, ref, node.id, `${PARAM_HANDLE}${param}`)
  }
  return edges
}

function isTyping(): boolean {
  const el = document.activeElement
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable)
}

function Canvas({ graph, resolved, selection, pinnedNodeId, tool }: Props): ReactElement {
  const flow = useReactFlow()
  const wrapRef = useRef<HTMLDivElement>(null)
  const pointer = useRef({ x: 0, y: 0, inside: false })
  const pendingWire = useRef<PendingWire | null>(null)
  const [nodes, setNodes] = useState<CardNode[]>([])
  const [search, setSearch] = useState<SearchState | null>(null)
  const edges = useMemo(() => buildEdges(graph, resolved), [graph, resolved])

  useEffect(() => {
    setNodes((previous) => buildNodes(graph, resolved, selection, pinnedNodeId, previous))
  }, [graph, resolved, selection, pinnedNodeId])

  // Frame the graph when it is opened (docs/02 §2.6).
  const measured = useNodesInitialized()
  const framed = useRef<string | null>(null)
  useEffect(() => {
    // An empty graph has nothing to frame; nodes added later must not move the view.
    if (graph.nodes.length === 0) framed.current = graph.id
    if (!measured || framed.current === graph.id) return
    framed.current = graph.id
    void flow.fitView({ padding: "48px", maxZoom: 1 })
  }, [measured, graph.id, graph.nodes.length, flow])

  useEffect(() => {
    setViewCenterProvider(() => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return [0, 0]
      const center = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      return [center.x, center.y]
    })
    return () => setViewCenterProvider(null)
  }, [flow])

  // Selection is read from React Flow's own change events (clicks, box select),
  // never from its selection callback, which also echoes what we pass in.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const onNodesChange = useCallback((changes: NodeChangeset<CardNode>) => {
    // Removal goes through ops (onBeforeDelete); everything else is view state.
    const list = changes.toArray().filter((c) => c.type !== "remove")
    const next = new NodeChangeset<CardNode>(list).applyTo(nodesRef.current)
    nodesRef.current = next
    setNodes(next)
    if (list.some((c) => c.type === "select")) session.select(next.filter((n) => n.selected).map((n) => n.id))
  }, [])

  const onNodeDragStop = useCallback(
    (_event: unknown, _node: CardNode, dragged: CardNode[]) => {
      const ops: Op[] = []
      for (const moved of dragged) {
        const node = graph.nodes.find((n) => n.id === moved.id)
        const position: [number, number] = [Math.round(moved.position.x), Math.round(moved.position.y)]
        if (node && (node.position[0] !== position[0] || node.position[1] !== position[1])) {
          ops.push({ op: "move_node", graphId: graph.id, id: moved.id, position })
        }
      }
      if (ops.length > 0) session.apply(ops, ops.length === 1 ? "Move node" : `Move ${ops.length} nodes`)
    },
    [graph]
  )

  const isValidConnection = useCallback(
    (connection: Connection | Edge): boolean => {
      if (connection.source === connection.target || !connection.sourceHandle || !connection.targetHandle) return false
      const type = resolved.outputTypes.get(`${connection.source}.${connection.sourceHandle}`)
      const target = graph.nodes.find((n) => n.id === connection.target)
      const def = target && registry.get(target.type)
      if (!type || !def) return true
      if (connection.targetHandle.startsWith(PARAM_HANDLE)) {
        const schema = def.params[connection.targetHandle.slice(PARAM_HANDLE.length)]
        return type === "value" && !!schema && isDrivable(schema)
      }
      const input = def.inputs[connection.targetHandle]
      return !!input && accepts(input.type, type)
    },
    [graph, resolved]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.sourceHandle || !connection.targetHandle) return
      const from = `${connection.source}.${connection.sourceHandle}`
      if (connection.targetHandle.startsWith(PARAM_HANDLE)) {
        const param = connection.targetHandle.slice(PARAM_HANDLE.length)
        session.apply([{ op: "drive_param", graphId: graph.id, id: connection.target, param, from }], "Drive parameter")
      } else {
        session.apply([{ op: "connect", graphId: graph.id, from, to: `${connection.target}.${connection.targetHandle}` }], "Connect")
      }
    },
    [graph.id]
  )

  const onConnectStart = useCallback(
    (_event: unknown, params: OnConnectStartParams) => {
      pendingWire.current = null
      if (!params.nodeId || !params.handleId || params.handleId.startsWith(PARAM_HANDLE)) return
      const node = graph.nodes.find((n) => n.id === params.nodeId)
      const def = node && registry.get(node.type)
      if (!def) return
      const type =
        params.handleType === "source" ? resolved.outputTypes.get(`${params.nodeId}.${params.handleId}`) : def.inputs[params.handleId]?.type
      if (type) pendingWire.current = { nodeId: params.nodeId, socket: params.handleId, side: params.handleType === "source" ? "output" : "input", type }
    },
    [graph, resolved]
  )

  const closeSearch = useCallback(() => setSearch(null), [])

  const openSearch = useCallback(
    (clientX: number, clientY: number, wire: PendingWire | null) => {
      const rect = wrapRef.current!.getBoundingClientRect()
      const position = flow.screenToFlowPosition({ x: clientX, y: clientY })
      setSearch({
        x: Math.min(clientX - rect.left, rect.width - 250),
        y: Math.min(clientY - rect.top, rect.height - 300),
        flow: [position.x, position.y],
        wire
      })
    },
    [flow]
  )

  // A wire dropped on empty canvas opens the search, filtered to nodes that fit it (docs/02 §2.6).
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const wire = pendingWire.current
      pendingWire.current = null
      if (!wire || state.isValid || state.toNode) return
      const point = "changedTouches" in event ? event.changedTouches[0] : event
      openSearch(point.clientX, point.clientY, wire)
    },
    [openSearch]
  )

  const onBeforeDelete = useCallback(
    async ({ nodes: removedNodes, edges: removedEdges }: { nodes: CardNode[]; edges: Edge[] }) => {
      const gone = new Set(removedNodes.map((n) => n.id))
      const ops: Op[] = []
      for (const edge of removedEdges) {
        if (gone.has(edge.source) || gone.has(edge.target)) continue
        if (edge.id.startsWith("drive:")) {
          ops.push({ op: "drive_param", graphId: graph.id, id: edge.target, param: edge.targetHandle!.slice(PARAM_HANDLE.length), from: null })
        } else {
          ops.push({ op: "disconnect", graphId: graph.id, to: `${edge.target}.${edge.targetHandle}` })
        }
      }
      if (ops.length > 0) session.apply(ops, ops.length === 1 ? "Disconnect" : `Disconnect ${ops.length} wires`)
      if (gone.size > 0) deleteNodes([...gone])
      // The document is the source of truth; React Flow redraws from it.
      return false
    },
    [graph.id]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isTyping() || search) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const { selection: selected } = session.getState()
      if ((event.key === " " || event.key === "Tab") && !mod && pointer.current.inside) {
        event.preventDefault()
        openSearch(pointer.current.x, pointer.current.y, null)
      } else if (mod && key === "d") {
        event.preventDefault()
        duplicateSelection()
      } else if (mod && key === "c") copySelection()
      else if (mod && key === "v") paste()
      else if (mod && key === "a") {
        event.preventDefault()
        session.select(graph.nodes.map((n) => n.id))
      } else if (mod || event.altKey) return
      else if (key === "f") void flow.fitView({ padding: "48px", maxZoom: 1.5, duration: 150, nodes: selected.length > 0 ? selected.map((id) => ({ id })) : undefined })
      else if (key === "a") void flow.fitView({ padding: "48px", maxZoom: 1, duration: 150 })
      else if (key === "l") autoAlign()
      else if (key === "b") toggleBypass()
      else if (key === "1" && selected.length === 1) session.togglePin(selected[0])
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [flow, graph, openSearch, search])

  return (
    <div
      ref={wrapRef}
      className="graph-canvas"
      onPointerMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY, inside: true })}
      onPointerLeave={() => (pointer.current.inside = false)}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onBeforeDelete={onBeforeDelete}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).classList.contains("react-flow__pane")) openSearch(e.clientX, e.clientY, null)
        }}
        deleteKeyCode={["Backspace", "Delete"]}
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        selectionOnDrag={tool !== "pan"}
        panOnDrag={tool === "pan" ? true : [1, 2]}
        panOnScroll
        zoomOnDoubleClick={false}
        snapToGrid
        snapGrid={[8, 8]}
        minZoom={0.1}
        maxZoom={4}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="var(--color-grid)" />
      </ReactFlow>
      {graph.nodes.length === 0 && !search && (
        <div className="canvas-empty canvas-hint">
          <div className="canvas-empty-title">Empty graph</div>
          <div>Press Space or double-click to add a node.</div>
        </div>
      )}
      {search && (
        <NodeSearch
          x={search.x}
          y={search.y}
          wire={search.wire}
          onClose={closeSearch}
          onPick={(type) => {
            addNode(type, [search.flow[0] - (search.wire?.side === "input" ? 120 : 0), search.flow[1] - 20], search.wire)
            setSearch(null)
          }}
        />
      )}
    </div>
  )
}

export function GraphCanvas(props: Props): ReactElement {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
