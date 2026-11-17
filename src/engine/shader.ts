/**
 * Turns a node definition into a complete WGSL module and packs its
 * parameters into a uniform buffer with WGSL's layout rules.
 */

import type { GradientStop, ParamValue } from "../doc/types"
import { MAX_GRADIENT_STOPS, type DataType, type ParamSchema, type ResolvedNodeDef } from "./nodeDef"
import library from "./wgsl/library.wgsl?raw"

type FieldKind = "f32" | "i32" | "u32" | "vec2f" | "vec4f" | "vec4f[]"

export type Field = {
  /** Name inside the WGSL `Params` struct. */
  name: string
  kind: FieldKind
  /** Array length for "vec4f[]". */
  length: number
  offset: number
  /** The parameter this field comes from, and which part of it. */
  param: string
  part: "value" | "count" | "colors" | "stops"
}

export type UniformLayout = { fields: Field[]; size: number }

const ALIGN: Record<FieldKind, number> = { f32: 4, i32: 4, u32: 4, vec2f: 8, vec4f: 16, "vec4f[]": 16 }
const SIZE: Record<FieldKind, number> = { f32: 4, i32: 4, u32: 4, vec2f: 8, vec4f: 16, "vec4f[]": 16 }

function fieldsOf(name: string, schema: ParamSchema): Omit<Field, "offset">[] {
  const one = (kind: FieldKind): Omit<Field, "offset">[] => [{ name, kind, length: 1, param: name, part: "value" }]
  switch (schema.type) {
    case "float":
    case "angle":
      return one("f32")
    case "int":
      return one("i32")
    case "bool":
    case "enum":
      return one("u32")
    case "vec2":
      return one("vec2f")
    case "color":
      return one("vec4f")
    case "floatList":
      return [
        { name: `${name}_data`, kind: "vec4f[]", length: Math.ceil(schema.maxLength / 4), param: name, part: "value" },
        { name: `${name}_count`, kind: "u32", length: 1, param: name, part: "count" }
      ]
    case "gradient":
      return [
        { name: `${name}_colors`, kind: "vec4f[]", length: MAX_GRADIENT_STOPS, param: name, part: "colors" },
        { name: `${name}_stops`, kind: "vec4f[]", length: MAX_GRADIENT_STOPS, param: name, part: "stops" },
        { name: `${name}_count`, kind: "u32", length: 1, param: name, part: "count" }
      ]
    case "string":
      return []
  }
}

/** Offsets follow the WGSL struct layout rules (align each member, round the struct up to its largest alignment). */
export function buildLayout(params: Record<string, ParamSchema>): UniformLayout {
  const fields: Field[] = []
  let offset = 0
  let maxAlign = 4
  for (const [name, schema] of Object.entries(params)) {
    for (const field of fieldsOf(name, schema)) {
      const align = ALIGN[field.kind]
      offset = Math.ceil(offset / align) * align
      fields.push({ ...field, offset })
      offset += SIZE[field.kind] * field.length
      maxAlign = Math.max(maxAlign, align)
    }
  }
  // A struct needs at least one member; an empty Params gets a padding float.
  const size = Math.max(16, Math.ceil(offset / maxAlign) * maxAlign)
  return { fields, size: Math.ceil(size / 16) * 16 }
}

const DEG_TO_RAD = Math.PI / 180

export function sortedStops(stops: GradientStop[]): GradientStop[] {
  return stops.map((stop, index) => ({ stop, index })).sort((a, b) => a.stop.position - b.stop.position || a.index - b.index).map((e) => e.stop)
}

/** Writes resolved parameter values into a buffer matching `buildLayout`. */
export function packParams(
  layout: UniformLayout,
  params: Record<string, ParamSchema>,
  values: Record<string, ParamValue>
): ArrayBuffer {
  const buffer = new ArrayBuffer(layout.size)
  const view = new DataView(buffer)
  for (const field of layout.fields) {
    const schema = params[field.param]
    const value = values[field.param]
    const o = field.offset
    switch (schema.type) {
      case "float":
        view.setFloat32(o, value as number, true)
        break
      case "angle":
        view.setFloat32(o, (value as number) * DEG_TO_RAD, true)
        break
      case "int":
        view.setInt32(o, value as number, true)
        break
      case "bool":
        view.setUint32(o, value ? 1 : 0, true)
        break
      case "enum":
        view.setUint32(o, Math.max(0, schema.options.indexOf(value as string)), true)
        break
      case "vec2":
      case "color":
        ;(value as number[]).forEach((v, i) => view.setFloat32(o + i * 4, v, true))
        break
      case "floatList": {
        const list = value as number[]
        if (field.part === "count") view.setUint32(o, list.length, true)
        else list.forEach((v, i) => view.setFloat32(o + i * 4, v, true))
        break
      }
      case "gradient": {
        const stops = sortedStops(value as GradientStop[])
        if (field.part === "count") view.setUint32(o, stops.length, true)
        else if (field.part === "colors") stops.forEach((s, i) => s.color.forEach((c, j) => view.setFloat32(o + i * 16 + j * 4, c, true)))
        else stops.forEach((s, i) => {
            view.setFloat32(o + i * 16, s.position, true)
            view.setFloat32(o + i * 16 + 4, s.hardness ?? 0, true)
          })
        break
      }
      case "string":
        break
    }
  }
  return buffer
}

/** Fixed layout of the `Globals` struct below: 32 bytes. */
export const GLOBALS_SIZE = 32

export type Globals = { width: number; height: number; phase: number; frame: number; frames: number; seed: number; seconds: number }

export function packGlobals(g: Globals): ArrayBuffer {
  const buffer = new ArrayBuffer(GLOBALS_SIZE)
  const view = new DataView(buffer)
  view.setFloat32(0, g.width, true)
  view.setFloat32(4, g.height, true)
  view.setFloat32(8, g.phase, true)
  view.setFloat32(12, g.frame, true)
  view.setFloat32(16, g.frames, true)
  view.setUint32(20, g.seed >>> 0, true)
  view.setFloat32(24, g.seconds, true)
  return buffer
}

const GLOBALS_WGSL = /* wgsl */ `
struct Globals {
  resolution: vec2f,
  // Loop position in [0, 1). Frame N equals frame 0 by construction.
  phase: f32,
  frame: f32,
  frames: f32,
  seed: u32,
  seconds: f32,
  _pad: f32,
}
@group(0) @binding(0) var<uniform> G: Globals;
`

function wgslType(field: Field): string {
  return field.kind === "vec4f[]" ? `array<vec4f, ${field.length}>` : field.kind
}

function paramsWgsl(def: ResolvedNodeDef, layout: UniformLayout): string {
  const members = layout.fields.map((f) => `  ${f.name}: ${wgslType(f)},`)
  if (members.length === 0) members.push("  _unused: f32,")
  const parts = [`struct Params {\n${members.join("\n")}\n}\n@group(0) @binding(1) var<uniform> P: Params;`]

  for (const [name, schema] of Object.entries(def.params)) {
    if (schema.type === "floatList") {
      parts.push(`fn P_${name}(i: u32) -> f32 { return P.${name}_data[i / 4u][i % 4u]; }`)
    }
    if (schema.type === "gradient") {
      // A stop's hardness shrinks the blend that arrives at it: 0 = blend over
      // the whole gap from the previous stop, 1 = hard edge at the stop
      // (still one pixel wide, so cel bands stay anti-aliased).
      parts.push(/* wgsl */ `
fn gradient_${name}(t: f32) -> vec4f {
  let count = P.${name}_count;
  var color = P.${name}_colors[0];
  let pixel = max(fwidth(t), 1e-5);
  for (var i = 1u; i < count; i++) {
    let prev = P.${name}_stops[i - 1u].x;
    let stop = P.${name}_stops[i];
    let width = max((stop.x - prev) * (1.0 - stop.y), pixel);
    let center = stop.x - (stop.x - prev) * (1.0 - stop.y) * 0.5;
    color = mix(color, P.${name}_colors[i], clamp((t - center) / width + 0.5, 0.0, 1.0));
  }
  return color;
}`)
    }
  }
  return parts.join("\n")
}

/** What is plugged into each image input: its data type, or null when unconnected. */
export type InputBinding = Record<string, DataType | null>

function inputsWgsl(def: ResolvedNodeDef, bound: InputBinding): { code: string; textures: string[] } {
  const parts: string[] = ["@group(0) @binding(2) var input_sampler: sampler;"]
  const textures: string[] = []
  // A node's image file is read like one more input, named "asset".
  for (const name of def.asset !== undefined ? [...Object.keys(def.inputs), "asset"] : Object.keys(def.inputs)) {
    const type = bound[name] ?? null
    if (type === null) {
      parts.push(`const has_${name}: bool = false;`, `fn sample_${name}(uv: vec2f) -> vec4f { return vec4f(0.0); }`)
      continue
    }
    const binding = textures.length
    textures.push(name)
    const read = `textureSampleLevel(tex_${name}, input_sampler, uv, 0.0)`
    parts.push(
      `@group(1) @binding(${binding}) var tex_${name}: texture_2d<f32>;`,
      `const has_${name}: bool = true;`,
      type === "gray"
        ? `fn sample_${name}(uv: vec2f) -> vec4f { let v = ${read}.r; return vec4f(v, v, v, 1.0); }`
        : `fn sample_${name}(uv: vec2f) -> vec4f { return ${read}; }`
    )
  }
  return { code: parts.join("\n"), textures }
}

const MAIN_WGSL = /* wgsl */ `
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: VertexOut;
  out.position = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  // uv (0, 0) is the top-left pixel corner, y points down.
  out.uv = vec2f(corner.x, 1.0 - corner.y);
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  return node(in.uv);
}
`

export type ShaderVariant = {
  code: string
  /** Input names in `@group(1)` binding order. */
  textures: string[]
}

/** Complete module for one node, one output, one combination of connected inputs. */
export function buildShader(def: ResolvedNodeDef, layout: UniformLayout, bound: InputBinding, outputIndex: number): ShaderVariant {
  if (!def.wgsl) throw new Error(`Node "${def.type}" has no shader.`)
  const inputs = inputsWgsl(def, bound)
  const code = [
    GLOBALS_WGSL,
    paramsWgsl(def, layout),
    inputs.code,
    `const OUT: u32 = ${outputIndex}u;`,
    library,
    `// ── node: ${def.type} ──`,
    def.wgsl,
    MAIN_WGSL
  ].join("\n")
  return { code, textures: inputs.textures }
}

export function variantKey(def: ResolvedNodeDef, bound: InputBinding, outputIndex: number): string {
  const inputs = Object.keys(def.inputs).map((name) => (bound[name] ?? "-")[0])
  if (def.asset !== undefined) inputs.push(bound.asset ? "a" : "-")
  return `${def.type}|${outputIndex}|${inputs.join("")}`
}
