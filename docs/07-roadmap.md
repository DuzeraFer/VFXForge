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

**Accept**: a 16-frame looping cel-fire sheet exports with zero seam error and plays correctly in Preview.

## Phase 5 — Export and Unity link

1. Export formats PNG, TGA, JPG, BMP, TIFF; bit depth; straight/premultiplied alpha.
2. Output naming templates, export all, packed outputs, sidecar JSON.
3. `export` MCP tool and CLI `render` / `export`.
4. Unity editor package: importer from sidecar + particle Texture Sheet Animation setup.

**Accept**: one click (or one agent call) exports the fire sheet into the Unity project; it imports with correct settings and plays on a particle system with no manual steps.

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

## Phase 7 — Reuse and library

1. Functions/subgraphs (16 in / 16 out), create from selection, import/export.
2. Exposed graph parameters and presets.
3. Gradient libraries, sample gradient from image.
4. Shipped stylized functions (04 §4.12) and example projects (Vefects set + ours).
5. Comments/frames, reroutes, auto-align, wire styles, custom hotkeys, settings profiles.

**Accept**: the artist builds a new effect mostly from shipped functions; Claude can list and use them through MCP.

## Phase 8 — AI v2

1. Reference board + `add_reference` / `list_references` / `render_compare`.
2. Comment threads on nodes with agent replies.
3. Snapshots and A/B compare.
4. Variation explorer (seed and parameter sweeps into a pick grid); CLI `sweep`.
5. `apply_text` (compact graph text as input).
6. More image providers for the AI Image node (Phase 3b), and image-to-image from a node's output.
7. In-app prompt bar.

**Accept**: given only the reference fire image on the board, the agent produces a sheet the artist judges "same style", with at most three rounds of comment feedback.

## Phase 9 — Depth and polish (P2)

Substance Designer depth (Tile Sampler, Iterate, Bevel, Flood Fill, function graphs, 4096 px, EXR, `.vfxpkg` packages), particle preview, Unity live link, minimap, Learn panel, dependency manager, crash-recovery polish.

## Working rules for the build

- Every node ships with: schema, WGSL, doc string, golden test, one example in a library graph.
- Every UI feature is reachable as an op, so MCP coverage is automatic; Phase 3 tests list any op the UI uses that MCP cannot call.
- After each phase, re-render the cel-fire reference and compare it with `reference/target_fire_cel_green.png`. Keep the comparison images in `docs/progress/`.
