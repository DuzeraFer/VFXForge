import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "vector_warp",
  category: "Transform",
  doc: "Moves pixels by a flow map: red is the push to the right, green the push up, both around mid gray (0.5 = no push). Curl Noise makes such maps.",
  inputs: { in: "image", flow: "color" },
  outputs: { out: "same:in" },
  params: {
    intensity: { type: "float", default: 0.1, min: -2, max: 2, softMin: 0, softMax: 1, doc: "UV units at full push." }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let f = sample_flow(uv).rg * 2.0 - 1.0;
  return sample_in(uv - vec2f(f.x, -f.y) * P.intensity);
}`
})
