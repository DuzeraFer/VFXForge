import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "white_noise",
  category: "Noises",
  doc: "A random gray for every cell of a grid, with no smoothness at all: grain, static, dither. size 0 uses one cell per pixel. evolution picks another pattern for every whole number.",
  inputs: {},
  outputs: { out: "gray" },
  seeded: true,
  params: {
    size: { type: "int", default: 0, min: 0, max: 4096, doc: "Cells across the image. 0 = one per pixel." },
    evolution: { type: "int", default: 0 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let cells = select(vec2f(f32(P.size)), G.resolution, P.size == 0);
  let v = hash3(vec3i(vec2i(floor(fract(uv) * cells)), P.evolution), G.seed);
  return vec4f(v, v, v, 1.0);
}`
})
