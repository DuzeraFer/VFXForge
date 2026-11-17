import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react"
import { Engine } from "../engine/evaluator"
import { registry } from "../nodes"
import { deviceLostFailure, initGpu, type GpuContext, type GpuFailure } from "../engine/gpu"
import { PreviewPane } from "../preview/PreviewPane"
import { GraphCanvas } from "../canvas/GraphCanvas"
import { EditorContext } from "../canvas/context"
import { resolveGraph } from "../engine/validate"
import { Inspector } from "../inspector/Inspector"
import { Thumbnails } from "../preview/thumbnails"
import { playback } from "./playback"
import { serveAgents } from "../agent/bridge"
import { setAgentEngine } from "../agent/host"
import { GpuErrorScreen } from "./components/GpuErrorScreen"
import { LeftPanel } from "./components/LeftPanel"
import { Timeline } from "./components/Timeline"
import { TitleBar, type Tab } from "./components/TitleBar"
import { ToolStrip, type ToolId } from "./components/ToolStrip"
import { useDrag } from "./hooks/useDrag"
import { useTheme } from "./hooks/useTheme"
import { Toast } from "./components/Toast"
import { Settings } from "./components/Settings"
import { Variations } from "./components/Variations"
import { ExportDialog } from "./components/ExportDialog"
import { engineRef } from "./engineRef"
import { assets } from "./assetStore"
import { generation } from "../ai/generation"
import { documentTitle, session, useSession } from "./session"
import { clamp, LEFT_PANEL, PREVIEW_SPLIT, resizeBy, RIGHT_COLUMN } from "./layout"

type GpuState = { status: "starting" } | { status: "ready"; gpu: GpuContext } | { status: "failed"; failure: GpuFailure }

export function App(): ReactElement {
  const { theme, toggleTheme } = useTheme()
  const doc = useSession()
  const [activeTab, setActiveTab] = useState("document")
  const tabs: Tab[] = [
    { id: "home", title: "Home", kind: "home" },
    { id: "document", title: `${documentTitle(doc)}${doc.dirty ? " •" : ""}`, kind: "graph" }
  ]
  const activeGraph = doc.activeGraph
  const [tool, setTool] = useState<ToolId>("select")
  const agentNames = useMemo(() => doc.agent.working.map((a) => a.name), [doc.agent.working])
  const functionsRevision = registry.revision?.() ?? 0
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision stands for the project's functions
  const resolved = useMemo(() => (activeGraph ? resolveGraph(activeGraph, registry) : null), [activeGraph, functionsRevision])

  useEffect(
    () =>
      window.vfxforge?.onMenuCommand((command) => {
        if (command === "new") session.newProject()
        else if (command === "open") void session.open()
        else if (command === "save") void session.save()
        else if (command === "saveAs") void session.save(true)
        else if (command === "undo") session.undo()
        else session.redo()
      }),
    []
  )
  const [leftWidth, setLeftWidth] = useState<number>(LEFT_PANEL.initial)
  const [rightWidth, setRightWidth] = useState<number>(RIGHT_COLUMN.initial)
  const [previewSplit, setPreviewSplit] = useState<number>(PREVIEW_SPLIT.initial)
  const [timelineOpen, setTimelineOpen] = useState(true)
  const [gpuState, setGpuState] = useState<GpuState>({ status: "starting" })
  const [gpuAttempt, setGpuAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setGpuState({ status: "starting" })
    void initGpu().then((result) => {
      if (cancelled) {
        if (result.ok) result.gpu.device.destroy()
        return
      }
      if (!result.ok) {
        setGpuState({ status: "failed", failure: result.failure })
        return
      }
      setGpuState({ status: "ready", gpu: result.gpu })
      void result.gpu.device.lost.then((info) => {
        // "destroyed" is our own cleanup, not a failure.
        if (!cancelled && info.reason !== "destroyed") {
          setGpuState({ status: "failed", failure: deviceLostFailure(info) })
        }
      })
    })
    return () => {
      cancelled = true
    }
  }, [gpuAttempt])

  const gpu = gpuState.status === "ready" ? gpuState.gpu : null
  const engine = useMemo(() => (gpu ? new Engine(gpu, registry) : null), [gpu])
  useEffect(() => () => engine?.destroy(), [engine])
  // Image files of the project load in the background and show up when they arrive.
  useEffect(() => {
    assets.setEngine(engine)
    engineRef.current = engine
    return () => {
      assets.setEngine(null)
      engineRef.current = null
    }
  }, [engine])
  useEffect(() => {
    if (engine) assets.sync(doc.project, doc.path)
  }, [engine, doc.project, doc.path])
  useEffect(() => void generation.refreshStatus(), [])
  useEffect(() => {
    setAgentEngine(engine)
    // Agents are served once there is something to render with (or it is clear there never will be).
    if (gpuState.status !== "starting") serveAgents()
    return () => setAgentEngine(null)
  }, [engine, gpuState.status])
  const thumbnails = useMemo(() => (gpu && engine ? new Thumbnails(gpu, engine) : null), [gpu, engine])
  useEffect(() => () => thumbnails?.destroy(), [thumbnails])
  const editor = useMemo(() => ({ resolved, thumbnails }), [resolved, thumbnails])

  const frames = activeGraph?.settings.frames ?? 1
  const fps = activeGraph?.settings.fps ?? 12
  useEffect(() => playback.configure(frames, fps), [frames, fps])
  // Thumbnails follow the playhead without re-rendering the app every frame.
  useEffect(() => {
    if (!thumbnails) return
    const sync = (): void => thumbnails.setContext(activeGraph, doc.project.seed, playback.getState().frame)
    sync()
    return playback.subscribe(sync)
  }, [thumbnails, activeGraph, doc.project.seed])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === "v") setTool("select")
      else if (key === "h") setTool("pan")
      else if (key === "k") playback.setPlaying(!playback.getState().playing)
      else if (key === ",") playback.step(-1)
      else if (key === ".") playback.step(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const dragLeft = useDrag(
    useCallback(() => {
      const start = leftWidth
      return (dx) => setLeftWidth(resizeBy(start, dx, 1, LEFT_PANEL))
    }, [leftWidth])
  )
  const dragRight = useDrag(
    useCallback(() => {
      const start = rightWidth
      return (dx) => setRightWidth(resizeBy(start, dx, -1, RIGHT_COLUMN))
    }, [rightWidth])
  )
  const dragSplit = useDrag(
    useCallback(() => {
      const start = previewSplit
      const column = document.querySelector<HTMLElement>(".right-column")
      const height = column?.clientHeight || 1
      return (_dx, dy) => setPreviewSplit(clamp(start + dy / height, PREVIEW_SPLIT.min, PREVIEW_SPLIT.max))
    }, [previewSplit])
  )

  return (
    <div className="app">
      <TitleBar tabs={tabs} activeTab={activeTab} onSelectTab={setActiveTab} theme={theme} onToggleTheme={toggleTheme} agents={agentNames} />

      {gpuState.status === "failed" ? (
        <GpuErrorScreen failure={gpuState.failure} onRetry={() => setGpuAttempt((n) => n + 1)} />
      ) : (
        <EditorContext.Provider value={editor}>
          <div className="workspace" style={{ gridTemplateColumns: `${leftWidth}px var(--toolstrip-width) 1fr ${rightWidth}px` }}>
            <div className="left-wrap">
              <LeftPanel references={doc.project.references} graphs={doc.project.graphs} activeGraphId={doc.activeGraphId} history={doc.history} activity={doc.agent.log} />
              <div className="resize-handle resize-handle-x resize-handle-right" onPointerDown={dragLeft} />
            </div>
            <ToolStrip tool={tool} onTool={setTool} />
            {activeGraph && resolved ? (
              <GraphCanvas graph={activeGraph} resolved={resolved} selection={doc.selection} pinnedNodeId={doc.pinnedNodeId} tool={tool} agent={doc.agent} comments={doc.project.comments} />
            ) : (
              <div className="graph-canvas" />
            )}
            <div
              className="right-column"
              style={{ gridTemplateRows: `${(previewSplit * 100).toFixed(2)}% minmax(0, 1fr)` }}
            >
              <div className="resize-handle resize-handle-x resize-handle-left" onPointerDown={dragRight} />
              <div className="preview-wrap">
                <PreviewPane
                  gpu={gpu}
                  engine={engine}
                  graph={activeGraph}
                  resolved={resolved}
                  projectSeed={doc.project.seed}
                  selection={doc.selection}
                  pinnedNodeId={doc.pinnedNodeId}
                />
                <div className="resize-handle resize-handle-y" onPointerDown={dragSplit} />
              </div>
              <Inspector project={doc.project} graph={activeGraph} selection={doc.selection} problems={resolved?.problems ?? []} />
            </div>
          </div>
          <Timeline open={timelineOpen} onToggle={() => setTimelineOpen((v) => !v)} settings={activeGraph?.settings ?? null} />
          <Toast notice={doc.notice} />
          <Settings />
          <ExportDialog />
          <Variations />
        </EditorContext.Provider>
      )}
    </div>
  )
}
