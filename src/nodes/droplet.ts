import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "droplet",
  category: "Shapes",
  doc: "A spark or droplet: a round head with a tail that thins out behind it. rotation 0 points the head up. output=field is positive inside.",
  inputs: {},
  outputs: { out: "gray" },
  params: {
    length: { type: "float", default: 1, min: 0, max: 2, doc: "From the head's center to the end of the tail." },
    head: { type: "float", default: 0.2, min: 0, max: 1, doc: "Radius of the head." },
    taper: { type: "float", default: 1, min: 0.1, max: 6, doc: "1 = straight sides. Higher = the tail thins sooner." },
    offset: { type: "vec2", default: [0, 0.3], doc: "Where the head is." },
    rotation: { type: "angle", default: 0 },
    softness: { type: "float", default: 0, min: 0, max: 1 },
    output: { type: "enum", default: "mask", options: ["mask", "field"] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let p = rotate2(centered(uv) - P.offset, -P.rotation);
  let t = clamp(-p.y / max(P.length, 1e-5), 0.0, 1.0);
  let d = length(p - vec2f(0.0, -t * P.length)) - P.head * pow(1.0 - t, P.taper);
  let v = select(sdf_fill(d, P.softness), -d, P.output == 1u);
  return vec4f(v, v, v, 1.0);
}`
})
