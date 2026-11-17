import { evaluateExpression, ExpressionError, EXPRESSION_FUNCTIONS } from "../engine/expression"
import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "value_expression",
  category: "Math",
  doc: `A formula on numbers, for driving parameters. Names: a, b, c, d (the inputs, or the parameters of the same meaning when not connected), phase (0 to 1 over the loop), frame, frames, seconds, pi. Operators: + - * / % ^ and brackets. Functions: ${EXPRESSION_FUNCTIONS.join(", ")}. sin and cos take turns (1 = full circle), so sin(phase) loops exactly. Example: 0.5 + 0.2 * sin(phase * 2).`,
  inputs: { a: { type: "value", optional: true }, b: { type: "value", optional: true }, c: { type: "value", optional: true }, d: { type: "value", optional: true } },
  outputs: { out: "value" },
  params: {
    expression: { type: "string", default: "a + b" },
    value_a: { type: "float", default: 0 },
    value_b: { type: "float", default: 0 },
    value_c: { type: "float", default: 0 },
    value_d: { type: "float", default: 0 }
  },
  check: (params) => {
    try {
      evaluateExpression(String(params.expression), { a: 0, b: 0, c: 0, d: 0, phase: 0, frame: 0, frames: 1, seconds: 0, pi: Math.PI })
      return null
    } catch (error) {
      return error instanceof ExpressionError ? `Expression: ${error.message}` : "The expression cannot be read."
    }
  },
  evaluate: ({ params, inputs, phase, frame, frames, fps }) => {
    const names = {
      a: inputs.a ?? (params.value_a as number),
      b: inputs.b ?? (params.value_b as number),
      c: inputs.c ?? (params.value_c as number),
      d: inputs.d ?? (params.value_d as number),
      phase,
      frame,
      frames,
      seconds: frame / fps,
      pi: Math.PI
    }
    try {
      return { out: evaluateExpression(params.expression as string, names) }
    } catch {
      return { out: 0 }
    }
  }
})
