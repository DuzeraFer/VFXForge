import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "polar",
  category: "Transform",
  doc: "Bends an image between straight and round. to_polar wraps the input around center: its x goes around, its y goes outward (top = center). to_rect does the reverse and unrolls a round image into a strip. Wrap a tiling noise with to_polar for rings and vortexes.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    mode: { type: "enum", default: "to_polar", options: ["to_polar", "to_rect"] },
    center: { type: "vec2", default: [0, 0], doc: "Centered units." },
    radius: { type: "float", default: 1, min: 0.01, max: 4, doc: "Distance from center that maps to the bottom edge." },
    turns: { type: "float", default: 1, min: 0.01, max: 16, doc: "How many times the input repeats around the circle. Whole numbers leave no seam." },
    rotation: { type: "angle", default: 0 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  if (P.mode == 1u) {
    let a = uv.x / P.turns * TAU + P.rotation;
    let p = P.center + uv.y * P.radius * vec2f(sin(a), cos(a));
    return sample_in(vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5));
  }
  let p = centered(uv) - P.center;
  let a = (atan2(p.x, p.y) - P.rotation) / TAU;
  return sample_in(vec2f(fract(a + 1.0) * P.turns, length(p) / P.radius));
}`
})
