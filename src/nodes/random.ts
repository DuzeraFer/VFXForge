import { defineNode } from "../engine/nodeDef"

/** Deterministic 0..1 from two integers. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

export default defineNode({
  type: "random",
  category: "Math",
  doc: "A random number between min and max that stays the same until seed changes. per_frame gives another number on every frame of the loop (the same again each time round).",
  inputs: {},
  outputs: { out: "value" },
  params: {
    seed: { type: "int", default: 0 },
    min: { type: "float", default: 0 },
    max: { type: "float", default: 1 },
    per_frame: { type: "bool", default: false }
  },
  evaluate: ({ params, frame }) => {
    const r = hash(params.seed as number, params.per_frame ? Math.round(frame) + 1 : 0)
    return { out: (params.min as number) + ((params.max as number) - (params.min as number)) * r }
  }
})
