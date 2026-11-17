import { defineNode } from "../engine/nodeDef"
import { SPLINE_FN, SPLINE_PARAMS } from "../engine/snippets"

export default defineNode({
  type: "spline",
  category: "Splines",
  doc: "A smooth stroke through a list of points, with a width that follows profile along its length. curl bends it with noise. Outputs: out (mask or field), along (0 at the start to 1 at the end, inside the stroke), across (0 to 1 from one side to the other).",
  inputs: {},
  outputs: { out: "gray", along: "gray", across: "gray" },
  seeded: true,
  params: {
    ...SPLINE_PARAMS,
    softness: { type: "float", default: 0, min: 0, max: 1 },
    output: { type: "enum", default: "mask", options: ["mask", "field"] }
  },
  wgsl: /* wgsl */ `
${SPLINE_FN}
fn node(uv: vec2f) -> vec4f {
  let s = spline_at(centered(uv));
  let mask = sdf_fill(s.x, P.softness);
  var v: f32;
  if (OUT == 1u) { v = s.y * step(s.x, 0.0); }
  else if (OUT == 2u) { v = (s.z * 0.5 + 0.5) * step(s.x, 0.0); }
  else { v = select(mask, -s.x, P.output == 1u); }
  return vec4f(v, v, v, 1.0);
}`
})
