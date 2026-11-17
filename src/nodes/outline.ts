import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "outline",
  category: "Tone & Color",
  doc: "A line along the edge of a mask. position puts it outside the shape, inside it, or centered on the edge. width is in centered units. Good up to about 0.2.",
  inputs: { in: "gray" },
  outputs: { out: "gray" },
  params: {
    width: { type: "float", default: 0.05, min: 0, max: 0.5 },
    position: { type: "enum", default: "outside", options: ["outside", "inside", "center"] },
    threshold: { type: "float", default: 0.5, min: 0, max: 1 }
  },
  wgsl: /* wgsl */ `
// x = brightest, y = darkest value within the radius.
fn reach(uv: vec2f, radius: f32) -> vec2f {
  let aspect = vec2f(G.resolution.y / G.resolution.x, 1.0);
  let center = sample_in(uv).r;
  var hi = center;
  var lo = center;
  const N = 96;
  for (var i = 0; i < N; i++) {
    let v = sample_in(uv + disc_point(i, N) * radius * 0.5 * aspect).r;
    hi = max(hi, v);
    lo = min(lo, v);
  }
  return vec2f(hi, lo);
}
fn node(uv: vec2f) -> vec4f {
  let center = sample_in(uv).r;
  let r = reach(uv, select(P.width, P.width * 0.5, P.position == 2u));
  var v: f32;
  switch P.position {
    case 1u { v = center - r.y; }
    case 2u { v = r.x - r.y; }
    default { v = r.x - center; }
  }
  // Sharpen around the threshold so a soft mask still gives a clean line.
  v = clamp((v - P.threshold) * 4.0 + 0.5, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}`
})
