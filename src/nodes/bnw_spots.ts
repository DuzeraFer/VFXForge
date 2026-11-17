import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "bnw_spots",
  category: "Noises",
  doc: "Blotchy black and white spots with soft, ragged edges. density sets how much is white. A good dissolve or erosion map. Tiles when scale is a whole number; evolution 0 to 1 is one loop.",
  inputs: {},
  outputs: { out: "gray" },
  seeded: true,
  params: {
    scale: { type: "float", default: 4, min: 1, softMax: 32, max: 256 },
    density: { type: "float", default: 0.5, min: 0, max: 1 },
    edge: { type: "float", default: 0.15, min: 0.001, max: 1, doc: "Softness of the spots' edges." },
    roughness: { type: "float", default: 0.5, min: 0, max: 1 },
    evolution: { type: "float", default: 0 },
    loops: { type: "int", default: 1, min: 1, max: 16 },
    offset: { type: "vec2", default: [0, 0] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let s = i32(ceil(P.scale));
  let period = vec3i(s, s, P.loops);
  let z = fract(P.evolution) * f32(P.loops);
  let n = fbm3(vec3f((uv + P.offset) * P.scale, z), period, 5, mix(0.3, 0.75, P.roughness), G.seed) * 0.5 + 0.5;
  // fbm sits close to 0.5, so the cut is spread over the part of the range it really uses.
  let cut = mix(0.75, 0.25, P.density);
  let v = clamp((n - cut) / (P.edge * 0.5) + 0.5, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}`
})
