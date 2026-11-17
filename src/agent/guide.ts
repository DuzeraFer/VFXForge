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

## Animation and sprite sheets

An animated graph has frames > 1 (set_graph). Everything that moves is driven by \`time\`: its \`phase\` runs 0 to 1 over the loop, and the noises' \`evolution\` is periodic, so frame N is exactly frame 0 and loops never pop. Drive with \`phase\`, \`sin\` or \`cos\`; \`frame\` and \`seconds\` do not wrap smoothly.

End an animation with a \`sheet_output\` node instead of (or next to) \`output\`: it lays every frame out in one grid (cols 0 = squarest), with optional padding around each frame and color dilation under transparent pixels. Rendering it shows the whole sheet. \`random_flipbook\` makes a grid of seed variations of one image, and \`pattern_grid\` puts up to eight different images in one atlas. To judge motion, use \`render_frames\` on the node that feeds the sheet and \`measure\` with motion: true: loopSeamRatio near 1 means the step from the last frame to the first is like every other step.

## More building blocks

- Shapes for effects: anime_star (sparkles, impacts), slash_arc, burst, droplet, lightning, spline and trail (a texture laid along a spline; drive scroll with Time.phase).
- Cartoon shading: rim_shade gives a lit rim and a shaded body from one mask; outline draws a line around it; glow adds a halo. Follow them with palette_remap.
- Movement that loops: curl_distort, clouds, bnw_spots, band_noise and curl_noise all take evolution, where 0 to 1 is one seamless loop. histogram_scan with position driven by Time.phase dissolves a shape.
- polar wraps a tiling noise into rings and vortexes; mirror with mode radial makes kaleidoscopes; make_tileable removes seams.
- When no node does what you need, write it: pixel_expression takes a WGSL function body (see its doc in list_node_types), and value_expression takes a formula for driving parameters, e.g. 0.5 + 0.2 * sin(phase). A mistake in either comes back as a problem on the node, with the compiler's message.
- packed_output stores a different gray image in each channel of one texture.

## Functions, exposed parameters and presets

A function is a graph used as one node. \`list_functions\` shows the ones in the project and the recipes that ship with VFXForge; \`add_function\` copies a recipe in. Start from a recipe when the artist asks for one of those effects, then set its parameters (palette, wobble, ...) instead of rebuilding it. The artist can open the function and change what is inside; so can you, with \`get_graph\` and \`apply\` on its graph id, and every node that uses it follows.

To make your own: \`create_graph\` with function: true, build inside it, bring pictures in through \`graph_input\` nodes (param name; kind gray or color; fill is used when nothing is connected) and send them out through \`output\` nodes. Its node type is fn_<graph id>. A function cannot use itself. \`create_function\` turns nodes that are already in a graph into one.

\`expose_param\` shows a node's parameter at graph level: the artist gets the few controls that matter in one place, and on a function they become the parameters of its node. Expose the palette and two or three shape controls, with a label. \`set_presets\` stores named sets of values for the exposed parameters (for example three palettes), which the artist switches with one click.

## Export

When the artist asks for files, call \`export\`. It writes every Output and Sheet Output (or the ones you name) with a sidecar JSON next to each texture, which the Unity importer uses to set up the texture and a particle system's sheet animation. Leave \`folder\` out unless the artist named one.

## Generated pictures (AI Image node)

For shapes that are hard to build from noise and primitives (a hand-drawn smoke puff, a slash, a rune, a splash), add an \`ai_image\` node. Set its \`prompt\` with apply: describe one subject, its style ("flat cel-shaded", "soft painterly"), and what stays empty. \`mode\` "transparent" asks for a transparent background; "mask" asks for a bright subject on black and uses brightness as alpha, which suits anything you will band and recolor. The node outputs \`out\` (color) and \`mask\` (gray): feed \`mask\` to band, erosion or palette_remap like any other shape.

The picture is drawn only when the artist presses Generate, or when you call \`generate_image\`, which uses their paid OpenAI account. That tool is off unless the artist turned it on, and is limited per session. If it is refused, leave the prompt in place and tell the artist it is ready for them to generate. Never loop on it: look at each result with render before asking for another.

## Rules of the road

- Data types: gray, color, value. A gray input does not accept color. Value outputs (time, value, math) drive parameters with drive_param; they do not plug into image inputs.
- Only parameters that differ from the defaults are stored; \`null\` in set_params resets one.
- Angles are degrees. Colors are [r, g, b, a] from 0 to 1.
- Leave positions out; the app places your nodes. Name nodes when the name helps the artist ("Warp noise").
- Use \`ifVersion\` when you change a node you read a while ago; the artist may have touched it. Locked nodes are off limits.
- An error from \`apply\` means nothing changed. Read it, fix the operation, send the batch again.
`
