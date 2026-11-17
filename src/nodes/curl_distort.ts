import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "curl_distort",
  category: "Transform",
  doc: "Swirls any image with a built-in curl noise, so it bends and curls without tearing or bunching up. evolution 0 to 1 is one seamless loop. Tiles when scale is a whole number.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  seeded: true,
  params: {
    intensity: { type: "float", default: 0.1, min: 0, max: 2, softMax: 0.5, doc: "UV units." },
    scale: { type: "float", default: 3, min: 1, softMax: 16, max: 128 },
    evolution: { type: "float", default: 0 },
    loops: { type: "int", default: 1, min: 1, max: 16 },
    offset: { type: "vec2", default: [0, 0] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let s = i32(ceil(P.scale));
  let q = vec3f((uv + P.offset) * P.scale, fract(P.evolution) * f32(P.loops));
  let flow = curl2(q, vec3i(s, s, P.loops), G.seed);
  return sample_in(uv + flow * P.intensity * 0.25);
}`
})
