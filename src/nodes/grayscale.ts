import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "grayscale",
  category: "Tone & Color",
  doc: "Turns a color image into gray. weights are how much red, green and blue count; alpha multiplies the result when use_alpha is on.",
  inputs: { in: "color" },
  outputs: { out: "gray" },
  params: {
    red: { type: "float", default: 0.2126, min: 0, max: 1 },
    green: { type: "float", default: 0.7152, min: 0, max: 1 },
    blue: { type: "float", default: 0.0722, min: 0, max: 1 },
    use_alpha: { type: "bool", default: false }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let c = sample_in(uv);
  var v = dot(c.rgb, vec3f(P.red, P.green, P.blue));
  if (P.use_alpha == 1u) { v *= c.a; }
  return vec4f(v, v, v, 1.0);
}`
})
