import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "uniform_color",
  category: "Inputs",
  doc: "Fills the image with one color.",
  inputs: {},
  outputs: { out: "color" },
  params: {
    color: { type: "color", default: [1, 1, 1, 1] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  return P.color;
}`
})
