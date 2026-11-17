import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "levels",
  category: "Tone & Color",
  doc: "Remaps tones: in_low..in_high is stretched to out_low..out_high, with gamma bending the middle. Alpha is untouched.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    in_low: { type: "float", default: 0, softMin: 0, softMax: 1 },
    in_high: { type: "float", default: 1, softMin: 0, softMax: 1 },
    gamma: { type: "float", default: 1, min: 0.01, max: 10, softMax: 4 },
    out_low: { type: "float", default: 0, softMin: 0, softMax: 1 },
    out_high: { type: "float", default: 1, softMin: 0, softMax: 1 },
    clamp: { type: "bool", default: true }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let c = sample_in(uv);
  let span = P.in_high - P.in_low;
  var t = (c.rgb - P.in_low) / select(span, 1e-6, abs(span) < 1e-6);
  if (P.clamp == 1u) { t = clamp(t, vec3f(0.0), vec3f(1.0)); }
  t = sign(t) * pow(abs(t), vec3f(1.0 / P.gamma));
  return vec4f(mix(vec3f(P.out_low), vec3f(P.out_high), t), c.a);
}`
})
