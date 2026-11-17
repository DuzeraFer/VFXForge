import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "perlin",
  category: "Noises",
  doc: "Perlin noise, 0 to 1. Tiles exactly when scale is a whole number. evolution animates it: 0 to 1 is one seamless loop, so drive it with Time.phase.",
  inputs: {},
  outputs: { out: "gray" },
  seeded: true,
  params: {
    scale: { type: "float", default: 4, min: 0.01, softMax: 32, max: 512 },
    octaves: { type: "int", default: 1, min: 1, max: 8 },
    gain: { type: "float", default: 0.5, min: 0, max: 1, doc: "Strength of each octave relative to the one before." },
    evolution: { type: "float", default: 0, doc: "Loop position. Whole numbers give the same image." },
    loops: { type: "int", default: 2, min: 1, max: 16, doc: "How much the noise changes over one evolution loop." },
    contrast: { type: "float", default: 1, min: 0, softMax: 4, max: 16 },
    offset: { type: "vec2", default: [0, 0] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let period = vec3i(vec2i(i32(ceil(P.scale))), P.loops);
  let p = vec3f((uv + P.offset) * P.scale, fract(P.evolution) * f32(P.loops));
  let n = fbm3(p, period, P.octaves, P.gain, G.seed);
  let v = clamp(n * 0.5 * P.contrast + 0.5, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}`
})
