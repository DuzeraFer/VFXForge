import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "blend",
  category: "Blending",
  doc: "Puts fg over bg with a blend mode. Coverage is fg alpha × opacity × mask. Straight (not premultiplied) alpha in and out.",
  inputs: { fg: "image", bg: "image", mask: { type: "gray", optional: true } },
  outputs: { out: "color" },
  params: {
    mode: {
      type: "enum",
      default: "copy",
      options: ["copy", "add", "subtract", "multiply", "screen", "overlay", "max", "min", "divide", "difference", "soft_light"]
    },
    opacity: { type: "float", default: 1, min: 0, max: 1 }
  },
  wgsl: /* wgsl */ `
fn blend_colors(s: vec3f, d: vec3f) -> vec3f {
  switch P.mode {
    case 1u { return d + s; }
    case 2u { return d - s; }
    case 3u { return d * s; }
    case 4u { return 1.0 - (1.0 - d) * (1.0 - s); }
    case 5u { return select(1.0 - 2.0 * (1.0 - d) * (1.0 - s), 2.0 * d * s, d < vec3f(0.5)); }
    case 6u { return max(d, s); }
    case 7u { return min(d, s); }
    case 8u { return d / max(s, vec3f(1e-5)); }
    case 9u { return abs(d - s); }
    case 10u { return (1.0 - 2.0 * s) * d * d + 2.0 * s * d; }
    default { return s; }
  }
}

fn node(uv: vec2f) -> vec4f {
  let s = sample_fg(uv);
  let d = sample_bg(uv);
  var cover = s.a * P.opacity;
  if (has_mask) { cover *= sample_mask(uv).r; }
  // The blend mode only applies where the background exists.
  let mixed = mix(s.rgb, blend_colors(s.rgb, d.rgb), d.a);
  let alpha = cover + d.a * (1.0 - cover);
  let rgb = (mixed * cover + d.rgb * d.a * (1.0 - cover)) / max(alpha, 1e-6);
  return vec4f(rgb, alpha);
}`
})
