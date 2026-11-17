import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "channels_merge",
  category: "Blending",
  doc: "Builds a color image from grayscale inputs r, g, b and a. An unconnected channel takes its value from fill.",
  inputs: {
    r: { type: "gray", optional: true },
    g: { type: "gray", optional: true },
    b: { type: "gray", optional: true },
    a: { type: "gray", optional: true }
  },
  outputs: { out: "color" },
  params: {
    fill: { type: "color", default: [0, 0, 0, 1] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  var c = P.fill;
  if (has_r) { c.r = sample_r(uv).r; }
  if (has_g) { c.g = sample_g(uv).r; }
  if (has_b) { c.b = sample_b(uv).r; }
  if (has_a) { c.a = sample_a(uv).r; }
  return c;
}`
})
