import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "band_noise",
  category: "Noises",
  doc: "Soft noise with features of one size only, 0 to 1: no fine grain and no large drifts. band widens the mix of sizes. Good as a warp or erosion map for cel shapes. Tiles when scale is an even whole number; evolution 0 to 1 is one loop.",
  inputs: {},
  outputs: { out: "gray" },
  seeded: true,
  params: {
    scale: { type: "float", default: 4, min: 1, softMax: 32, max: 256 },
    band: { type: "float", default: 0.3, min: 0, max: 1, doc: "0 = one size. 1 = a mix of half and double size as well." },
    evolution: { type: "float", default: 0 },
    loops: { type: "int", default: 2, min: 1, max: 16 },
    contrast: { type: "float", default: 1, min: 0, softMax: 4, max: 16 },
    offset: { type: "vec2", default: [0, 0] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let s = ceil(P.scale);
  let z = fract(P.evolution) * f32(P.loops);
  let q = uv + P.offset;
  let mid = perlin3(vec3f(q * P.scale, z), vec3i(i32(s), i32(s), P.loops), G.seed);
  let low = perlin3(vec3f(q * P.scale * 0.5, z), vec3i(i32(ceil(s * 0.5)), i32(ceil(s * 0.5)), P.loops), G.seed + 11u);
  let high = perlin3(vec3f(q * P.scale * 2.0, z), vec3i(i32(s) * 2, i32(s) * 2, P.loops), G.seed + 23u);
  let w = P.band * 0.5;
  let n = (mid + w * (low + high)) / (1.0 + 2.0 * w);
  let v = clamp(n * 0.5 * P.contrast + 0.5, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}`
})
