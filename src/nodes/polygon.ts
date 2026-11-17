import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "polygon",
  category: "Shapes",
  doc: "A regular polygon, or a star when inner is below 1. Sizes are in centered units (the image spans -1 to 1).",
  inputs: {},
  outputs: { out: "gray" },
  params: {
    sides: { type: "int", default: 5, min: 3, max: 64 },
    radius: { type: "float", default: 0.6, min: 0, softMax: 1 },
    inner: { type: "float", default: 1, min: 0.05, max: 1, doc: "1 = polygon. Lower values pull the edge midpoints in to make a star." },
    roundness: { type: "float", default: 0, min: 0, max: 0.5 },
    offset: { type: "vec2", default: [0, 0] },
    rotation: { type: "angle", default: 0 },
    softness: { type: "float", default: 0, min: 0, max: 1 },
    output: { type: "enum", default: "mask", options: ["mask", "field"] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let p = rotate2(centered(uv) - P.offset, -P.rotation);
  let d = sd_polygon(p, max(P.radius - P.roundness, 0.0), P.sides, P.inner) - P.roundness;
  let v = select(sdf_fill(d, P.softness), -d, P.output == 1u);
  return vec4f(v, v, v, 1.0);
}`
})
