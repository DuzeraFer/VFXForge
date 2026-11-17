import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "curl_noise",
  category: "Noises",
  doc: "A swirling flow field as a color image: red is the push to the right, green the push up, both around mid gray. Plug it into Vector Warp, or export it as a flow map. Tiles when scale is a whole number; evolution 0 to 1 is one loop.",
  inputs: {},
  outputs: { out: "color" },
  seeded: true,
  params: {
    scale: { type: "float", default: 3, min: 1, softMax: 16, max: 128 },
    strength: { type: "float", default: 1, min: 0, max: 8, softMax: 2 },
    evolution: { type: "float", default: 0 },
    loops: { type: "int", default: 1, min: 1, max: 16 },
    offset: { type: "vec2", default: [0, 0] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let s = i32(ceil(P.scale));
  let flow = curl2(vec3f((uv + P.offset) * P.scale, fract(P.evolution) * f32(P.loops)), vec3i(s, s, P.loops), G.seed);
  // Image y points down, the flow's green points up.
  let f = clamp(vec2f(flow.x, -flow.y) * 0.25 * P.strength, vec2f(-1.0), vec2f(1.0));
  return vec4f(f * 0.5 + 0.5, 0.5, 1.0);
}`
})
