import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "voronoi",
  category: "Noises",
  doc: "Cell noise, 0 to 1. output: distance (dark cell centers), edges (bright cell borders) or cells (one random gray per cell). Tiles when scale is a whole number.",
  inputs: {},
  outputs: { out: "gray" },
  seeded: true,
  params: {
    scale: { type: "float", default: 6, min: 1, softMax: 32, max: 256 },
    jitter: { type: "float", default: 1, min: 0, max: 1, doc: "0 = a regular grid." },
    output: { type: "enum", default: "distance", options: ["distance", "edges", "cells"] },
    evolution: { type: "float", default: 0, doc: "Moves the cell points on small loops. 0 to 1 is one seamless loop." },
    offset: { type: "vec2", default: [0, 0] }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let cells = voronoi3(vec3f((uv + P.offset) * P.scale, fract(P.evolution)), vec2i(i32(ceil(P.scale))), P.jitter, G.seed);
  var v: f32;
  switch P.output {
    case 1u { v = 1.0 - clamp((cells.f2 - cells.f1) * 2.0, 0.0, 1.0); }
    case 2u { v = cells.id; }
    default { v = clamp(cells.f1, 0.0, 1.0); }
  }
  return vec4f(v, v, v, 1.0);
}`
})
