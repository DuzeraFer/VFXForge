/** Export from the running app: render here, write in the main process. */

import { engineRef } from "../app/engineRef"
import { documentTitle, session } from "../app/session"
import { registry } from "../nodes"
import { renderExport } from "./render"
import { DEFAULT_EXPORT, DEEP_FORMATS, EXPORT_FORMATS, type ExportFormat, type ExportResult, type ExportSettings } from "./types"

const STORAGE_KEY = "vfxforge.export"

export function cleanSettings(raw: Partial<ExportSettings> | null | undefined): ExportSettings {
  const format = EXPORT_FORMATS.includes(raw?.format as ExportFormat) ? (raw!.format as ExportFormat) : DEFAULT_EXPORT.format
  const bitDepth = raw?.bitDepth === 16 && DEEP_FORMATS.includes(format) ? 16 : 8
  const template = typeof raw?.template === "string" && raw.template.trim() !== "" ? raw.template.trim() : DEFAULT_EXPORT.template
  return { format, bitDepth, template }
}

/** The settings of the last export on this computer. */
export function loadExportSettings(): ExportSettings {
  try {
    return cleanSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ExportSettings> | null)
  } catch {
    return DEFAULT_EXPORT
  }
}

export function saveExportSettings(settings: ExportSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Only a convenience.
  }
}

export async function exportFromApp(options: { folder: string | null; settings: ExportSettings; only?: readonly string[]; byAgent: boolean }): Promise<ExportResult> {
  const api = window.vfxforge
  const engine = engineRef.current
  if (!api) return { ok: false, error: "Exporting only works inside the VFXForge app." }
  if (!engine) return { ok: false, error: "The GPU is not ready, so nothing can be rendered right now." }
  const state = session.getState()
  try {
    const images = await renderExport(engine, state.project, registry, options.settings, documentTitle(state), options.only)
    return await api.exportWrite(options.folder, images, options.settings.format, options.byAgent, state.path)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
