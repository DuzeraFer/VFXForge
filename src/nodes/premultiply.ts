import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "premultiply",
  category: "Blending",
  doc: "Multiplies color by alpha (premultiply) or divides it back (unpremultiply). The engine works in straight alpha; use this for textures a shader expects premultiplied.",
  inputs: { in: "color" },
  outputs: { out: "color" },
  params: {
    mode: { type: "enum", default: "premultiply", options: ["premultiply", "unpremultiply"] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let c = sample_in(uv);
  if (P.mode == 1u) { return vec4f(c.rgb / max(c.a, 1e-5), c.a); }
  return vec4f(c.rgb * c.a, c.a);
}`
})
