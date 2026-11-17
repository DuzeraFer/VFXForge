import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "fractal",
  category: "Noises",
  doc: "Layered noise, 0 to 1. kind: fbm (cloudy), billow (puffy) or ridged (veins). Tiles when scale is a whole number; evolution 0 to 1 loops seamlessly.",
  inputs: {},
  outputs: { out: "gray" },
  seeded: true,
  params: {
    kind: { type: "enum", default: "fbm", options: ["fbm", "billow", "ridged"] },
    scale: { type: "float", default: 3, min: 0.01, softMax: 32, max: 512 },
    octaves: { type: "int", default: 5, min: 1, max: 8 },
    gain: { type: "float", default: 0.5, min: 0, max: 1 },
    evolution: { type: "float", default: 0 },
    loops: { type: "int", default: 2, min: 1, max: 16 },
    contrast: { type: "float", default: 1, min: 0, softMax: 4, max: 16 },
    offset: { type: "vec2", default: [0, 0] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let base = vec3f((uv + P.offset) * P.scale, fract(P.evolution) * f32(P.loops));
  let period = vec3i(vec2i(i32(ceil(P.scale))), P.loops);
  var sum = 0.0;
  var amplitude = 1.0;
  var total = 0.0;
  var scale = 1;
  for (var o = 0; o < P.octaves; o++) {
    let n = perlin3(vec3f(base.xy * f32(scale), base.z), vec3i(period.xy * scale, period.z), G.seed + u32(o) * 1013u);
    var layer: f32;
    switch P.kind {
      case 1u { layer = abs(n) * 2.0 - 1.0; }
      case 2u { layer = 1.0 - abs(n) * 2.0; layer = layer * abs(layer); }
      default { layer = n; }
    }
    sum += amplitude * layer;
    total += amplitude;
    amplitude *= P.gain;
    scale *= 2;
  }
  let v = clamp(sum / max(total, 1e-6) * 0.5 * P.contrast + 0.5, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}`
})
