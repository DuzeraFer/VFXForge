import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "edge_detect",
  category: "Filters",
  doc: "White lines where the input changes quickly, black where it is flat. width is the line width in centered units; strength scales the result.",
  inputs: { in: "gray" },
  outputs: { out: "gray" },
  params: {
    width: { type: "float", default: 0.02, min: 0.001, max: 0.25 },
    strength: { type: "float", default: 1, min: 0, max: 16, softMax: 4 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let aspect = vec2f(G.resolution.y / G.resolution.x, 1.0);
  let e = P.width * 0.25 * aspect;
  var gx = 0.0;
  var gy = 0.0;
  // Sobel.
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let v = sample_in(uv + vec2f(f32(i), f32(j)) * e).r;
      gx += v * f32(i) * select(1.0, 2.0, j == 0);
      gy += v * f32(j) * select(1.0, 2.0, i == 0);
    }
  }
  let v = clamp(length(vec2f(gx, gy)) * 0.25 * P.strength, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}`
})
