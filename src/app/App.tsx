import { useCallback, useEffect, useState, type ReactElement } from "react"
import { deviceLostFailure, initGpu, type GpuContext, type GpuFailure } from "../engine/gpu"
import { PreviewPane } from "../preview/PreviewPane"
import { CanvasArea } from "./components/CanvasArea"
import { GpuErrorScreen } from "./components/GpuErrorScreen"
import { Inspector } from "./components/Inspector"
import { LeftPanel } from "./components/LeftPanel"
import { Timeline } from "./components/Timeline"
import { TitleBar, type Tab } from "./components/TitleBar"
import { ToolStrip } from "./components/ToolStrip"
import { useDrag } from "./hooks/useDrag"
import { useTheme } from "./hooks/useTheme"
import { clamp, LEFT_PANEL, PREVIEW_SPLIT, resizeBy, RIGHT_COLUMN } from "./layout"

const TABS: Tab[] = [
  { id: "home", title: "Home", kind: "home" },
  { id: "untitled", title: "Untitled", kind: "graph" }
]

type GpuState = { status: "starting" } | { status: "ready"; gpu: GpuContext } | { status: "failed"; failure: GpuFailure }

export function App(): ReactElement {
  const { theme, toggleTheme } = useTheme()
  const [activeTab, setActiveTab] = useState("untitled")
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
      <TitleBar tabs={TABS} activeTab={activeTab} onSelectTab={setActiveTab} theme={theme} onToggleTheme={toggleTheme} />

      {gpuState.status === "failed" ? (
        <GpuErrorScreen failure={gpuState.failure} onRetry={() => setGpuAttempt((n) => n + 1)} />
      ) : (
        <>
          <div className="workspace" style={{ gridTemplateColumns: `${leftWidth}px var(--toolstrip-width) 1fr ${rightWidth}px` }}>
            <div className="left-wrap">
              <LeftPanel />
              <div className="resize-handle resize-handle-x resize-handle-right" onPointerDown={dragLeft} />
            </div>
            <ToolStrip />
            <CanvasArea />
            <div
              className="right-column"
              style={{ gridTemplateRows: `${(previewSplit * 100).toFixed(2)}% minmax(0, 1fr)` }}
            >
              <div className="resize-handle resize-handle-x resize-handle-left" onPointerDown={dragRight} />
              <div className="preview-wrap">
                <PreviewPane gpu={gpuState.status === "ready" ? gpuState.gpu : null} />
                <div className="resize-handle resize-handle-y" onPointerDown={dragSplit} />
              </div>
              <Inspector />
            </div>
          </div>
          <Timeline open={timelineOpen} onToggle={() => setTimelineOpen((v) => !v)} />
        </>
      )}
    </div>
  )
}
