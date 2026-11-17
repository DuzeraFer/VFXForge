import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "curves",
  category: "Tone & Color",
  doc: "Remaps brightness through a curve. points are x, y pairs from dark to bright (x rising), joined smoothly; the default is a gentle S for more contrast.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    points: { type: "floatList", default: [0, 0, 0.25, 0.15, 0.75, 0.85, 1, 1], maxLength: 16, min: 0, max: 1, doc: "x, y pairs with x rising. Two to eight points." },
    channel: { type: "enum", default: "rgb", options: ["rgb", "red", "green", "blue", "alpha"] }
  },
  wgsl: /* wgsl */ `
fn pt(i: i32, n: i32) -> vec2f {
  let k = u32(clamp(i, 0, n - 1));
  return vec2f(P_points(k * 2u), P_points(k * 2u + 1u));
}
fn curve(x: f32) -> f32 {
  let n = i32(P.points_count / 2u);
  if (n < 2) { return x; }
  if (x <= pt(0, n).x) { return pt(0, n).y; }
  if (x >= pt(n - 1, n).x) { return pt(n - 1, n).y; }
  var y = x;
  for (var i = 0; i < n - 1; i++) {
    let a = pt(i, n);
    let b = pt(i + 1, n);
    if (x >= a.x && x <= b.x) {
      let w = max(b.x - a.x, 1e-5);
      let t = (x - a.x) / w;
      // Hermite with tangents from the neighbours.
      let before = pt(i - 1, n);
      let after = pt(i + 2, n);
      let ma = (b.y - before.y) / max(b.x - before.x, 1e-5) * w;
      let mb = (after.y - a.y) / max(after.x - a.x, 1e-5) * w;
      let t2 = t * t;
      let t3 = t2 * t;
      y = (2.0 * t3 - 3.0 * t2 + 1.0) * a.y + (t3 - 2.0 * t2 + t) * ma + (-2.0 * t3 + 3.0 * t2) * b.y + (t3 - t2) * mb;
    }
  }
  return clamp(y, 0.0, 1.0);
}
fn node(uv: vec2f) -> vec4f {
  var c = sample_in(uv);
  switch P.channel {
    case 1u { c.r = curve(c.r); }
    case 2u { c.g = curve(c.g); }
    case 3u { c.b = curve(c.b); }
    case 4u { c.a = curve(c.a); }
    default { c = vec4f(curve(c.r), curve(c.g), curve(c.b), c.a); }
  }
  return c;
}`
})
