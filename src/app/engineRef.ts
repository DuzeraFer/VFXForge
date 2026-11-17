import type { Engine } from "../engine/evaluator"

/** The window's engine, for code outside the React tree (export). Null until the GPU is ready. */
export const engineRef: { current: Engine | null } = { current: null }
