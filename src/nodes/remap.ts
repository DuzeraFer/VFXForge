import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "remap",
  category: "Tone & Color",
  doc: "Maps the range in_min to in_max onto out_min to out_max. With clamp on, values outside stay at the ends. Use it to turn a signed field into 0 to 1, or to limit a value.",
  inputs: { in: "gray" },
  outputs: { out: "gray" },
  params: {
    in_min: { type: "float", default: 0 },
    in_max: { type: "float", default: 1 },
    out_min: { type: "float", default: 0 },
    out_max: { type: "float", default: 1 },
    clamp: { type: "bool", default: true }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let span = P.in_max - P.in_min;
  var t = (sample_in(uv).r - P.in_min) / select(span, 1e-6, abs(span) < 1e-6);
  if (P.clamp == 1u) { t = clamp(t, 0.0, 1.0); }
  let v = mix(P.out_min, P.out_max, t);
  return vec4f(v, v, v, 1.0);
}`
})
