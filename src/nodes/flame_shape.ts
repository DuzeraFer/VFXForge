import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "flame_shape",
  category: "Shapes",
  doc: "A teardrop: a round bulb that tapers up to a tip. Centered units (-1 to 1, y up). output=field gives the signed distance (positive inside) for Warp, Erosion and Band.",
  inputs: {},
  outputs: { out: "gray" },
  params: {
    bulb_y: { type: "float", default: -0.4, min: -1, max: 1 },
    bulb_r: { type: "float", default: 0.4, min: 0, max: 1 },
    tip_y: { type: "float", default: 0.6, min: -1, softMax: 1, max: 2 },
    taper: { type: "float", default: 1, min: 0.2, max: 4, doc: "1 = straight sides. Higher = thinner toward the tip." },
    lean: { type: "float", default: 0, min: -1, max: 1, doc: "Moves the tip sideways." },
    softness: { type: "float", default: 0, min: 0, max: 1 },
    output: { type: "enum", default: "field", options: ["mask", "field"] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let p = centered(uv);
  let a = vec2f(0.0, P.bulb_y);
  let b = vec2f(P.lean, P.tip_y);
  let ba = b - a;
  let t = clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  // Bend the spine so a leaning flame curves instead of tilting.
  let spine = a + ba * t + vec2f(P.lean * (t * t - t), 0.0);
  let d = length(p - spine) - P.bulb_r * pow(1.0 - t, P.taper);
  let v = select(sdf_fill(d, P.softness), -d, P.output == 1u);
  return vec4f(v, v, v, 1.0);
}`
})
