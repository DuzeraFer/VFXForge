import { defineNode } from "../engine/nodeDef"

const LAYERS = ["layer1", "layer2", "layer3", "layer4", "layer5", "layer6"] as const

const step = (name: string, index: number): string => `
  if (has_${name}) {
    let s = sample_${name}(uv);
    let cover = s.a * layer_opacity(${index}u);
    let mixed = mix(s.rgb, blend_colors(s.rgb, acc.rgb), acc.a);
    let alpha = cover + acc.a * (1.0 - cover);
    acc = vec4f((mixed * cover + acc.rgb * acc.a * (1.0 - cover)) / max(alpha, 1e-6), alpha);
  }`

export default defineNode({
  type: "multi_blend",
  category: "Blending",
  doc: "Stacks up to six layers in one node, layer1 at the bottom. Every layer is put over the ones below with the same blend mode; opacities holds one opacity per layer, in order. Unconnected layers are skipped. Straight alpha in and out.",
  inputs: Object.fromEntries(LAYERS.map((name) => [name, { type: "image" as const, optional: true }])),
  outputs: { out: "color" },
  params: {
    mode: {
      type: "enum",
      default: "copy",
      options: ["copy", "add", "subtract", "multiply", "screen", "overlay", "max", "min", "divide", "difference", "soft_light"]
    },
    opacities: { type: "floatList", default: [1, 1, 1, 1, 1, 1], maxLength: 6, min: 0, max: 1, doc: "Opacity of layer1 to layer6. A layer past the end of the list is fully opaque." }
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

fn layer_opacity(i: u32) -> f32 {
  if (i >= P.opacities_count) { return 1.0; }
  return clamp(P_opacities(i), 0.0, 1.0);
}

fn node(uv: vec2f) -> vec4f {
  var acc = vec4f(0.0);
${LAYERS.map(step).join("")}
  return acc;
}`
})
