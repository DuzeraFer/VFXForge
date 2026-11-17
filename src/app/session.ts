/**
 * The open document: the store, where it lives on disk, and whether it has
 * unsaved changes. One per window for now (tabs for several projects are P1).
 */

import { useSyncExternalStore } from "react"
import {
  BatchError,
  createDocumentStore,
  createGraph,
  createProject,
  parseProject,
  serializeProject,
  type Author,
  type DocumentStore,
  type Graph,
  type Op,
  type Project,
  type Transaction
} from "../doc"

export type SessionState = {
  project: Project
  path: string | null
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  /** Graph shown in the editor and Preview. */
  activeGraphId: string | null
  activeGraph: Graph | null
  /** Selected node ids in the active graph. Shared with the agent later (`get_selection`). */
  selection: readonly string[]
  /** Node kept in Preview whatever is selected. */
  pinnedNodeId: string | null
  history: { done: readonly Transaction[]; undone: readonly Transaction[] }
  /** Short message for the toast; `id` changes for every new message. */
  notice: { id: number; text: string; error?: boolean } | null
  agent: AgentState
}

/** One line of the activity log: something an agent did, in plain words. */
export type ActivityEntry = {
  id: number
  time: string
  agent: string
  text: string
  /** Set for edits: the transaction to undo, and the nodes to show. */
  transactionId?: number
  nodeIds?: string[]
  graphId?: string
  /** The edit was undone (through the log or the history). */
  reverted?: boolean
}

export type AgentState = {
  /** Agents that are connected and have not said they finished. */
  working: readonly { id: string; name: string }[]
  /** Nodes the working agents changed (node id → agent name). Cleared by `finish_working`. */
  touched: Readonly<Record<string, string>>
  /** Nodes of the latest agent edit, in the order they appeared, for the fade-in. */
  fresh: readonly string[]
  log: readonly ActivityEntry[]
}

const AUTOSAVE_MS = 30_000
const LOG_LIMIT = 200

function fileName(path: string): string {
  return path.split(/[\\/]/).pop()!.replace(/\.vfxf$/i, "")
}

export class Session {
  readonly store: DocumentStore = createDocumentStore({ ...createProject(), graphs: [createGraph("g1", "Graph 1")] })
  private path: string | null = null
  /** The project as last saved or loaded. Dirty = the current project is a different object. */
  private saved: Project = this.store.getState().project
  private autosaved: Project = this.saved
  private activeGraphId: string | null = null
  private selection: readonly string[] = []
  private pinnedNodeId: string | null = null
  private notice: SessionState["notice"] = null
  private noticeId = 0
  private agent: AgentState = { working: [], touched: {}, fresh: [], log: [] }
  private logId = 0
  /** For each agent edit: node versions right after it, to tell later whether a person changed those nodes. */
  private readonly agentEdits = new Map<number, { graphId: string; versions: Record<string, number> }>()
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
    // Drop selected or pinned nodes that no longer exist (deleted, undone, other graph).
    const ids = new Set(active?.nodes.map((n) => n.id))
    if (this.selection.some((id) => !ids.has(id))) this.selection = this.selection.filter((id) => ids.has(id))
    if (this.pinnedNodeId && !ids.has(this.pinnedNodeId)) this.pinnedNodeId = null
    return {
      project,
      path: this.path,
      dirty: project !== this.saved,
      canUndo: history.done.length > 0,
      canRedo: history.undone.length > 0,
      activeGraphId: active?.id ?? null,
      activeGraph: active ?? null,
      selection: this.selection,
      pinnedNodeId: this.pinnedNodeId,
      history,
      notice: this.notice,
      agent: this.agent
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

  say(text: string, error = false): void {
    this.notice = { id: ++this.noticeId, text, error }
    this.emit()
  }

  setActiveGraph(graphId: string): void {
    this.activeGraphId = graphId
    this.selection = []
    this.pinnedNodeId = null
    this.emit()
  }

  select(ids: readonly string[]): void {
    if (ids.length === this.selection.length && ids.every((id, i) => id === this.selection[i])) return
    this.selection = [...ids]
    this.emit()
  }

  togglePin(nodeId: string): void {
    this.pinnedNodeId = this.pinnedNodeId === nodeId ? null : nodeId
    this.emit()
  }

  /**
   * Applies a human edit as one transaction. Invalid ops are reported in a
   * toast and change nothing. Returns the ids created per op, or null on failure.
   */
  apply(ops: readonly Op[], label: string, mergeKey?: string): (string | undefined)[] | null {
    try {
      return this.store.apply(ops, { label, mergeKey }).created
    } catch (error) {
      if (error instanceof BatchError) {
        this.say(error.message, true)
        return null
      }
      throw error
    }
  }

  // ── Agents (docs/05 §5.5) ─────────────────────────────────

  private setAgent(patch: Partial<AgentState>): void {
    this.agent = { ...this.agent, ...patch }
    this.emit()
  }

  /** An agent made a call: it shows as working until it calls `finish_working`. */
  agentSeen(id: string, name: string): void {
    if (this.agent.working.some((a) => a.id === id)) return
    this.setAgent({ working: [...this.agent.working, { id, name }] })
  }

  agentLog(agent: string, text: string, edit?: { transactionId: number; nodeIds: string[]; graphId: string }): void {
    const entry: ActivityEntry = { id: ++this.logId, time: new Date().toISOString(), agent, text, ...edit }
    this.setAgent({ log: [...this.agent.log, entry].slice(-LOG_LIMIT) })
  }

  /**
   * An agent's edit: one transaction attributed to it. Locked nodes refuse the
   * change. Throws `BatchError` for the caller to report back to the agent.
   */
  agentApply(agent: { id: string; name: string }, graphId: string, ops: readonly Op[], label: string, touchedIds: readonly string[]): (string | undefined)[] {
    const author: Author = { kind: "agent", name: agent.name, session: agent.id }
    const { transaction, created } = this.store.apply(ops, { label, author })
    if (!transaction) return created
    const graph = this.store.getState().project.graphs.find((g) => g.id === graphId)
    const alive = touchedIds.filter((id) => graph?.nodes.some((n) => n.id === id))
    const versions: Record<string, number> = {}
    for (const id of alive) versions[id] = graph!.nodes.find((n) => n.id === id)!.version
    this.agentEdits.set(transaction.id, { graphId, versions })
    const touched = { ...this.agent.touched }
    for (const id of alive) touched[id] = agent.name
    this.agent = { ...this.agent, touched, fresh: alive }
    this.agentLog(agent.name, label, { transactionId: transaction.id, nodeIds: alive, graphId })
    return created
  }

  /** A new document: highlights and undo records of the old one no longer apply. The log stays. */
  private forgetAgentEdits(): void {
    this.agentEdits.clear()
    this.agent = { ...this.agent, touched: {}, fresh: [] }
  }

  agentFinish(id: string): void {
    const agent = this.agent.working.find((a) => a.id === id)
    const working = this.agent.working.filter((a) => a.id !== id)
    // Highlights stay only while someone is still working.
    this.agent = { ...this.agent, working, touched: working.length > 0 ? this.agent.touched : {}, fresh: [] }
    this.agentLog(agent?.name ?? "Agent", "Finished working")
  }

  /**
   * Undoes one agent edit in a single step, even when other edits came after
   * it. If a person changed one of its nodes since, nothing is reverted and
   * the reason is returned.
   */
  revertAgentEdit(transactionId: number): string | null {
    const { history, project } = this.store.getState()
    const transaction = history.done.find((t) => t.id === transactionId)
    if (!transaction) return "That edit is no longer in the history."
    const mark = (): void => this.setAgent({ log: this.agent.log.map((e) => (e.transactionId === transactionId ? { ...e, reverted: true } : e)) })
    if (history.done.at(-1) === transaction) {
      this.store.undo()
      mark()
      return null
    }
    const edit = this.agentEdits.get(transactionId)
    const graph = edit && project.graphs.find((g) => g.id === edit.graphId)
    if (edit && graph) {
      for (const [id, version] of Object.entries(edit.versions)) {
        const node = graph.nodes.find((n) => n.id === id)
        if (node && node.version !== version) return `"${node.name ?? node.type}" (${id}) was changed after that edit. Undo the later change first, or fix it by hand.`
      }
    }
    try {
      this.store.apply(transaction.inverse, { label: `Undo "${transaction.label}"` })
    } catch (error) {
      if (error instanceof BatchError) return `That edit cannot be undone on its own any more: ${error.message}`
      throw error
    }
    mark()
    return null
  }

  newProject(): void {
    const project = { ...createProject(), graphs: [createGraph("g1", "Graph 1")] }
    this.path = null
    this.saved = project
    this.autosaved = project
    this.activeGraphId = null
    this.selection = []
    this.forgetAgentEdits()
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
    this.forgetAgentEdits()
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
        const path = await api.saveProjectAs(text, this.path ? fileName(this.path) : project.name, this.path)
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
