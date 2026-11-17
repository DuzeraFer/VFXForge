import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "erosion",
  category: "Filters",
  doc: "Eats into the input where the map is bright: out = in - amount × map. On a field (signed distance) this carves the edge; on a mask it dissolves it.",
  inputs: { in: "gray", map: "gray" },
  outputs: { out: "gray" },
  params: {
    amount: { type: "float", default: 0.2, min: 0, max: 2, softMax: 1 },
    bias: { type: "float", default: 0, min: -1, max: 1, doc: "Added back evenly, to keep the overall size while eroding." }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let v = sample_in(uv).r - P.amount * sample_map(uv).r + P.bias;
  return vec4f(v, v, v, 1.0);
}`
})
