import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "distance",
  category: "Filters",
  doc: "Turns a mask into a soft falloff: white on the mask, fading to black at reach away from it (centered units). The result is a smooth ramp that Band, Threshold and Erosion can cut. It is an estimate from samples, exact enough for reach up to about 0.5.",
  inputs: { in: "gray" },
  outputs: { out: "gray" },
  params: {
    reach: { type: "float", default: 0.2, min: 0.001, max: 1 },
    threshold: { type: "float", default: 0.5, min: 0, max: 1 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  if (sample_in(uv).r >= P.threshold) { return vec4f(1.0, 1.0, 1.0, 1.0); }
  let aspect = vec2f(G.resolution.y / G.resolution.x, 1.0);
  const RINGS = 24;
  const SPOKES = 32;
  var best = 1.0;
  for (var r = 1; r <= RINGS; r++) {
    let t = f32(r) / f32(RINGS);
    if (t >= best) { break; }
    for (var s = 0; s < SPOKES; s++) {
      // Every ring is turned by a different amount so gaps do not line up into streaks.
      let a = (f32(s) + fract(f32(r) * 0.6180339887)) / f32(SPOKES) * TAU;
      let o = vec2f(cos(a), sin(a)) * t * P.reach * 0.5 * aspect;
      let here = sample_in(uv + o).r;
      if (here >= P.threshold) {
        // Refine between this ring and the one before with the mask's own soft edge.
        let before = sample_in(uv + o * (1.0 - 1.0 / f32(r))).r;
        let f = clamp((P.threshold - before) / max(here - before, 1e-5), 0.0, 1.0);
        best = min(best, t - (1.0 - f) / f32(RINGS));
      }
    }
  }
  let v = 1.0 - clamp(best, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}`
})
