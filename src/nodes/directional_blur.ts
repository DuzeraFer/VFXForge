import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "directional_blur",
  category: "Filters",
  doc: "Motion blur along one direction. length is in UV units. one_sided smears only backward, like a trail.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    angle: { type: "angle", default: 0 },
    length: { type: "float", default: 0.1, min: 0, max: 1 },
    one_sided: { type: "bool", default: false }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let dir = vec2f(cos(P.angle), -sin(P.angle)) * P.length;
  const N = 48;
  var sum = vec4f(0.0);
  for (var i = 0; i < N; i++) {
    let t = (f32(i) + 0.5) / f32(N);
    sum += sample_in(uv + dir * select(t - 0.5, -t, P.one_sided == 1u));
  }
  return sum / f32(N);
}`
})
