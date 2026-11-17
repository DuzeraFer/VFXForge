/** Transactions and undo/redo (docs/06 §6.4). */

import { applyOps, type ApplyOptions, type Op } from "./ops"
import type { Project } from "./types"

export type Author = { kind: "human" } | { kind: "agent"; name: string; session?: string }

export type Transaction = {
  id: number
  label: string
  author: Author
  /** ISO 8601. */
  timestamp: string
  ops: Op[]
  inverse: Op[]
}

export type History = {
  /** Oldest first. The last entry is the next to undo. */
  done: Transaction[]
  /** The last entry is the next to redo. */
  undone: Transaction[]
  nextId: number
}

export type DocState = { project: Project; history: History }

export const EMPTY_HISTORY: History = { done: [], undone: [], nextId: 1 }

/** Oldest undo entries are dropped past this many. */
export const HISTORY_LIMIT = 500

export type CommitOptions = {
  label: string
  author?: Author
  /** Injected so tests and replays are deterministic. */
  now?: () => Date
}

export type CommitResult = { state: DocState; transaction: Transaction | null; created: (string | undefined)[] }

/**
 * Applies `ops` as one atomic, undoable transaction. Throws `BatchError` and
 * leaves the state untouched if any op fails. A batch that changes nothing
 * records no transaction.
 */
export function commit(state: DocState, ops: readonly Op[], options: CommitOptions): CommitResult {
  const author = options.author ?? { kind: "human" }
  const applyOptions: ApplyOptions = { respectLocks: author.kind === "agent" }
  const result = applyOps(state.project, ops, applyOptions)
  if (result.project === state.project) return { state, transaction: null, created: result.created }

  const transaction: Transaction = {
    id: state.history.nextId,
    label: options.label,
    author,
    timestamp: (options.now?.() ?? new Date()).toISOString(),
    // Generated ids are written back into the ops so that redo is exact.
    ops: ops.map((op, i) =>
      (op.op === "add_node" || op.op === "add_graph") && op.id === undefined ? { ...op, id: result.created[i] } : op
    ),
    inverse: result.inverse
  }
  const done = [...state.history.done, transaction]
  if (done.length > HISTORY_LIMIT) done.splice(0, done.length - HISTORY_LIMIT)
  return {
    state: { project: result.project, history: { done, undone: [], nextId: transaction.id + 1 } },
    transaction,
    created: result.created
  }
}

export function canUndo(state: DocState): boolean {
  return state.history.done.length > 0
}

export function canRedo(state: DocState): boolean {
  return state.history.undone.length > 0
}

/** Reverts the most recent transaction. Returns the same state if there is none. */
export function undo(state: DocState): DocState {
  const transaction = state.history.done.at(-1)
  if (!transaction) return state
  const { project } = applyOps(state.project, transaction.inverse)
  return {
    project,
    history: {
      ...state.history,
      done: state.history.done.slice(0, -1),
      undone: [...state.history.undone, transaction]
    }
  }
}

/** Re-applies the most recently undone transaction. */
export function redo(state: DocState): DocState {
  const transaction = state.history.undone.at(-1)
  if (!transaction) return state
  // Ids were fixed when the transaction first ran, so replaying gives the same document.
  const { project, inverse } = applyOps(state.project, transaction.ops)
  return {
    project,
    history: {
      ...state.history,
      done: [...state.history.done, { ...transaction, inverse }],
      undone: state.history.undone.slice(0, -1)
    }
  }
}
