import { defineNode } from "../engine/nodeDef"
import { stampFn } from "../engine/snippets"

export default defineNode({
  type: "splatter_circular",
  category: "Patterns",
  doc: "Places copies of a shape around a ring: petals, magic circles, radial bursts. Connect any image as the shape (a disc without one); its top points outward. spiral moves each copy further out than the one before.",
  inputs: { in: { type: "image", optional: true } },
  outputs: { out: "same:in" },
  seeded: true,
  params: {
    count: { type: "int", default: 8, min: 1, max: 64 },
    radius: { type: "float", default: 0.6, min: 0, max: 2, doc: "Centered units." },
    scale: { type: "float", default: 0.25, min: 0, max: 2, doc: "Half size of each copy, centered units." },
    spiral: { type: "float", default: 0, min: -2, max: 2, doc: "Extra radius from the first copy to the last." },
    scale_end: { type: "float", default: 1, min: 0, max: 4, doc: "Size of the last copy relative to the first." },
    rotation: { type: "angle", default: 0, doc: "Turns the whole ring." },
    spin: { type: "angle", default: 0, doc: "Turns each copy in place." },
    arc: { type: "angle", default: 360, doc: "Part of the circle that is used." },
    scale_jitter: { type: "float", default: 0, min: 0, max: 1 },
    blend: { type: "enum", default: "max", options: ["max", "add"] }
  },
  wgsl: /* wgsl */ `
${stampFn("in")}
fn node(uv: vec2f) -> vec4f {
  let p = centered(uv);
  var acc = vec4f(0.0);
  let full = abs(P.arc) >= TAU - 1e-4;
  for (var i = 0; i < P.count; i++) {
    let t = f32(i) / f32(max(select(P.count - 1, P.count, full), 1));
    let u = f32(i) / f32(max(P.count - 1, 1));
    let a = P.rotation + P.arc * t;
    let center = (P.radius + P.spiral * u) * vec2f(sin(a), cos(a));
    let size = P.scale * mix(1.0, P.scale_end, u) * (1.0 - P.scale_jitter * hash1(i, G.seed));
    let local = rotate2(p - center, a + P.spin) / max(size, 1e-5);
    let c = stamp_in(local);
    if (P.blend == 1u) { acc += c; } else { acc = max(acc, c); }
  }
  return clamp(acc, vec4f(0.0), vec4f(1.0));
}`
})
