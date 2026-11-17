import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "normal_from_height",
  category: "Filters",
  doc: "Makes a normal map from a height map (white = high). opengl has green pointing up, as Unity expects; directx has it pointing down.",
  inputs: { in: "gray" },
  outputs: { out: "color" },
  params: {
    intensity: { type: "float", default: 1, min: 0, max: 32, softMax: 8 },
    format: { type: "enum", default: "opengl", options: ["opengl", "directx"] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let e = 1.0 / G.resolution;
  let dx = sample_in(uv + vec2f(e.x, 0.0)).r - sample_in(uv - vec2f(e.x, 0.0)).r;
  let dy = sample_in(uv + vec2f(0.0, e.y)).r - sample_in(uv - vec2f(0.0, e.y)).r;
  // Slopes per pixel pair, scaled so intensity 1 looks the same at any resolution.
  let s = P.intensity * G.resolution.x / 64.0;
  var n = normalize(vec3f(-dx * s, dy * s, 1.0));
  if (P.format == 1u) { n.y = -n.y; }
  return vec4f(n * 0.5 + 0.5, 1.0);
}`
})
