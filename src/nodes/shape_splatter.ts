import { defineNode } from "../engine/nodeDef"
import { stampFn } from "../engine/snippets"

export default defineNode({
  type: "shape_splatter",
  category: "Patterns",
  doc: "Scatters copies of a shape at random places, sizes and angles. Connect any image as the shape (a disc without one). Always tiles. evolution moves every copy on a small loop (0 to 1 is one loop).",
  inputs: { in: { type: "image", optional: true } },
  outputs: { out: "same:in" },
  seeded: true,
  params: {
    density: { type: "int", default: 6, min: 1, max: 48, doc: "About density × density copies." },
    amount: { type: "float", default: 1, min: 0, max: 1, doc: "Share of the copies that are drawn." },
    scale: { type: "float", default: 0.6, min: 0, max: 2, doc: "Size relative to the spacing." },
    scale_jitter: { type: "float", default: 0.5, min: 0, max: 1 },
    rotation_jitter: { type: "float", default: 1, min: 0, max: 1 },
    value_jitter: { type: "float", default: 0, min: 0, max: 1 },
    evolution: { type: "float", default: 0 },
    blend: { type: "enum", default: "max", options: ["max", "add"] }
  },
  wgsl: /* wgsl */ `
${stampFn("in")}
fn node(uv: vec2f) -> vec4f {
  let n = P.density;
  let g = fract(uv) * f32(n);
  let base = vec2i(floor(g));
  var acc = vec4f(0.0);
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let cell = base + vec2i(i, j);
      let key = vec3i(((cell.x % n) + n) % n, ((cell.y % n) + n) % n, 0);
      if (hash3(key, G.seed + 11u) >= P.amount) { continue; }
      let r = hash3_2(key, G.seed);
      let spin = TAU * (P.evolution + hash3(key, G.seed + 13u));
      let center = vec2f(cell) + r + 0.2 * vec2f(cos(spin), sin(spin)) * step(1e-6, abs(fract(P.evolution)));
      let size = P.scale * (1.0 - P.scale_jitter * hash3(key, G.seed + 3u));
      let angle = (hash3(key, G.seed + 5u) - 0.5) * TAU * P.rotation_jitter;
      let d = (g - center) * vec2f(1.0, -1.0) / max(size, 1e-5);
      let c = stamp_in(rotate2(d, -angle)) * (1.0 - P.value_jitter * hash3(key, G.seed + 7u));
      if (P.blend == 1u) { acc += c; } else { acc = max(acc, c); }
    }
  }
  return clamp(acc, vec4f(0.0), vec4f(1.0));
}`
})
