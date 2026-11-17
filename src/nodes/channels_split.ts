import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "channels_split",
  category: "Blending",
  doc: "Splits a color image into four grayscale images: r, g, b and a.",
  inputs: { in: "color" },
  outputs: { r: "gray", g: "gray", b: "gray", a: "gray" },
  params: {},
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let v = sample_in(uv)[OUT];
  return vec4f(v, v, v, 1.0);
}`
})
