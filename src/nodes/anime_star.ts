import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "anime_star",
  category: "Shapes",
  doc: "A star with curved spikes, for sparkles and impact flashes. curve above 1 makes thin, concave spikes; jitter gives each spike its own length. output=field is positive inside.",
  inputs: {},
  outputs: { out: "gray" },
  seeded: true,
  params: {
    points: { type: "int", default: 4, min: 2, max: 32 },
    outer: { type: "float", default: 0.8, min: 0, softMax: 1, max: 2, doc: "Spike length from the center." },
    inner: { type: "float", default: 0.15, min: 0, max: 1, doc: "Radius between spikes." },
    curve: { type: "float", default: 2.5, min: 0.2, max: 8, doc: "1 = straight edges. Higher = thinner spikes." },
    jitter: { type: "float", default: 0, min: 0, max: 1, doc: "How much spike lengths vary." },
    offset: { type: "vec2", default: [0, 0] },
    rotation: { type: "angle", default: 0 },
    softness: { type: "float", default: 0, min: 0, max: 1 },
    output: { type: "enum", default: "mask", options: ["mask", "field"] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let p = rotate2(centered(uv) - P.offset, -P.rotation);
  let n = f32(P.points);
  // Position around the star in spikes: whole numbers are spike tips.
  let turn = atan2(p.x, p.y) / TAU * n;
  let spike = floor(turn + 0.5);
  let t = abs(turn - spike) * 2.0;
  let index = i32(spike + n) % P.points;
  let reach = P.outer * (1.0 - P.jitter * hash1(index, G.seed));
  let edge = mix(P.inner, max(reach, P.inner), pow(1.0 - t, P.curve));
  let r = length(p);
  let d = r - edge;
  // Near the center the angle changes within a pixel; limit the edge width so that does not blur the middle.
  let w = max(min(max(fwidth(d), 1e-6), 3.0 * fwidth(r)), P.softness);
  let v = select(1.0 - clamp(d / w + 0.5, 0.0, 1.0), -d, P.output == 1u);
  return vec4f(v, v, v, 1.0);
}`
})
