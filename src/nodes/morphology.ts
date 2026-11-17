import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "morphology",
  category: "Filters",
  doc: "Grows (dilate) or shrinks (erode) the bright parts by radius, in centered units. Good up to about 0.2; for more, chain two.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    mode: { type: "enum", default: "dilate", options: ["dilate", "erode"] },
    radius: { type: "float", default: 0.05, min: 0, max: 0.5 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let aspect = vec2f(G.resolution.y / G.resolution.x, 1.0);
  var acc = sample_in(uv);
  const N = 128;
  for (var i = 0; i < N; i++) {
    let c = sample_in(uv + disc_point(i, N) * P.radius * 0.5 * aspect);
    if (P.mode == 1u) { acc = min(acc, c); } else { acc = max(acc, c); }
  }
  return acc;
}`
})
