import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "clouds",
  category: "Noises",
  doc: "Soft, billowing noise with detail at every size, 0 to 1. roughness adds fine detail. Tiles when scale is a whole number; evolution 0 to 1 is one seamless loop.",
  inputs: {},
  outputs: { out: "gray" },
  seeded: true,
  params: {
    scale: { type: "float", default: 2, min: 1, softMax: 16, max: 128 },
    roughness: { type: "float", default: 0.5, min: 0, max: 1 },
    evolution: { type: "float", default: 0 },
    loops: { type: "int", default: 1, min: 1, max: 16 },
    contrast: { type: "float", default: 1, min: 0, softMax: 4, max: 16 },
    offset: { type: "vec2", default: [0, 0] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let s = i32(ceil(P.scale));
  let period = vec3i(s, s, P.loops);
  let z = fract(P.evolution) * f32(P.loops);
  let q = (uv + P.offset) * P.scale;
  // A first noise pushes the second around, which gives the folded look of clouds.
  let push = noise_vec2(vec3f(q, z), period, G.seed + 97u) * 0.35;
  let n = fbm3(vec3f(q + push, z), period, 6, mix(0.3, 0.7, P.roughness), G.seed);
  let v = clamp(n * 0.6 * P.contrast + 0.5, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}`
})
