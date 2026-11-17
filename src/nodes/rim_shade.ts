import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "rim_shade",
  category: "Tone & Color",
  doc: "Cartoon shading on a shape. Takes a mask and returns three flat tones: 0 outside, 1 on a rim along the side facing angle, and level in the rest. Feed it to Palette Remap.",
  inputs: { in: "gray" },
  outputs: { out: "gray" },
  params: {
    angle: { type: "angle", default: 135, doc: "Where the light comes from. 90 = from above." },
    width: { type: "float", default: 0.08, min: 0, max: 1, doc: "Rim width in centered units." },
    level: { type: "float", default: 0.5, min: 0, max: 1, doc: "Gray of the shaded part." },
    threshold: { type: "float", default: 0.5, min: 0, max: 1 },
    softness: { type: "float", default: 0, min: 0, max: 1 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let inside = soft_step(P.threshold, P.softness, sample_in(uv).r);
  // Step toward the light: where that still lands inside the shape, the pixel is not on the lit rim.
  let toward = vec2f(cos(P.angle), -sin(P.angle)) * P.width * 0.5;
  let shade = soft_step(P.threshold, P.softness, sample_in(uv + toward).r);
  let v = inside * mix(1.0, P.level, shade);
  return vec4f(v, v, v, 1.0);
}`
})
