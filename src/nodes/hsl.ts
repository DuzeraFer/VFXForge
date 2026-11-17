import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "hsl",
  category: "Tone & Color",
  doc: "Shifts hue, saturation and lightness of a color image. hue is in turns (0.5 = the opposite color); saturation and lightness go from -1 to 1.",
  inputs: { in: "color" },
  outputs: { out: "color" },
  params: {
    hue: { type: "float", default: 0, min: -1, max: 1 },
    saturation: { type: "float", default: 0, min: -1, max: 1 },
    lightness: { type: "float", default: 0, min: -1, max: 1 }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let c = sample_in(uv);
  var hsl = rgb_to_hsl(clamp(c.rgb, vec3f(0.0), vec3f(1.0)));
  hsl.x = fract(hsl.x + P.hue + 1.0);
  hsl.y = clamp(select(hsl.y * (1.0 + P.saturation), hsl.y + (1.0 - hsl.y) * P.saturation, P.saturation > 0.0), 0.0, 1.0);
  hsl.z = clamp(select(hsl.z * (1.0 + P.lightness), hsl.z + (1.0 - hsl.z) * P.lightness, P.lightness > 0.0), 0.0, 1.0);
  return vec4f(hsl_to_rgb(hsl), c.a);
}`
})
