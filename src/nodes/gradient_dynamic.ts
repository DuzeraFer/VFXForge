import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "gradient_dynamic",
  category: "Tone & Color",
  doc: "Colors a grayscale input with a gradient that is itself a picture: the gray value picks a place along one line of the gradient input (0 at its start, 1 at its end). Use it when the palette is painted, generated or animated by other nodes; for fixed colors Palette Remap is simpler.",
  inputs: { in: "gray", gradient: "image" },
  outputs: { out: "same:gradient" },
  params: {
    direction: { type: "enum", default: "horizontal", options: ["horizontal", "vertical"], doc: "Which way the gradient picture is read: left to right, or bottom to top." },
    position: { type: "float", default: 0.5, min: 0, max: 1, doc: "Which line of the gradient picture is read: 0 is the top row (or left column), 1 the bottom row (or right column). Drive it to move through a picture of several palettes." },
    by_position: { type: "bool", default: false, doc: "Read the line at each pixel's own height (or width) instead of at position, so the palette changes across the image." }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  // Half a pixel in from the ends, so the first and last colors are read exactly.
  let edge = 0.5 / G.resolution;
  let t = clamp(sample_in(uv).r, 0.0, 1.0);
  if (P.direction == 1u) {
    let across = select(P.position, uv.x, P.by_position == 1u);
    return sample_gradient(vec2f(clamp(across, edge.x, 1.0 - edge.x), mix(1.0 - edge.y, edge.y, t)));
  }
  let across = select(P.position, uv.y, P.by_position == 1u);
  return sample_gradient(vec2f(mix(edge.x, 1.0 - edge.x, t), clamp(across, edge.y, 1.0 - edge.y)));
}`
})
