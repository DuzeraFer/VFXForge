import { defineNode } from "../engine/nodeDef"
import { stampFn } from "../engine/snippets"

export default defineNode({
  type: "tile_generator",
  category: "Patterns",
  doc: "Repeats a shape on a grid, with random changes per tile. Connect any image as the shape (a disc without one). Always tiles. Where tiles overlap the brightest wins.",
  inputs: { in: { type: "image", optional: true } },
  outputs: { out: "same:in" },
  seeded: true,
  params: {
    columns: { type: "int", default: 4, min: 1, max: 64 },
    rows: { type: "int", default: 4, min: 1, max: 64 },
    scale: { type: "float", default: 0.9, min: 0, max: 3, doc: "Size of the shape relative to its cell. Up to 3 is drawn in full." },
    scale_jitter: { type: "float", default: 0, min: 0, max: 1 },
    rotation: { type: "angle", default: 0 },
    rotation_jitter: { type: "float", default: 0, min: 0, max: 1, doc: "1 = any angle." },
    position_jitter: { type: "float", default: 0, min: 0, max: 1, doc: "1 = anywhere in its cell." },
    row_offset: { type: "float", default: 0, min: 0, max: 1, doc: "Shifts every other row sideways, in cells. 0.5 = brick pattern." },
    value_jitter: { type: "float", default: 0, min: 0, max: 1, doc: "Darkens tiles by a random amount." }
  },
  wgsl: /* wgsl */ `
${stampFn("in")}
fn node(uv: vec2f) -> vec4f {
  let grid = vec2i(P.columns, P.rows);
  let g = fract(uv) * vec2f(grid);
  var acc = vec4f(0.0);
  let row_base = i32(floor(g.y));
  for (var j = -1; j <= 1; j++) {
    let row = row_base + j;
    let wrapped_row = ((row % grid.y) + grid.y) % grid.y;
    let shift = P.row_offset * f32(wrapped_row % 2);
    let col_base = i32(floor(g.x - shift));
    for (var i = -1; i <= 1; i++) {
      let col = col_base + i;
      let key = vec3i(((col % grid.x) + grid.x) % grid.x, wrapped_row, 0);
      let r = hash3_2(key, G.seed);
      let center = vec2f(f32(col) + 0.5 + shift, f32(row) + 0.5) + (r - 0.5) * P.position_jitter;
      let size = P.scale * (1.0 - P.scale_jitter * hash3(key, G.seed + 3u));
      let angle = P.rotation + (hash3(key, G.seed + 5u) - 0.5) * TAU * P.rotation_jitter;
      // Cell units to stamp units: y flips because stamps are y up.
      let d = (g - center) * vec2f(2.0, -2.0) / max(size, 1e-5);
      let c = stamp_in(rotate2(d, -angle)) * (1.0 - P.value_jitter * hash3(key, G.seed + 7u));
      acc = max(acc, c);
    }
  }
  return acc;
}`
})
