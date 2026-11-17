import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from "react"
import { exportName, exportTargets } from "../../export/render"
import { exportFromApp, loadExportSettings, saveExportSettings } from "../../export/run"
import { DEEP_FORMATS, EXPORT_FORMATS, type ExportFormat, type ExportSettings } from "../../export/types"
import { Segmented, Select, TextField } from "../../inspector/fields"
import { registry } from "../../nodes"
import { documentTitle, session, useSession } from "../session"
import { Icon } from "./Icon"

let open = false
const listeners = new Set<() => void>()
function setOpen(next: boolean): void {
  open = next
  for (const listener of [...listeners]) listener()
}

export function openExport(): void {
  setOpen(true)
}

/** Export dialog: where to, in which format, and which outputs. */
export function ExportDialog(): ReactElement | null {
  const shown = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => open
  )
  const doc = useSession()
  const [settings, setSettings] = useState<ExportSettings>(loadExportSettings)
  const [folder, setFolder] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const api = window.vfxforge

  const targets = useMemo(() => (shown ? exportTargets(doc.project, registry) : []), [shown, doc.project])
  const projectName = documentTitle(doc)

  useEffect(() => {
    if (!shown) return
    setMessage(null)
    void api?.exportLastFolder().then((last) => setFolder((current) => current ?? last))
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [shown, api])

  if (!shown) return null

  const change = (patch: Partial<ExportSettings>): void => {
    const next = { ...settings, ...patch }
    if (!DEEP_FORMATS.includes(next.format)) next.bitDepth = 8
    setSettings(next)
    saveExportSettings(next)
  }
  const key = (t: { graphId: string; nodeId: string }): string => `${t.graphId}/${t.nodeId}`
  const chosen = targets.filter((t) => !skipped.has(key(t)))

  const run = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    // Node ids repeat between graphs, so the choice is made here and passed as a whole.
    const only = chosen.length === targets.length ? undefined : chosen.map((t) => t.nodeId)
    const partial = only && new Set(chosen.map((t) => t.graphId)).size > 1
    const result = partial
      ? { ok: false as const, error: "Exporting a selection works one graph at a time for now. Select outputs of one graph, or export everything." }
      : await exportFromApp({ folder, settings, only: only && chosen.length > 0 ? [...only] : undefined, byAgent: false })
    setBusy(false)
    if (result.ok) {
      setMessage({ text: `Wrote ${result.files.length} ${result.files.length === 1 ? "texture" : "textures"}, each with its .vfxforge.json, to ${folder}.` })
      session.say(`Exported ${result.files.length} ${result.files.length === 1 ? "texture" : "textures"}.`)
    } else {
      setMessage({ text: result.error, error: true })
    }
  }

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <section className="dialog dialog-wide" role="dialog" aria-label="Export" data-testid="export-dialog">
        <header className="dialog-header">
          <span>Export</span>
          <button className="icon-button" aria-label="Close export" onClick={() => setOpen(false)}>
            <Icon name="close" size={12} />
          </button>
        </header>
        <div className="dialog-body">
          <div className="param-row">
            <span className="param-label">Folder</span>
            <span className="field field-grow field-driven" title={folder ?? undefined}>
              <span className="field-value mono" data-testid="export-folder">
                {folder ?? "Not chosen yet"}
              </span>
            </span>
            <button className="chip chip-button" onClick={() => void api?.exportChooseFolder().then((picked) => picked && setFolder(picked))}>
              Choose…
            </button>
          </div>
          <div className="param-row">
            <span className="param-label">Format</span>
            <Select value={settings.format} options={EXPORT_FORMATS} label="Format" show={(o) => o.toUpperCase()} onChange={(format) => change({ format: format as ExportFormat })} />
            <span className="param-label param-label-wide">Bits</span>
            <span data-disabled={!DEEP_FORMATS.includes(settings.format) || undefined} className="dialog-inline" title="16 bits per channel is available for PNG and TIFF">
              <Segmented value={String(settings.bitDepth)} options={["8", "16"]} label="Bits per channel" onChange={(v) => change({ bitDepth: v === "16" ? 16 : 8 })} />
            </span>
          </div>
          <div className="param-row" title="{output} is the name on the Output node, {graph} the graph's name, {project} the project's name">
            <span className="param-label">File name</span>
            <TextField value={settings.template} label="File name" onChange={(template) => change({ template: template.trim() || "{output}" })} />
          </div>
          <p className="dialog-text">
            Use {"{output}"}, {"{graph}"} and {"{project}"} in the file name. Straight or premultiplied alpha is set on each Output node. JPEG has no transparency and is flattened onto black.
          </p>

          <h3 className="dialog-section">Outputs</h3>
          {targets.length === 0 && <p className="dialog-text">This project has no Output or Sheet Output node yet.</p>}
          <ul className="export-list">
            {targets.map((t) => (
              <li key={key(t)}>
                <label className="export-row">
                  <input
                    type="checkbox"
                    checked={!skipped.has(key(t))}
                    onChange={(e) => {
                      const next = new Set(skipped)
                      if (e.target.checked) next.delete(key(t))
                      else next.add(key(t))
                      setSkipped(next)
                    }}
                  />
                  <span className="export-name mono">
                    {exportName(settings.template, t, projectName)}.{settings.format}
                  </span>
                  <span className="export-meta">
                    {t.graphName}
                    {t.sheet ? ` · sheet ${t.sheet.cols}×${t.sheet.rows}, ${t.sheet.frames} frames` : ""} · {t.alpha}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {message && (
            <p className={message.error ? "inspector-problems inspector-note" : "dialog-text dialog-ok"} data-testid="export-message">
              {message.text}
            </p>
          )}
          <div className="dialog-actions">
            <button className="chip chip-button" onClick={() => setOpen(false)}>
              Close
            </button>
            <button className="button-primary" data-testid="export-run" disabled={busy || !folder || chosen.length === 0} title={!folder ? "Choose a folder first" : undefined} onClick={() => void run()}>
              {busy ? "Exporting…" : chosen.length === targets.length ? "Export all" : `Export ${chosen.length}`}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
