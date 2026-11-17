import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "shape",
  category: "Shapes",
  doc: "A basic anti-aliased shape. Sizes are in centered units (the image spans -1 to 1). output=field gives the signed distance (positive inside) for Band and Erosion.",
  inputs: {},
  outputs: { out: "gray" },
  params: {
    shape: { type: "enum", default: "circle", options: ["circle", "square", "rounded_rect", "ring", "capsule"] },
    size: { type: "vec2", default: [0.5, 0.5], min: 0, doc: "Half width and half height. Circle and ring use x as the radius." },
    roundness: { type: "float", default: 0.1, min: 0, max: 1, doc: "Corner radius of rounded_rect." },
    thickness: { type: "float", default: 0.1, min: 0, max: 1, doc: "Line width of ring." },
    offset: { type: "vec2", default: [0, 0] },
    rotation: { type: "angle", default: 0 },
    softness: { type: "float", default: 0, min: 0, max: 1 },
    output: { type: "enum", default: "mask", options: ["mask", "field"] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let p = rotate2(centered(uv) - P.offset, -P.rotation);
  var d: f32;
  switch P.shape {
    case 1u { d = sd_box(p, P.size, 0.0); }
    case 2u { d = sd_box(p, P.size, min(P.roundness, min(P.size.x, P.size.y))); }
    case 3u { d = abs(sd_circle(p, P.size.x)) - P.thickness * 0.5; }
    case 4u {
      let r = min(P.size.x, P.size.y);
      let half = max(P.size.x - r, 0.0);
      d = sd_segment(p, vec2f(-half, 0.0), vec2f(half, 0.0)) - r;
    }
    default { d = sd_circle(p, P.size.x); }
  }
  let v = select(sdf_fill(d, P.softness), -d, P.output == 1u);
  return vec4f(v, v, v, 1.0);
}`
})
