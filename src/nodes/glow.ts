import { defineNode } from "../engine/nodeDef"
import { blurFn } from "../engine/snippets"

export default defineNode({
  type: "glow",
  category: "Filters",
  doc: "Adds a soft halo around the bright parts: out = in + tint × intensity × blur(in above threshold). On a color input the halo also adds to alpha.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    radius: { type: "float", default: 0.06, min: 0, max: 0.5, softMax: 0.2, doc: "UV units." },
    intensity: { type: "float", default: 1, min: 0, max: 8, softMax: 3 },
    threshold: { type: "float", default: 0, min: 0, max: 1, doc: "Only parts brighter than this glow." },
    tint: { type: "color", default: [1, 1, 1, 1] }
  },
  wgsl: /* wgsl */ `
fn bright(uv: vec2f) -> vec4f {
  let c = sample_in(uv);
  // Color is weighted by alpha so transparent pixels do not glow.
  let lit = max(c.rgb - P.threshold, vec3f(0.0)) / max(1.0 - P.threshold, 1e-4);
  return vec4f(lit * c.a, max(max(lit.r, lit.g), lit.b) * c.a);
}
fn blur_bright(uv: vec2f, radius: f32) -> vec4f {
  let aspect = vec2f(G.resolution.y / G.resolution.x, 1.0);
  var sum = vec4f(0.0);
  var total = 0.0;
  for (var y = -7; y <= 7; y++) {
    for (var x = -7; x <= 7; x++) {
      let o = vec2f(f32(x), f32(y)) / 7.0;
      let w = exp(-4.5 * dot(o, o));
      sum += w * bright(uv + o * 1.5 * radius * aspect);
      total += w;
    }
  }
  return sum / total;
}
fn node(uv: vec2f) -> vec4f {
  let c = sample_in(uv);
  let halo = blur_bright(uv, P.radius) * P.intensity;
  let rgb = c.rgb * c.a + halo.rgb * P.tint.rgb;
  let a = clamp(c.a + halo.a * P.tint.a, 0.0, 1.0);
  return vec4f(rgb / max(a, 1e-5), a);
}`
})
