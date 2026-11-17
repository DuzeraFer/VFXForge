import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "reroute",
  category: "Math",
  doc: "A point on a wire, for tidy routing. It passes the image on unchanged. Double-click a wire to add one.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {},
  passthrough: true,
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  return sample_in(uv);
}`
})
