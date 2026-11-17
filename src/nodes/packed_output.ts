import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "packed_output",
  category: "Outputs",
  doc: "A result that stores a different grayscale image in each channel of one texture: for example a mask in red, an erosion map in green and a flow strength in blue. An unconnected channel takes its value from fill. The exported sidecar lists what is in each channel, and the texture is imported as data (no sRGB).",
  inputs: {
    r: { type: "gray", optional: true },
    g: { type: "gray", optional: true },
    b: { type: "gray", optional: true },
    a: { type: "gray", optional: true }
  },
  outputs: { out: "color" },
  params: {
    name: { type: "string", default: "packed" },
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
