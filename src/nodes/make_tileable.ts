import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "make_tileable",
  category: "Transform",
  doc: "Makes any image repeat without a seam, by fading its edges into a copy of itself shifted by half. The middle of the image is kept as it is. width is how far in from the edge the fade reaches.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    width: { type: "float", default: 0.25, min: 0.01, max: 0.5 }
  },
  wgsl: /* wgsl */ `
// Tileable left to right: near the side edges it fades into a copy shifted by half a width.
fn across(uv: vec2f) -> vec4f {
  let q = fract(uv);
  let w = smoothstep(0.0, P.width, min(q.x, 1.0 - q.x));
  return mix(sample_in(vec2f(fract(q.x + 0.5), q.y)), sample_in(q), w);
}
fn node(uv: vec2f) -> vec4f {
  let q = fract(uv);
  let w = smoothstep(0.0, P.width, min(q.y, 1.0 - q.y));
  return mix(across(vec2f(q.x, fract(q.y + 0.5))), across(q), w);
}`
})
