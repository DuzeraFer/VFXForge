import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "twirl",
  category: "Transform",
  doc: "Twists the image around center: most at the center, fading to nothing at radius.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    angle: { type: "angle", default: 180, doc: "Twist at the center." },
    radius: { type: "float", default: 1, min: 0.01, max: 4, doc: "Centered units." },
    center: { type: "vec2", default: [0, 0] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let p = centered(uv) - P.center;
  let t = 1.0 - clamp(length(p) / P.radius, 0.0, 1.0);
  let q = rotate2(p, -P.angle * t * t) + P.center;
  return sample_in(vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5));
}`
})
