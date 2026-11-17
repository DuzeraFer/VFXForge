import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "slope_blur",
  category: "Filters",
  doc: "Smears the image downhill along the slopes of a map, which gives painterly, wispy edges. Use a noise as the map. mode blur averages along the way; min and max let dark or bright parts spread.",
  inputs: { in: "image", map: "gray" },
  outputs: { out: "same:in" },
  params: {
    intensity: { type: "float", default: 0.1, min: -1, max: 1, doc: "How far it smears, UV units." },
    samples: { type: "int", default: 16, min: 1, max: 32 },
    mode: { type: "enum", default: "blur", options: ["blur", "min", "max"] }
  },
  wgsl: /* wgsl */ `
fn slope(uv: vec2f) -> vec2f {
  let e = 1.0 / 128.0;
  return vec2f(
    sample_map(uv + vec2f(e, 0.0)).r - sample_map(uv - vec2f(e, 0.0)).r,
    sample_map(uv + vec2f(0.0, e)).r - sample_map(uv - vec2f(0.0, e)).r
  ) * 8.0;
}
fn node(uv: vec2f) -> vec4f {
  var q = uv;
  var acc = sample_in(uv);
  let step_len = P.intensity / f32(P.samples);
  for (var i = 0; i < P.samples; i++) {
    q += slope(q) * step_len;
    let c = sample_in(q);
    switch P.mode {
      case 1u { acc = min(acc, c); }
      case 2u { acc = max(acc, c); }
      default { acc += c; }
    }
  }
  if (P.mode == 0u) { acc = acc / f32(P.samples + 1); }
  return acc;
}`
})
