/**
 * The open document: the store, where it lives on disk, and whether it has
 * unsaved changes. One per window for now (tabs for several projects are P1).
 */

import { useSyncExternalStore } from "react"
import { createDocumentStore, parseProject, serializeProject, createProject, type DocumentStore, type Project } from "../doc"

export type SessionState = {
  project: Project
  path: string | null
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  /** Graph shown in the editor and Preview. */
  activeGraphId: string | null
  /** Short message for the toast; `id` changes for every new message. */
  notice: { id: number; text: string; error?: boolean } | null
}

const AUTOSAVE_MS = 30_000

function fileName(path: string): string {
  return path.split(/[\\/]/).pop()!.replace(/\.vfxf$/i, "")
}

export class Session {
  readonly store: DocumentStore = createDocumentStore()
  private path: string | null = null
  /** The project as last saved or loaded. Dirty = the current project is a different object. */
  private saved: Project = this.store.getState().project
  private autosaved: Project = this.saved
  private activeGraphId: string | null = null
  private notice: SessionState["notice"] = null
  private noticeId = 0
  private state: SessionState
  private readonly listeners = new Set<() => void>()

  constructor() {
    this.state = this.snapshot()
    this.store.subscribe(() => this.emit())
    if (typeof window !== "undefined") window.setInterval(() => void this.autosave(), AUTOSAVE_MS)
  }

  private snapshot(): SessionState {
    const { project, history } = this.store.getState()
    const active = project.graphs.find((g) => g.id === this.activeGraphId) ?? project.graphs[0]
    return {
      project,
      path: this.path,
      dirty: project !== this.saved,
      canUndo: history.done.length > 0,
      canRedo: history.undone.length > 0,
      activeGraphId: active?.id ?? null,
      notice: this.notice
    }
  }

  private emit(): void {
    this.state = this.snapshot()
    for (const listener of [...this.listeners]) listener()
  }

  getState = (): SessionState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private say(text: string, error = false): void {
    this.notice = { id: ++this.noticeId, text, error }
    this.emit()
  }

  setActiveGraph(graphId: string): void {
    this.activeGraphId = graphId
    this.emit()
  }

  newProject(): void {
    const project = createProject()
    this.path = null
    this.saved = project
    this.autosaved = project
    this.activeGraphId = null
    this.store.load(project)
    this.emit()
  }

  /** Loads project text. Throws `ParseError` with the path of the problem if the file is broken. */
  loadText(text: string, path: string | null, recovered?: string): void {
    const project = parseProject(text)
    this.path = path
    this.saved = project
    this.autosaved = project
    this.activeGraphId = null
    this.store.load(project)
    if (recovered !== undefined) {
      try {
        // Recovered work is loaded as unsaved changes on top of the saved file.
        this.store.load(parseProject(recovered))
        this.say("Recovered unsaved changes from the last session.")
        return
      } catch {
        this.say("The auto-save was damaged and was ignored.", true)
      }
    }
    this.emit()
  }

  /** Opens the project the app was started with, if any. */
  async openStartupProject(): Promise<void> {
    try {
      const opened = await window.vfxforge?.startupProject()
      if (opened) this.loadText(opened.text, opened.path, opened.recovered)
    } catch (error) {
      this.say(`Could not open the project. ${error instanceof Error ? error.message : String(error)}`, true)
    }
  }

  async open(): Promise<void> {
    const api = window.vfxforge
    if (!api) return
    try {
      const opened = await api.openProject()
      if (opened) this.loadText(opened.text, opened.path, opened.recovered)
    } catch (error) {
      this.say(`Could not open the project. ${error instanceof Error ? error.message : String(error)}`, true)
    }
  }

  async save(saveAs = false): Promise<void> {
    const api = window.vfxforge
    if (!api) return
    const project = this.store.getState().project
    const text = serializeProject(project)
    try {
      if (this.path && !saveAs) {
        await api.saveProject(this.path, text)
      } else {
        const path = await api.saveProjectAs(text, this.path ? fileName(this.path) : project.name)
        if (!path) return
        this.path = path
      }
      this.saved = project
      this.autosaved = project
      this.say("Saved.")
    } catch (error) {
      this.say(`Could not save. ${error instanceof Error ? error.message : String(error)}`, true)
    }
  }

  private async autosave(): Promise<void> {
    const project = this.store.getState().project
    if (!this.path || project === this.saved || project === this.autosaved) return
    try {
      await window.vfxforge?.autosaveProject(this.path, serializeProject(project))
      this.autosaved = project
    } catch {
      // Auto-save is best effort; a real save reports its own errors.
    }
  }

  undo(): void {
    this.store.undo()
  }

  redo(): void {
    this.store.redo()
  }
}

export const session = new Session()
void session.openStartupProject()

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState)
}

/** Name shown on the document tab. */
export function documentTitle(state: SessionState): string {
  return state.path ? fileName(state.path) : state.project.name
}
