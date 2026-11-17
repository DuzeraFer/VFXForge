import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "burst",
  category: "Shapes",
  doc: "Rays shooting out from the center, for impacts and speed lines. Each ray is a thin wedge from hole to length; jitter varies their lengths and width_jitter their widths.",
  inputs: {},
  outputs: { out: "gray" },
  seeded: true,
  params: {
    rays: { type: "int", default: 12, min: 1, max: 128 },
    length: { type: "float", default: 0.9, min: 0, max: 2, softMax: 1 },
    hole: { type: "float", default: 0.2, min: 0, max: 1, doc: "Radius where rays begin." },
    width: { type: "float", default: 0.5, min: 0, max: 1, doc: "Ray width at its base, as a share of the space between rays." },
    taper: { type: "float", default: 1, min: 0, max: 4, doc: "0 = same width all along. Higher = pointed." },
    jitter: { type: "float", default: 0.4, min: 0, max: 1, doc: "How much ray lengths vary." },
    width_jitter: { type: "float", default: 0, min: 0, max: 1 },
    rotation: { type: "angle", default: 0 },
    offset: { type: "vec2", default: [0, 0] },
    softness: { type: "float", default: 0, min: 0, max: 1 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let p = rotate2(centered(uv) - P.offset, -P.rotation);
  let n = f32(P.rays);
  let r = length(p);
  let turn = atan2(p.x, p.y) / TAU * n;
  let ray = floor(turn + 0.5);
  let index = i32(ray + n) % P.rays;
  let reach = mix(P.hole, P.length, 1.0 - P.jitter * hash1(index, G.seed));
  let along = clamp((r - P.hole) / max(reach - P.hole, 1e-5), 0.0, 1.0);
  let base = P.width * (1.0 - P.width_jitter * hash1(index, G.seed + 101u));
  // Half width as a distance: the gap between rays at the hole, scaled.
  let half = base * (PI / n) * max(P.hole, 0.05) * pow(1.0 - along, P.taper) + 1e-5;
  let side = r * abs(sin((turn - ray) / n * TAU));
  let d = max(max(side - half, P.hole - r), r - reach);
  let v = sdf_fill(d, P.softness);
  return vec4f(v, v, v, 1.0);
}`
})
