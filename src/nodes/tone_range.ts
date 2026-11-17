import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "tone_range",
  category: "Tone & Color",
  doc: "Stretches one part of the gray range to fill black to white: values around position, range wide, become 0 to 1. contrast bends the result into an S.",
  inputs: { in: "gray" },
  outputs: { out: "gray" },
  params: {
    position: { type: "float", default: 0.5, min: 0, max: 1 },
    range: { type: "float", default: 0.5, min: 0.001, max: 2 },
    contrast: { type: "float", default: 0, min: 0, max: 1 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let x = clamp((sample_in(uv).r - P.position) / P.range + 0.5, 0.0, 1.0);
  let v = mix(x, x * x * (3.0 - 2.0 * x), P.contrast);
  return vec4f(v, v, v, 1.0);
}`
})
