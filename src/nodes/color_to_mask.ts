import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "color_to_mask",
  category: "Tone & Color",
  doc: "White where the image is close to color, black elsewhere. tolerance is how far a color may be; softness fades the edge.",
  inputs: { in: "color" },
  outputs: { out: "gray" },
  params: {
    color: { type: "color", default: [0, 1, 0, 1] },
    tolerance: { type: "float", default: 0.2, min: 0, max: 2 },
    softness: { type: "float", default: 0.1, min: 0, max: 1 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let c = sample_in(uv);
  let d = distance(c.rgb, P.color.rgb);
  let v = (1.0 - soft_step(P.tolerance, P.softness, d)) * c.a;
  return vec4f(v, v, v, 1.0);
}`
})
