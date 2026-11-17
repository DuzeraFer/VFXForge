import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "non_uniform_blur",
  category: "Filters",
  doc: "Blur whose strength varies over the image: sharp where the map is black, blurred by radius where it is white.",
  inputs: { in: "image", map: "gray" },
  outputs: { out: "same:in" },
  params: {
    radius: { type: "float", default: 0.05, min: 0, max: 0.5, softMax: 0.2, doc: "UV units, where the map is white." }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let r = P.radius * sample_map(uv).r;
  let aspect = vec2f(G.resolution.y / G.resolution.x, 1.0);
  const N = 96;
  var sum = sample_in(uv);
  for (var i = 0; i < N; i++) {
    sum += sample_in(uv + disc_point(i, N) * r * aspect);
  }
  return sum / f32(N + 1);
}`
})
