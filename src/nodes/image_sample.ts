import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "image_sample",
  category: "Sources",
  doc: "An image file (PNG, JPEG or WebP) stretched over the frame. The file is copied into the project's assets folder, so the project keeps working when the original moves. Outputs the picture and its alpha as a grayscale mask.",
  inputs: {},
  outputs: { out: "color", alpha: "gray" },
  params: {
    file: { type: "string", default: "", doc: "The image, as a path inside the project's assets folder. Chosen with the button in the inspector." }
  },
  asset: "file",
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let c = sample_asset(uv);
  if (OUT == 1u) { return vec4f(c.a, c.a, c.a, 1.0); }
  return c;
}`
})
