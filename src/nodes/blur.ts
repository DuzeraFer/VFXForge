import { defineNode } from "../engine/nodeDef"
import { blurFn } from "../engine/snippets"

export default defineNode({
  type: "blur",
  category: "Filters",
  doc: "Gaussian blur. radius is in UV units (0.05 = 5% of the image), so the look is the same at any resolution.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    radius: { type: "float", default: 0.03, min: 0, max: 0.5, softMax: 0.2 }
  },
  wgsl: /* wgsl */ `
${blurFn("in")}
fn node(uv: vec2f) -> vec4f {
  return blur_in(uv, P.radius);
}`
})
