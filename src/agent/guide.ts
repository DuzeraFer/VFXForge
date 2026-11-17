/** Returned by `get_guide`: the intended agent workflow (docs/05 §5.6). */
export const GUIDE = `# Working in VFXForge

VFXForge is a node editor for stylized game VFX textures and sprite sheets. You edit the same live graph the artist is looking at: every \`apply\` appears on their canvas as one undoable step with your label.

## The loop

1. \`get_basic_info\` and \`get_selection\` to see the project and what the artist is focused on. \`get_graph\` before editing an existing graph.
2. \`list_node_types\` once to learn the library; query it for the parameter schema of a type before you use it.
3. Plan the graph in a few lines.
4. Build in small \`apply\` batches: one visual idea per batch (the base shape; then the distortion; then the bands; then the color).
5. After every batch or two, \`render\` what you changed and \`measure\` it. Do not stack edits on something you have not looked at.
6. Go through the review checklist, fix what fails, then \`finish_working\` with a one-line summary.

## Review checklist (say one line per item before you finish)

- Silhouette: reads at game size, chunky rather than noisy. measure: few islands, no tiny ones.
- Bands: clean flat cel bands in sensible proportions. measure: dominantColors shares.
- Edges: anti-aliased, and the shape does not touch the frame border. measure: touchesEdge.any is false.
- Loop: seamless. measure with motion: loopSeamRatio near 1.
- Motion: frames change enough but not wildly. measure with motion: frameToFrame.
- Alpha: correct on dark and light. render with background "black" and "white".

## Cel-shaded fire, the house recipe

time -> two perlin noises (evolution driven by time.phase, so they loop) -> flame_shape -> warp (shape by the first noise) -> erosion (by the second noise) -> band (thresholds cut the field into flat levels) -> palette_remap (one gradient stop at each band level 0, 1/N, ... 1, hardness 0, first stop alpha 0) -> output.

Set warp and erosion "tiling" to "clamp" so the flame does not wrap around the frame. Animated graphs need frames > 1 in the graph settings (set_graph).

## Rules of the road

- Data types: gray, color, value. A gray input does not accept color. Value outputs (time, value, math) drive parameters with drive_param; they do not plug into image inputs.
- Only parameters that differ from the defaults are stored; \`null\` in set_params resets one.
- Angles are degrees. Colors are [r, g, b, a] from 0 to 1.
- Leave positions out; the app places your nodes. Name nodes when the name helps the artist ("Warp noise").
- Use \`ifVersion\` when you change a node you read a while ago; the artist may have touched it. Locked nodes are off limits.
- An error from \`apply\` means nothing changed. Read it, fix the operation, send the batch again.
`
