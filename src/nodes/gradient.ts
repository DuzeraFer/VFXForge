import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "gradient",
  category: "Shapes",
  doc: "A grayscale ramp from 0 to 1: linear (along the rotation), radial (from the center out) or angular (around the center).",
  inputs: {},
  outputs: { out: "gray" },
  params: {
    kind: { type: "enum", default: "linear", options: ["linear", "radial", "angular"] },
    rotation: { type: "angle", default: 0 },
    offset: { type: "vec2", default: [0, 0] },
    scale: { type: "float", default: 1, min: 0.001, softMax: 4 },
    repeat: { type: "bool", default: false }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let p = rotate2(centered(uv) - P.offset, -P.rotation) / P.scale;
  var v: f32;
  switch P.kind {
    case 1u { v = length(p); }
    case 2u { v = fract(atan2(p.y, p.x) / TAU + 1.0); }
    default { v = p.x * 0.5 + 0.5; }
  }
  v = select(clamp(v, 0.0, 1.0), fract(v), P.repeat == 1u);
  return vec4f(v, v, v, 1.0);
}`
})
