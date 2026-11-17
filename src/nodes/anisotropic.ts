import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "anisotropic",
  category: "Noises",
  doc: "Streaky noise stretched along one direction, like brushed metal, wood grain or speed streaks. stretch is how much longer than wide the streaks are. Tiles when angle is a multiple of 90 and scale ÷ stretch is a whole number.",
  inputs: {},
  outputs: { out: "gray" },
  seeded: true,
  params: {
    scale: { type: "float", default: 32, min: 1, softMax: 128, max: 512, doc: "Streaks across the image." },
    stretch: { type: "float", default: 8, min: 1, max: 64 },
    angle: { type: "angle", default: 0, doc: "Direction of the streaks." },
    octaves: { type: "int", default: 2, min: 1, max: 6 },
    evolution: { type: "float", default: 0 },
    loops: { type: "int", default: 1, min: 1, max: 16 },
    contrast: { type: "float", default: 1, min: 0, softMax: 4, max: 16 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  // Rotate about the image center, then count streaks across and stretched cells along.
  let q = rotate2(uv - 0.5, P.angle) + 0.5;
  let along = max(P.scale / P.stretch, 1.0);
  let period = vec3i(i32(ceil(along)), i32(ceil(P.scale)), P.loops);
  let p = vec3f(q.x * along, q.y * P.scale, fract(P.evolution) * f32(P.loops));
  let n = fbm3(p, period, P.octaves, 0.5, G.seed);
  let v = clamp(n * 0.5 * P.contrast + 0.5, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}`
})
