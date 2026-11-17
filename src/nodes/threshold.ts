import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "threshold",
  category: "Tone & Color",
  doc: "White where the input is above level, black below. The edge is always anti-aliased; softness widens it.",
  inputs: { in: "image" },
  outputs: { out: "gray" },
  params: {
    level: { type: "float", default: 0.5, softMin: 0, softMax: 1 },
    softness: { type: "float", default: 0, min: 0, max: 1 },
    invert: { type: "bool", default: false }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let c = sample_in(uv);
  var v = soft_step(P.level, P.softness, luminance(c.rgb));
  if (P.invert == 1u) { v = 1.0 - v; }
  return vec4f(v, v, v, 1.0);
}`
})
