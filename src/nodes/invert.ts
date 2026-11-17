import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "invert",
  category: "Tone & Color",
  doc: "Negative: 1 minus the input. Alpha is kept unless alpha is on.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    alpha: { type: "bool", default: false, doc: "Also invert alpha." }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let c = sample_in(uv);
  return vec4f(1.0 - c.rgb, select(c.a, 1.0 - c.a, P.alpha == 1u));
}`
})
