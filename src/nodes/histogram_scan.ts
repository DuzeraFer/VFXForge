import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "histogram_scan",
  category: "Tone & Color",
  doc: "A sliding threshold. position 0 gives black, 1 gives white; in between, more of the input's bright parts show. Drive position with Time for a dissolve. contrast 1 is a hard edge.",
  inputs: { in: "gray" },
  outputs: { out: "gray" },
  params: {
    position: { type: "float", default: 0.5, min: 0, max: 1 },
    contrast: { type: "float", default: 0.8, min: 0, max: 1 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let x = sample_in(uv).r;
  let width = max(1.0 - P.contrast, max(fwidth(x), 1e-4));
  let edge = mix(1.0 + width * 0.5, -width * 0.5, P.position);
  let v = clamp((x - edge) / width + 0.5, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}`
})
