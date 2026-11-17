import { defineNode } from "../engine/nodeDef"
import { SPLINE_FN, SPLINE_PARAMS } from "../engine/snippets"

export default defineNode({
  type: "trail",
  category: "Splines",
  doc: "Lays a texture along a spline, like a ribbon: the input's x runs along the length and its y across the width. scroll moves the texture along the trail; drive it with Time.phase for a looping flow. Without an input it is a plain stroke.",
  inputs: { in: { type: "image", optional: true } },
  outputs: { out: "same:in" },
  seeded: true,
  params: {
    ...SPLINE_PARAMS,
    repeat: { type: "float", default: 1, min: 0.01, max: 32, doc: "How many times the texture fits along the trail." },
    scroll: { type: "float", default: 0, doc: "Whole numbers give the same image." },
    softness: { type: "float", default: 0, min: 0, max: 1 }
  },
  wgsl: /* wgsl */ `
${SPLINE_FN}
fn node(uv: vec2f) -> vec4f {
  let s = spline_at(centered(uv));
  let mask = sdf_fill(s.x, P.softness);
  if (!has_in) { return vec4f(mask, mask, mask, mask); }
  let c = sample_in(vec2f(fract(s.y * P.repeat - P.scroll), clamp(0.5 - s.z * 0.5, 0.0, 1.0)));
  // A gray result has no alpha to carry the stroke's shape, so the shape goes into the gray itself.
  if (gray_in) { return vec4f(c.rgb * mask, 1.0); }
  return vec4f(c.rgb, c.a * mask);
}`
})
