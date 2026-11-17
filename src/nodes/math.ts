import { defineNode } from "../engine/nodeDef"

const OPS = ["add", "sub", "mul", "div", "pow", "min", "max", "abs", "sin", "cos", "fract", "mod", "step"] as const

export default defineNode({
  type: "math",
  category: "Math",
  doc: "Math on values. Inputs a and b override the parameters of the same meaning when connected. sin and cos take turns (1 = full circle).",
  inputs: { a: { type: "value", optional: true }, b: { type: "value", optional: true } },
  outputs: { out: "value" },
  params: {
    op: { type: "enum", default: "add", options: OPS },
    value_a: { type: "float", default: 0 },
    value_b: { type: "float", default: 0 }
  },
  evaluate: ({ params, inputs }) => {
    const a = inputs.a ?? (params.value_a as number)
    const b = inputs.b ?? (params.value_b as number)
    const turn = Math.PI * 2
    const table: Record<(typeof OPS)[number], () => number> = {
      add: () => a + b,
      sub: () => a - b,
      mul: () => a * b,
      div: () => (b === 0 ? 0 : a / b),
      pow: () => Math.pow(a, b),
      min: () => Math.min(a, b),
      max: () => Math.max(a, b),
      abs: () => Math.abs(a),
      sin: () => Math.sin(a * turn),
      cos: () => Math.cos(a * turn),
      fract: () => a - Math.floor(a),
      mod: () => (b === 0 ? 0 : a - b * Math.floor(a / b)),
      step: () => (a >= b ? 1 : 0)
    }
    const out = table[params.op as (typeof OPS)[number]]()
    return { out: Number.isFinite(out) ? out : 0 }
  }
})
