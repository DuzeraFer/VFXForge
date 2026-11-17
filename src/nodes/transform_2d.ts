import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "transform_2d",
  category: "Transform",
  doc: "Moves, rotates and scales the input around the image center. offset is in centered units (1 = half the image).",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    offset: { type: "vec2", default: [0, 0] },
    rotation: { type: "angle", default: 0 },
    scale: { type: "vec2", default: [1, 1], min: 0.001 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let p = rotate2(centered(uv) - P.offset, -P.rotation) / P.scale;
  return sample_in(vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5));
}`
})
