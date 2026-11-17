import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "output",
  category: "Outputs",
  doc: "Marks an image as a result of the graph. name becomes the exported file name; usage and alpha tell the game engine how to import it.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    name: { type: "string", default: "output" },
    usage: { type: "enum", default: "color", options: ["color", "mask", "erosion", "flow", "normal"] },
    alpha: { type: "enum", default: "straight", options: ["straight", "premultiplied"] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  return sample_in(uv);
}`
})
