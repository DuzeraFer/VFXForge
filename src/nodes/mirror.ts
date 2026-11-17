import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "mirror",
  category: "Transform",
  doc: "Mirrors the image. horizontal copies the left half onto the right, vertical the top onto the bottom, both does the two. radial repeats one wedge count times around the center, each a mirror of the next (a kaleidoscope).",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    mode: { type: "enum", default: "horizontal", options: ["horizontal", "vertical", "both", "radial"] },
    count: { type: "int", default: 6, min: 1, max: 64, doc: "Wedges, for radial." },
    rotation: { type: "angle", default: 0, doc: "Turns the wedges, for radial." },
    flip: { type: "bool", default: false, doc: "Keep the other half instead." }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  var q = uv;
  if (P.mode == 3u) {
    let p = centered(uv);
    let wedge = TAU / f32(P.count);
    var a = atan2(p.x, p.y) - P.rotation;
    a = a - wedge * floor(a / wedge);
    a = min(a, wedge - a);
    if (P.flip == 1u) { a = wedge * 0.5 - a; }
    a += P.rotation;
    let r = length(p) * vec2f(sin(a), cos(a));
    return sample_in(vec2f(r.x * 0.5 + 0.5, 0.5 - r.y * 0.5));
  }
  if (P.mode == 0u || P.mode == 2u) { q.x = 0.5 - abs(q.x - 0.5); if (P.flip == 1u) { q.x = 1.0 - q.x; } }
  if (P.mode == 1u || P.mode == 2u) { q.y = 0.5 - abs(q.y - 0.5); if (P.flip == 1u) { q.y = 1.0 - q.y; } }
  return sample_in(q);
}`
})
