import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "warp",
  category: "Transform",
  doc: "Pushes the input around using a grayscale map. mode=slope moves pixels along the map's slopes (organic); mode=directional moves them along angle by how far the map is from mid gray. intensity is in UV units.",
  inputs: { in: "image", map: "gray" },
  outputs: { out: "same:in" },
  params: {
    intensity: { type: "float", default: 0.1, min: 0, max: 2, softMax: 1 },
    mode: { type: "enum", default: "slope", options: ["slope", "directional"] },
    angle: { type: "angle", default: 0, doc: "Direction for mode=directional." }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  var push: vec2f;
  if (P.mode == 1u) {
    push = vec2f(cos(P.angle), -sin(P.angle)) * (sample_map(uv).r - 0.5) * 2.0;
  } else {
    // Central differences over a fixed UV step, so the look does not change with resolution.
    let e = 1.0 / 64.0;
    push = vec2f(
      sample_map(uv + vec2f(e, 0.0)).r - sample_map(uv - vec2f(e, 0.0)).r,
      sample_map(uv + vec2f(0.0, e)).r - sample_map(uv - vec2f(0.0, e)).r
    ) * 4.0;
  }
  return sample_in(uv + push * P.intensity);
}`
})
