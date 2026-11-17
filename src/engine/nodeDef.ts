/**
 * Node definition API (docs/06 §6.5). A node is one module: typed sockets, a
 * parameter schema, a doc string, and either a WGSL body (pixel nodes) or an
 * `evaluate` function (value nodes). The inspector, `list_node_types`,
 * validation and the engine all read this one schema.
 */

import type { GradientStop, Graph, ParamValue } from "../doc/types"

/** What flows through a wire. */
export type DataType = "gray" | "color" | "value"

/** `image` accepts gray or color. */
export type InputType = DataType | "image"

/**
 * `same:<input>` takes the type of what is connected to that input (color if nothing is).
 * `param:<name>` takes it from an enum parameter whose options are "gray" and "color".
 */
export type OutputType = DataType | `same:${string}` | `param:${string}`

export type InputDef = { type: InputType; optional?: boolean; doc?: string }

export type ParamSchema =
  | { type: "float"; default: number; min?: number; max?: number; softMin?: number; softMax?: number; doc?: string }
  | { type: "int"; default: number; min?: number; max?: number; softMin?: number; softMax?: number; doc?: string }
  /** Degrees in the document and UI, radians in WGSL. */
  | { type: "angle"; default: number; doc?: string }
  | { type: "bool"; default: boolean; doc?: string }
  | { type: "enum"; default: string; options: readonly string[]; doc?: string }
  | { type: "vec2"; default: [number, number]; min?: number; max?: number; doc?: string }
  /** RGBA, each 0–1, as displayed (no color-space conversion in the engine). */
  | { type: "color"; default: [number, number, number, number]; doc?: string }
  | { type: "floatList"; default: number[]; maxLength: number; min?: number; max?: number; doc?: string }
  | { type: "gradient"; default: GradientStop[]; doc?: string }
  /** multiline: edited in a text box of several lines (code, prompts). */
  | { type: "string"; default: string; multiline?: boolean; doc?: string }

export type ParamType = ParamSchema["type"]

export const MAX_GRADIENT_STOPS = 16

/** What an `evaluate` node sees. */
export type EvalContext = {
  params: Record<string, ParamValue>
  /** Connected value inputs. Unconnected ones are absent. */
  inputs: Record<string, number>
  frame: number
  frames: number
  fps: number
  /** frame / frames, in [0, 1). */
  phase: number
}

/** One cell of a sheet: which input to draw, at which frame, with which offset added to the project seed. */
export type SheetCell = { input: string; frame: number; seed: number }

/** How an `assemble` node lays out its cells. Every cell is one graph-sized image plus `padding` on each side. */
export type SheetPlan = {
  cols: number
  /** Pixels of gutter around every cell. */
  padding: number
  /** Pixels by which colors are bled outwards under transparent pixels and into the gutter (0 = off). */
  dilate: number
  cells: SheetCell[]
}

export type AssembleContext = {
  params: Record<string, ParamValue>
  /** Names of the inputs that have a wire, in definition order. */
  connected: string[]
  frame: number
  frames: number
}

export type NodeDef = {
  type: string
  category: string
  /** One or two sentences. The agent reads this through `list_node_types`. */
  doc: string
  inputs: Record<string, InputType | InputDef>
  outputs: Record<string, OutputType>
  params: Record<string, ParamSchema>
  /** Adds a `seed` offset parameter and gives the shader `G.seed`. */
  seeded?: boolean
  /** The shader reads `G.phase` / `G.frame`, so the result changes per frame. */
  usesTime?: boolean
  /**
   * Name of a string parameter that holds an image file of the project
   * (docs/06 §6.11), e.g. "ai/0123456789abcdef.png". The shader reads it with
   * `sample_asset(uv)` and `has_asset`; until the file is loaded it reads as
   * transparent black.
   */
  asset?: string
  /**
   * Pixel node body. Must define `fn node(uv: vec2f) -> vec4f`. It can read
   * `P.<param>`, `G` (globals), `sample_<input>(uv)`, `has_<input>`, `gray_<input>`
   * (the wire carries a gray image, so only .r is kept on a `same:` output) and, for
   * multi-output nodes, the constant `OUT` (output index).
   *
   * In WGSL, bool and enum parameters are `u32` (enum = index of the option),
   * angles are radians, a floatList `x` is read with `P_x(i)` / `P.x_count`,
   * and a gradient `x` with `gradient_x(t)`.
   */
  wgsl?: string
  /**
   * Name of a string parameter whose text is WGSL written by the artist or the
   * agent. It replaces the code marker (CODE_MARKER) in `wgsl`, so the shader is
   * rebuilt when the text changes. A text that does not compile is reported
   * as a problem of the node, like any other shader error.
   */
  code?: string
  /** Checks that go beyond one parameter's type, e.g. a formula that does not parse. Returns what is wrong, or null. */
  check?: (params: Record<string, ParamValue>) => string | null
  /**
   * The node adds nothing to the pixels: its output is its first connected
   * input, at that input's size (an Output after a sheet stays a sheet).
   */
  passthrough?: boolean
  /** Value node body: returns one number per output. */
  evaluate?: (ctx: EvalContext) => Record<string, number>
  /**
   * Sheet node body: the engine draws its inputs into a grid, each cell at
   * the frame and seed the plan asks for. This is how one node sees a whole
   * animation (Sheet Output) or several seeds (Random Flipbook).
   */
  assemble?: (ctx: AssembleContext) => SheetPlan
}

/** How a function's node maps onto the graph it stands for. */
export type FunctionBinding = {
  graph: Graph
  /** Input name -> id of the Graph Input node inside. */
  inputs: Record<string, string>
  /** Output name -> id of the Output node inside. */
  outputs: Record<string, string>
  /** Parameter name -> the node and parameter inside that it sets. */
  params: Record<string, { nodeId: string; param: string }>
}

export type ResolvedNodeDef = Omit<NodeDef, "inputs"> & {
  inputs: Record<string, InputDef>
  /** Set on node types made from a function graph. Such a node has no shader of its own: the engine puts the function's nodes in its place. */
  fn?: FunctionBinding
}

/** Where a node's own code goes inside its shader. */
export const CODE_MARKER = "/*CODE*/"

const NAME = /^[a-z][a-z0-9_]*$/
/** Names the engine generates around a node body. */
const RESERVED_PARAMS = new Set(["tiling"])

/** Parameter names that would not compile as members of the shader's Params struct. */
const WGSL_WORDS = new Set(["type", "from", "of", "set", "self", "target", "use", "filter", "sample", "active", "common", "smooth", "ref", "new", "move", "match", "final", "get", "with", "where", "loop", "var", "let", "fn", "if", "else", "for", "while", "return", "switch", "case", "default", "struct", "const", "true", "false", "break", "continue", "discard", "enable", "alias", "override", "do", "enum", "export", "import", "static", "super", "this", "using", "public", "private", "module", "macro", "layout", "inline", "handle", "mat", "premerge", "regardless", "unless", "precise", "meta", "cast", "std", "wgsl"])

export const TILING_MODES = ["tile", "clamp", "mirror"] as const
export type TilingMode = (typeof TILING_MODES)[number]

/** Checks a definition once, at load, and fills in the common parameters. */
export function defineNode(def: NodeDef): ResolvedNodeDef {
  const where = `node "${def.type}"`
  if (!NAME.test(def.type)) throw new Error(`${where}: type must be snake_case.`)
  if (!def.doc.trim()) throw new Error(`${where}: missing doc string.`)
  if ([def.wgsl, def.evaluate, def.assemble].filter(Boolean).length !== 1) throw new Error(`${where}: needs exactly one of wgsl, evaluate or assemble.`)
  if (Object.keys(def.outputs).length === 0) throw new Error(`${where}: needs at least one output.`)

  const inputs: Record<string, InputDef> = {}
  for (const [name, input] of Object.entries(def.inputs)) {
    if (!NAME.test(name)) throw new Error(`${where}: input "${name}" must be snake_case.`)
    inputs[name] = typeof input === "string" ? { type: input } : input
  }

  for (const [name, type] of Object.entries(def.outputs)) {
    if (!NAME.test(name)) throw new Error(`${where}: output "${name}" must be snake_case.`)
    if (type.startsWith("same:")) {
      const source = inputs[type.slice(5)]
      if (!source || source.type === "value") throw new Error(`${where}: output "${name}" refers to a missing image input.`)
    }
    if (type.startsWith("param:")) {
      const schema = def.params[type.slice(6)]
      if (!schema || schema.type !== "enum" || schema.options.some((o) => o !== "gray" && o !== "color")) {
        throw new Error(`${where}: output "${name}" refers to a parameter that is not a gray/color choice.`)
      }
    }
    if (def.evaluate && type !== "value") throw new Error(`${where}: evaluate nodes can only output values.`)
    if (!def.evaluate && type === "value") throw new Error(`${where}: only evaluate nodes can output values.`)
  }

  const params: Record<string, ParamSchema> = {}
  for (const [name, schema] of Object.entries(def.params)) {
    if (!NAME.test(name)) throw new Error(`${where}: parameter "${name}" must be snake_case.`)
    if (name in inputs) throw new Error(`${where}: "${name}" is both an input and a parameter.`)
    if (def.wgsl && WGSL_WORDS.has(name)) throw new Error(`${where}: "${name}" is a word of the shader language and cannot be a parameter name.`)
    if (RESERVED_PARAMS.has(name) || (name === "seed" && def.seeded)) {
      throw new Error(`${where}: parameter "${name}" is added by the engine.`)
    }
    const problem = checkParam(schema, schema.default as ParamValue)
    if (problem) throw new Error(`${where}: default of "${name}" ${problem}.`)
    params[name] = schema
  }

  if (def.asset !== undefined) {
    if (!def.wgsl) throw new Error(`${where}: only pixel nodes can read an image file.`)
    if (params[def.asset]?.type !== "string") throw new Error(`${where}: asset "${def.asset}" must be a string parameter.`)
    if ("asset" in inputs) throw new Error(`${where}: "asset" cannot be an input name on a node that reads an image file.`)
  }

  if (def.code !== undefined) {
    if (!def.wgsl || !def.wgsl.includes(CODE_MARKER)) throw new Error(`${where}: a node with code needs wgsl that contains ${CODE_MARKER}.`)
    if (params[def.code]?.type !== "string") throw new Error(`${where}: code "${def.code}" must be a string parameter.`)
  }

  const valueInputs = Object.values(inputs).filter((i) => i.type === "value").length
  if (def.assemble && Object.keys(def.outputs).length !== 1) throw new Error(`${where}: assemble nodes have exactly one output.`)
  if (!def.evaluate && valueInputs > 0) throw new Error(`${where}: pixel nodes take values through driven parameters, not inputs.`)
  if (def.evaluate && valueInputs !== Object.keys(inputs).length) throw new Error(`${where}: evaluate nodes can only take value inputs.`)

  if (def.wgsl) {
    if (!/fn\s+node\s*\(/.test(def.wgsl)) throw new Error(`${where}: wgsl must define fn node(uv: vec2f) -> vec4f.`)
    if (def.asset !== undefined || Object.values(inputs).some((i) => i.type !== "value")) {
      params.tiling = { type: "enum", default: "tile", options: TILING_MODES, doc: "How inputs are sampled outside 0–1." }
    }
    if (def.seeded) params.seed = { type: "int", default: 0, doc: "Offset added to the project seed." }
  }

  return { ...def, inputs, params }
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function rangeProblem(value: number, schema: { min?: number; max?: number }): string | null {
  if (schema.min !== undefined && value < schema.min) return `must be at least ${schema.min}`
  if (schema.max !== undefined && value > schema.max) return `must be at most ${schema.max}`
  return null
}

/** Returns what is wrong with `value` for this schema, or null. Hard range enforced, soft range is UI only. */
export function checkParam(schema: ParamSchema, value: ParamValue): string | null {
  switch (schema.type) {
    case "float":
      return isNumber(value) ? rangeProblem(value, schema) : "must be a number"
    case "int":
      return isNumber(value) && Number.isInteger(value) ? rangeProblem(value, schema) : "must be a whole number"
    case "angle":
      return isNumber(value) ? null : "must be a number of degrees"
    case "bool":
      return typeof value === "boolean" ? null : "must be true or false"
    case "enum":
      return typeof value === "string" && schema.options.includes(value) ? null : `must be one of ${schema.options.join(", ")}`
    case "vec2":
      if (!Array.isArray(value) || value.length !== 2 || !value.every(isNumber)) return "must be [x, y]"
      return rangeProblem(value[0] as number, schema) ?? rangeProblem(value[1] as number, schema)
    case "color":
      return Array.isArray(value) && value.length === 4 && value.every(isNumber) ? null : "must be [r, g, b, a]"
    case "floatList":
      if (!Array.isArray(value) || !value.every(isNumber)) return "must be a list of numbers"
      if (value.length > schema.maxLength) return `can hold at most ${schema.maxLength} numbers`
      for (const item of value) {
        const problem = rangeProblem(item as number, schema)
        if (problem) return problem
      }
      return null
    case "gradient": {
      if (!Array.isArray(value) || value.length === 0) return "must be a list of at least one stop"
      if (value.length > MAX_GRADIENT_STOPS) return `can hold at most ${MAX_GRADIENT_STOPS} stops`
      for (const stop of value as unknown[]) {
        const s = stop as Partial<GradientStop> | null
        if (!s || typeof s !== "object" || !isNumber(s.position) || s.position < 0 || s.position > 1) {
          return "stops need a position between 0 and 1"
        }
        if (!Array.isArray(s.color) || s.color.length !== 4 || !s.color.every(isNumber)) return "stops need a color [r, g, b, a]"
        if (s.hardness !== undefined && (!isNumber(s.hardness) || s.hardness < 0 || s.hardness > 1)) {
          return "stop hardness must be between 0 and 1"
        }
      }
      return null
    }
    case "string":
      return typeof value === "string" ? null : "must be text"
  }
}

/** Parameter types a value output can drive. */
export function isDrivable(schema: ParamSchema): boolean {
  return schema.type === "float" || schema.type === "int" || schema.type === "angle"
}

export type NodeRegistry = {
  get: (type: string) => ResolvedNodeDef | undefined
  list: () => ResolvedNodeDef[]
  /** Changes whenever the set of node types changes (functions of the open project). Absent on a fixed registry. */
  revision?: () => number
}

export function createRegistry(defs: readonly ResolvedNodeDef[]): NodeRegistry {
  const byType = new Map<string, ResolvedNodeDef>()
  for (const def of defs) {
    if (byType.has(def.type)) throw new Error(`Node type "${def.type}" is defined twice.`)
    byType.set(def.type, def)
  }
  const sorted = [...byType.values()].sort((a, b) => a.type.localeCompare(b.type))
  return { get: (type) => byType.get(type), list: () => sorted }
}
