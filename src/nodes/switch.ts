import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "switch",
  category: "Math",
  doc: "Passes on input a or input b. pick below 0.5 gives a, otherwise b. Drive pick with a value to choose by frame or by a Random.",
  inputs: { a: "image", b: "image" },
  outputs: { out: "same:a" },
  params: {
    pick: { type: "float", default: 0, min: 0, max: 1, doc: "0 = a, 1 = b." }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  if (P.pick >= 0.5) { return sample_b(uv); }
  return sample_a(uv);
}`
})
