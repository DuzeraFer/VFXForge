import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "palette_remap",
  category: "Tone & Color",
  doc: "Colors a grayscale input through a gradient (gradient map). For cel bands from Band, put one stop at each band level (0, 1/N, … 1) with hardness 0: flat bands land exactly on the stops and edges stay anti-aliased. A stop's hardness (0–1) sharpens the blend arriving at it.",
  inputs: { in: "gray" },
  outputs: { out: "color" },
  params: {
    gradient: {
      type: "gradient",
      default: [
        { position: 0, color: [0, 0, 0, 1] },
        { position: 1, color: [1, 1, 1, 1] }
      ]
    }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  return gradient_gradient(clamp(sample_in(uv).r, 0.0, 1.0));
}`
})
