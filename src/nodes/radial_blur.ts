import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "radial_blur",
  category: "Filters",
  doc: "Blur around a point. zoom streaks outward from center (speed lines, light rays); spin smears around it. amount is the share of the distance for zoom, and turns for spin.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    mode: { type: "enum", default: "zoom", options: ["zoom", "spin"] },
    amount: { type: "float", default: 0.2, min: 0, max: 1 },
    center: { type: "vec2", default: [0, 0], doc: "Centered units." }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let p = centered(uv) - P.center;
  const N = 48;
  var sum = vec4f(0.0);
  for (var i = 0; i < N; i++) {
    let t = (f32(i) + 0.5) / f32(N) - 0.5;
    var q: vec2f;
    if (P.mode == 1u) { q = rotate2(p, t * P.amount * TAU); } else { q = p * (1.0 + t * P.amount); }
    q += P.center;
    sum += sample_in(vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5));
  }
  return sum / f32(N);
}`
})
