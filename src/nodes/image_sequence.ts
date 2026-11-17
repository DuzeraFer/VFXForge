import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "image_sequence",
  category: "Sources",
  doc: "A numbered run of image files (a simulation or a render from another tool) played as an animated input. The frames are packed into one sheet inside the project's assets folder when they are chosen in the inspector. Outputs the current frame and its alpha as a grayscale mask.",
  inputs: {},
  outputs: { out: "color", alpha: "gray" },
  params: {
    file: { type: "string", default: "", doc: "The packed frames, as a path inside the project's assets folder. Made with the button in the inspector." },
    cols: { type: "int", default: 1, min: 1, max: 64, doc: "Columns of the packed sheet. Set when the frames are chosen." },
    rows: { type: "int", default: 1, min: 1, max: 64, doc: "Rows of the packed sheet. Set when the frames are chosen." },
    count: { type: "int", default: 1, min: 1, max: 4096, doc: "How many frames the sequence holds. Set when the frames are chosen." },
    cell: { type: "vec2", default: [0, 0], min: 0, max: 8192, doc: "Size of one packed frame in pixels. Set when the frames are chosen." },
    offset: { type: "int", default: 0, min: -4096, max: 4096, doc: "Frames to start later (or earlier, when negative)." },
    playback: { type: "enum", default: "loop", options: ["loop", "hold", "ping_pong"], doc: "What happens past the last frame: start over, stay on it, or play backwards." },
    fit: { type: "bool", default: false, doc: "Stretch the whole sequence over the graph's frame count, so it loops with the graph." }
  },
  asset: "file",
  usesTime: true,
  wgsl: /* wgsl */ `
fn sequence_frame() -> i32 {
  let count = max(P.count, 1);
  var at = i32(floor(G.frame + 0.5));
  if (P.fit == 1u) { at = i32(floor(G.frame / max(G.frames, 1.0) * f32(count))); }
  at += P.offset;
  if (P.playback == 1u) { return clamp(at, 0, count - 1); }
  if (P.playback == 2u) {
    let period = max(2 * count - 2, 1);
    let back = ((at % period) + period) % period;
    if (back >= count) { return period - back; }
    return back;
  }
  return ((at % count) + count) % count;
}

fn node(uv: vec2f) -> vec4f {
  let at = sequence_frame();
  let cols = max(P.cols, 1);
  let grid = vec2f(f32(cols), f32(max(P.rows, 1)));
  // Half a pixel in from the edge of the frame, so a neighboring frame never bleeds in.
  let size = select(G.resolution, P.cell, P.cell.x >= 1.0 && P.cell.y >= 1.0);
  let inner = clamp(uv, 0.5 / size, 1.0 - 0.5 / size);
  let c = sample_asset((vec2f(f32(at % cols), f32(at / cols)) + inner) / grid);
  if (OUT == 1u) { return vec4f(c.a, c.a, c.a, 1.0); }
  return c;
}`
})
