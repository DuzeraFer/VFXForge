import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "band",
  category: "Tone & Color",
  doc: "Cuts the input into flat cel bands. With N thresholds the output takes N+1 even gray levels (0, 1/N, … 1), stepping up at each threshold with an anti-aliased edge. Feed it to Palette Remap with stops at those levels.",
  inputs: { in: "gray" },
  outputs: { out: "gray" },
  params: {
    thresholds: { type: "floatList", default: [0.25, 0.5, 0.75], maxLength: 8 },
    softness: { type: "float", default: 0, min: 0, max: 1 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let x = sample_in(uv).r;
  let count = P.thresholds_count;
  var sum = 0.0;
  for (var i = 0u; i < count; i++) {
    sum += soft_step(P_thresholds(i), P.softness, x);
  }
  let v = sum / f32(max(count, 1u));
  return vec4f(v, v, v, 1.0);
}`
})
