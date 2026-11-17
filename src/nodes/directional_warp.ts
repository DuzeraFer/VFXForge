import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "directional_warp",
  category: "Transform",
  doc: "Slides pixels along one direction by the brightness of a map: black stays, white moves by intensity. Unlike Warp, the push is one-sided, which suits smears and streaks.",
  inputs: { in: "image", map: "gray" },
  outputs: { out: "same:in" },
  params: {
    intensity: { type: "float", default: 0.1, min: -2, max: 2, softMin: 0, softMax: 1, doc: "UV units." },
    angle: { type: "angle", default: 0 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let push = vec2f(cos(P.angle), -sin(P.angle)) * sample_map(uv).r;
  return sample_in(uv - push * P.intensity);
}`
})
