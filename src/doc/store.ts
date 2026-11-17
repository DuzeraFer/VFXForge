/**
 * The one document store. UI, undo/redo, MCP and file saves all change the
 * document through `apply` (docs/06 §6.1). Shaped for React's
 * `useSyncExternalStore`: `getState` returns a stable reference until a change.
 */

import { commit, EMPTY_HISTORY, redo, undo, type Author, type DocState, type Transaction } from "./history"
import type { Op } from "./ops"
import { createProject, type Project } from "./types"

export type ChangeKind = "apply" | "undo" | "redo" | "load"

export type ChangeEvent = { kind: ChangeKind; state: DocState; previous: DocState; transaction?: Transaction }

export type ApplyResult = {
  transaction: Transaction | null
  /** One entry per op: the id it created, if any. */
  created: (string | undefined)[]
}

export type DocumentStore = {
  getState: () => DocState
  subscribe: (listener: (event: ChangeEvent) => void) => () => void
  /** One atomic, undoable transaction. Throws `BatchError` if any op is invalid. */
  apply: (ops: readonly Op[], options: { label: string; author?: Author; mergeKey?: string }) => ApplyResult
  /** Moves back or forward until transaction `id` is the latest applied one (0 = before everything). */
  jumpTo: (id: number) => void
  undo: () => boolean
  redo: () => boolean
  /** Replaces the document (open / new). Clears history. */
  load: (project: Project) => void
}

export function createDocumentStore(initial: Project = createProject(), now: () => Date = () => new Date()): DocumentStore {
  let state: DocState = { project: initial, history: EMPTY_HISTORY }
  const listeners = new Set<(event: ChangeEvent) => void>()

  const set = (next: DocState, kind: ChangeKind, transaction?: Transaction): boolean => {
    if (next === state) return false
    const previous = state
    state = next
    for (const listener of [...listeners]) listener({ kind, state, previous, transaction })
    return true
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    apply(ops, options) {
      const result = commit(state, ops, { ...options, now })
      set(result.state, "apply", result.transaction ?? undefined)
      return { transaction: result.transaction, created: result.created }
    },
    undo() {
      const transaction = state.history.done.at(-1)
      return set(undo(state), "undo", transaction)
    },
    redo() {
      const transaction = state.history.undone.at(-1)
      return set(redo(state), "redo", transaction)
    },
    jumpTo(id) {
      let next = state
      while (next.history.done.length > 0 && next.history.done.at(-1)!.id > id) next = undo(next)
      while (next.history.undone.length > 0 && next.history.undone.at(-1)!.id <= id) next = redo(next)
      set(next, next.history.done.length < state.history.done.length ? "undo" : "redo")
    },
    load(project) {
      set({ project, history: EMPTY_HISTORY }, "load")
    }
  }
}
