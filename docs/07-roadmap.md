# 7 — Roadmap

Build order, step by step. Each phase ends with an **acceptance check** that must pass before the next phase starts. The first real milestone is Phase 3: an agent builds the cel-fire sheet from an empty graph while the artist watches.

## Phase 0 — Skeleton

1. Electron + React + TypeScript + Vite app, portable Windows build.
2. Theme tokens (02 §2.4), light and dark.
3. Shell layout: title bar with tabs, left panel, tool strip, canvas area, right column (Preview + Inspector), collapsible timeline.
4. WebGPU device init with a clear error screen if unavailable.

**Accept**: the app opens as a portable build, shows the empty layout in both themes, and draws a WGSL test pattern in Preview.

## Phase 1 — Document and engine core

1. Document model, ops, transactions, undo/redo (06 §6.3–6.4).
2. Save / open `.vfxf`, auto-save, backups.
3. Node definition API (06 §6.5) and schema validation.
4. Scheduler, cache, dirty propagation, time-dependent evaluation (06 §6.6).
5. Shared WGSL library: hash, periodic noise, SDF helpers, AA threshold.
6. First nodes (P0 core): Uniform Color, Value, Time, Image Sample, Shape, Polygon, Gradient, Perlin, Fractal, Voronoi, Transform 2D, Warp, Levels, Threshold, Band, Palette Remap, Blend, Channels Merge/Split, Output.
7. Golden-image test harness running headless.

**Accept**: a hand-written `.vfxf` of the cel fire (the prototype's logic) renders the same look as `reference/prototype_fire_cel_green.png`; golden tests pass headless.

## Phase 2 — Editor UX

1. React Flow canvas with node cards (thumbnail, sockets, status) and type-colored wires.
2. Node library panel with search; Space/Tab search at cursor; auto insert on wire drop.
3. Schema-driven inspector: prefixed number fields with scrubbing, sliders, segmented controls, color field, seed field, enum dropdowns.
4. Gradient editor with hard stops and a library; curve editor.
5. Preview pane: channels, zoom, Fit, 1:1, Tile 2×2, backgrounds, pin node.
6. Copy/paste, duplicate, multi-select, frame selected/all, frame on open.
7. History panel.

**Accept**: the artist rebuilds the cel fire graph by hand in under 5 minutes without touching the file.

## Phase 3 — AI link v1  ★ first real milestone

1. MCP server in main (HTTP + token), stdio shim `vfxforge mcp`.
2. Read tools: `get_basic_info`, `get_selection`, `get_graph` (compact text), `get_node`, `list_node_types`, `get_history`.
3. See tools: `render`, `render_frames`, `measure` (coverage, bbox, histogram, islands, edge touching, seam error).
4. Write tools: `apply` with all ops, `create_graph`, `finish_working`.
5. Presence: avatar, clay highlights, fade-in of new nodes, activity log panel.
6. Attribution in history, one-step undo of agent transactions, node versions + `ifVersion`.
7. `get_guide` returning the agent workflow and review checklist (05 §5.6).

**Accept**: from an empty project, Claude (through Claude Code + MCP) builds a cel-fire graph, renders it, measures it, fixes at least one issue it found, and finishes — while the artist watches it build node by node and can undo it in one step.

## Phase 3b — AI Image node

Texture sources made by an image model, as a normal node (04 §4.1, 06 §6.11). Comes right after Phase 3 and must not delay it.

1. Image textures in the engine: asynchronous loading, the project assets folder, Image Sample node (carried over from Phase 1).
2. OpenAI key in Settings: stored encrypted on this machine by the main process, never written to a project file, never visible to the renderer or to the agent.
3. AI Image node: prompt, transparent background or grayscale-to-alpha, size and quality; a Generate button with progress, errors and the last result kept until a new one arrives.
4. Results saved as PNG in the project assets folder, so a project opens, renders and exports without a network or a key.
5. Agent access: the prompt is an ordinary parameter (`set_params`); a `generate_image` tool starts generation, behind an "allow the agent to generate images" setting with a per-session limit.

Status: built and checked end to end against a stand-in for OpenAI on the test machine. Not yet run against the real API (that needs the artist's key).

**Accept**: with a key set, typing "stylized flame silhouette, white on black" and pressing Generate gives a texture that feeds Band and Palette Remap like any other node; Claude can write the prompt and trigger generation through MCP; the saved project reopens offline with the same image.

## Phase 4 — Animation and sprite sheets

1. Graph frames/fps/loop settings; timeline with play, scrub, fps.
2. Exact-loop guarantees for all noises (periodic time domain).
3. Pattern Grid / Atlas, Random Flipbook, Sheet Output with padding and edge dilation.
4. Sheet view and animated playback in Preview; onion skin; seam check.
5. Image Sequence input.

Status: 1 to 4 are built. Loops are exact by construction (every frame number is wrapped into the loop, and noise evolution is periodic). Still open: Image Sequence input (5), and Pattern Grid taking one animated input instead of separate images. Writing the sheet and its sidecar to disk from the app is Phase 5; until then `vfxforge render` and the agent's `render` tool produce the PNG.

**Accept**: a 16-frame looping cel-fire sheet exports with zero seam error and plays correctly in Preview.

## Phase 5 — Export and Unity link

1. Export formats PNG, TGA, JPG, BMP, TIFF; bit depth; straight/premultiplied alpha.
2. Output naming templates, export all, packed outputs, sidecar JSON.
3. `export` MCP tool and CLI `render` / `export`.
4. Unity editor package: importer from sidecar + particle Texture Sheet Animation setup.

**Accept**: one click (or one agent call) exports the fire sheet into the Unity project; it imports with correct settings and plays on a particle system with no manual steps.

Status: 1 to 4 are built, except packed outputs (channel packing), which moves to Phase 6 with the Math nodes; the sidecar's `packing` field is always `null` for now. Export from the dialog, the agent's `export` tool and `vfxforge export` write the same files and are checked end to end. The Unity package in `unity/com.vfxforge.link` is written against Unity 2021.3 but has not been run in Unity yet, so the last half of the acceptance check is still to be confirmed on a real project.

## Phase 6 — Node library breadth (P1)

Add the P1 nodes from 04, in this order, each with a golden test:

1. Stylization: Rim / Inner Shade, Outline, Erosion, Glow, Curves, Tone Range, Histogram Scan, HSL.
2. Shapes: Anime Star, Flame Shape, Slash Arc, Burst, Droplet, Spline (with width profile and curl), Lightning, Trail.
3. Distortion: Polar ↔ Cartesian, Curl Distort, Twirl, Directional Warp, Vector Warp, Mirror/Symmetry, Make Tileable.
4. Filters: Directional / Radial / Non-Uniform / Slope Blur, Dilate/Erode, Edge Detect, Distance, Normal from Height.
5. Patterns: Tile Generator, Shape Splatter, Splatter Circular.
6. Noises: Clouds, BnW Spots, Anisotropic, Curl Noise, White Noise.
7. Math: Random, Switch, Pixel Expression (WGSL snippet), Value Expression.

**Accept**: all 04 P0 + P1 nodes exist, are documented in `list_node_types`, and pass golden tests.

Status: built, with a golden image for every node type (a unit test fails if a node has none). Also added from the P0 list: Blur, Invert, Grayscale, Remap, Premultiply, Band Noise, Packed Output; and Color to Mask from P1. Notes on how some were done:

- Every node is still one pass. Blur, Glow, Outline, Dilate/Erode and Distance take many samples per pixel instead of several passes, so they are exact for small radii and estimates for large ones (their docs say up to where). Distance at 1024 px takes seconds on a software GPU.
- Spline, Trail, Curves and the width profiles take their points as lists of numbers. Dragging points on the canvas is not built yet.
- Directional Warp is its own node as well as a mode of Warp.
- Pixel Expression code is compiled into the node's shader. `loop`, `while`, a `for` without an end condition and binding declarations are refused before compiling; a compile error is reported on the node.

Not built, moved to Phase 7 because they need the function and exposed-parameter work: Graph Input, Image Sequence, Gradient Dynamic (Palette Remap covers the common case), Multi Blend.

## Phase 7 — Reuse and library

1. Functions/subgraphs (16 in / 16 out), create from selection, import/export.
2. Exposed graph parameters and presets.
3. Gradient libraries, sample gradient from image.
4. Shipped stylized functions (04 §4.12) and example projects (Vefects set + ours).
5. Comments/frames, reroutes, auto-align, wire styles, custom hotkeys, settings profiles.

**Accept**: the artist builds a new effect mostly from shipped functions; Claude can list and use them through MCP.

Status: items 1, 2 and the functions of item 4 are built.

- A function is a graph marked "Use as a node". Its **Graph Input** nodes are its inputs, its Output nodes its outputs and its pinned parameters its parameters; its node type is `fn_<graph id>`. Before rendering, every function node is replaced by a copy of the function's nodes, so the engine still sees one flat graph and functions cost nothing extra. Functions can use functions, eight deep; one that uses itself is reported on the node.
- **Make a function** (Inspector, with several nodes selected) moves the selection into a new function and wires one node in its place. **Save as a file…** writes a `.vfxfn` (the function and the functions it uses); **Open a function file…** in the Library brings one into another project.
- The pin next to a parameter shows it at graph level, under Parameters in the graph's Inspector. **Presets** are named sets of those values.
- Seven recipes ship in `src/library/functions/` and are listed under Recipes in the Library: Cel Fire, Cel Smoke Puff, Slash Arc, Impact Burst, Magic Ring, Lightning Bolt, Dissolve Mask. Using one copies it into the project, where it can be opened and changed. A golden case renders each, and a unit test keeps that case equal to the shipped files.
- Claude has `list_functions`, `add_function` (copy a recipe), `create_function` (from nodes), `create_graph` with `function`, and `expose_param` / `unexpose_param` / `set_presets` in `apply`.

Built after Phase 8, as one follow-up (items 3 and 5, and two of the nodes):

- **Gradients saved with the project.** In a gradient's editor, **Save to project** keeps it under a name; the Library list shows the project's gradients above the built-in ones. Saving under a name that exists replaces it. Claude has `list_gradients` and the `save_gradient` / `remove_gradient` ops in `apply`.
- **Gradient from a picture.** **From a picture…** opens a reference; drag a line across it and the colors under the line become the gradient. Flat cel colors become stops with hard edges, a smooth change becomes evenly spaced soft stops. Claude's `sample_gradient` does the same with two points.
- **Frames.** G, or the Frame tool, puts a titled box around the selected nodes. A frame has no place of its own: it is drawn around its nodes and follows them, and it goes away with its last node. Double-click the title to rename; click it to select what is inside. Claude has `add_frame` / `remove_frame`, and `get_graph` lists frames.
- **Reroute points.** Double-click an image wire (or click it with the Reroute tool, R) to add a point. It is a node of type `reroute` that passes the image on unchanged.
- **Multi Blend** stacks up to six layers with one blend mode and an opacity per layer. **Image Sequence** plays a numbered run of image files: the frames are picked together, packed into one sheet (at most 4096 px on a side, scaled down if needed) and stored with the project's images; playback loops, holds or ping-pongs, or is stretched over the graph's frame count.
- **Hotkeys** for tools, nodes, view and playback can be changed in Settings. Save, undo, copy and paste follow the system and are fixed. They are kept per computer, not in the project.

Not built yet: the 16 in / 16 out limit is not enforced (there is no limit), example projects beyond the cel fire, wire styles, settings profiles (export and import of hotkeys and preferences), Gradient Dynamic, and picking the frames of an Image Sequence through MCP.

## Phase 8 — AI v2

1. Reference board + `add_reference` / `list_references` / `render_compare`.
2. Comment threads on nodes with agent replies.
3. Snapshots and A/B compare.
4. Variation explorer (seed and parameter sweeps into a pick grid); CLI `sweep`.
5. `apply_text` (compact graph text as input).
6. More image providers for the AI Image node (Phase 3b), and image-to-image from a node's output.
7. In-app prompt bar.

**Accept**: given only the reference fire image on the board, the agent produces a sheet the artist judges "same style", with at most three rounds of comment feedback.

Status: items 1 to 5 are built. The acceptance run itself needs the artist and a real agent; it has not been done.

- **References** (left panel): pictures with a note each, stored with the project's images. Claude has `list_references`, `get_reference`, `add_reference` (an image file by its full path; only PNG, JPEG and WebP are read) and `render_compare`, which returns the render and the reference side by side with the dominant colors of both.
- **Comments** (Inspector): threads on a node or on the graph. A node with open threads shows a count. Claude has `list_comments` (threads whose last word is the artist's are marked as waiting), `comment` and `reply` (with `resolve`). One list covers what the spec called `get_comment_thread`.
- **Snapshots**: the Snapshot button in the Preview, or Claude's `snapshot`, keeps a PNG of the current frame (the newest 40 are kept). **Compare** in the Preview shows a reference or snapshot right of a split that can be dragged.
- **Variations**: `render_variations` renders up to 16 versions (other seeds or parameter values) in one grid without touching the graph; with `offer` the artist gets the grid and a click applies that version as their own undoable step. **Seeds** in the Preview does the same for eight seeds. `vfxforge sweep project.vfxf --param node.param=from:to:count` (or `--seed from:to`) writes one PNG per value and a contact sheet.
- `apply_text` takes a whole graph in the text form `get_graph` returns and applies the difference as one step. Text read from `get_graph` and sent back unchanged does nothing.
- References, comments and snapshots are changed through ops like everything else, so they undo, and they are saved in the `.vfxf`.

Not built: more image providers and image-to-image for the AI Image node (item 6), the in-app prompt bar (item 7), comments pinned to a point on the canvas or to a frame, and "Ask Claude about this node" as a menu entry (a comment on the node does the same).

## Phase 9 — Depth and polish (P2)

Substance Designer depth (Tile Sampler, Iterate, Bevel, Flood Fill, function graphs, 4096 px, EXR, `.vfxpkg` packages), particle preview, Unity live link, minimap, Learn panel, dependency manager, crash-recovery polish.

## Working rules for the build

- Every node ships with: schema, WGSL, doc string, golden test, one example in a library graph.
- Every UI feature is reachable as an op, so MCP coverage is automatic; Phase 3 tests list any op the UI uses that MCP cannot call.
- After each phase, re-render the cel-fire reference and compare it with `reference/target_fire_cel_green.png`. Keep the comparison images in `docs/progress/`.
