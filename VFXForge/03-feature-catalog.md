# 3 — Feature Catalog

Every feature, grouped by area. Nodes themselves are listed in [04-node-library.md](04-node-library.md).
Sources: **[V]** Vefects · **[SD]** Substance Designer · **[P]** Paper · **[N]** new.

## 3.1 Project and files

| Feature | Source | Priority | Notes |
|---|---|---|---|
| Project file (one file, many graphs) | V SD | P0 | `.vfxf` — readable JSON (see architecture) |
| New / Open / Save / Save As | V | P0 | |
| Recent projects on Home tab | P | P0 | Thumbnail grid like Paper's Dashboard |
| Multiple open projects as tabs | P | P1 | |
| Save As versions (`name_v002`) | V | P1 | |
| Auto-save + backups (`.vfxf.bak`, rolling 10) | V | P0 | |
| Crash recovery on next launch | V | P1 | |
| Embedded vs linked images | SD | P1 | Linked = path relative to project; Embedded = copied into project folder |
| Dependency manager (missing images, relink) | SD | P2 | |
| Portable settings and profiles (export/import) | V | P1 | Hotkeys, preferences, libraries |
| Templates and example projects | V | P1 | Ship: Anime Star, Lightning, Random Flipbook, LUT [V]; Cel Fire, Slash Arc, Impact Burst, Smoke Puff, Magic Ring [N] |
| Git-friendly: stable key order, one node per line block | N | P0 | So diffs of agent edits are readable |

## 3.2 Graph editing

| Feature | Source | Priority |
|---|---|---|
| Infinite canvas, pan, zoom, grid snap | V SD | P0 |
| Space / Tab search to add nodes | V SD | P0 |
| Auto insert on wire drop, type-filtered | V | P0 |
| Drag node onto wire to insert | SD | P1 |
| Copy / paste / duplicate (links inside selection kept) | V SD | P0 |
| Undo / redo with history panel (human vs agent entries) | V SD N | P0 |
| Multi-select, box select | V SD | P0 |
| Comments / frames with title, color, markdown note | V SD | P1 |
| Reroute points | V SD | P1 |
| Auto-align selection | V SD | P1 |
| Frame graph on open; Frame selected / all | V SD | P0 |
| Wire styles: curved / angled / straight | V | P1 |
| Node bypass (pass-through first input) | SD | P1 |
| Node thumbnails on cards, toggleable | V SD | P0 |
| Pin a node to Preview | SD | P0 |
| Minimap | SD | P2 |
| Customizable hotkeys | V | P1 |
| Node color tags | SD | P2 |
| Find node by name / type / parameter value | N | P1 |
| Error states on nodes (red dot + message) | SD | P0 |

## 3.3 Image model

| Feature | Source | Priority | Notes |
|---|---|---|---|
| Grayscale vs color data types | SD | P0 | Gray = 1 channel, color = RGBA |
| Value types (float, float2, float3, float4, int, bool) | SD | P0 | For math and parameter inputs |
| Per-node resolution 4–2048 px | V | P0 | Absolute |
| Resolution relative to parent / input (×0.5, ×2) | SD | P1 | Graph-level "output size" drives everything |
| Up to 4096 px | SD | P2 | |
| Non-square resolution | SD | P1 | Needed for sheets (2048×1024) |
| Bit depth: 8-bit, 16-bit, 16F, 32F per node | SD | P1 | Internal default 16F |
| Tiling mode per node (tile / clamp / mirror) | V SD | P0 | Noises and warps respect it |
| Global seed + per-node seed | SD | P0 | Per-node seed = global + offset unless locked |
| Straight vs premultiplied alpha awareness | N | P0 | |
| Color space: sRGB for color, linear for gray/data | SD | P1 | |

## 3.4 Parameters and procedural control

| Feature | Source | Priority |
|---|---|---|
| Parameter schema per node (type, range, default, step, unit, group) | SD | P0 |
| Inspector auto-generated from the schema | SD | P0 |
| Drive any parameter from an input socket ("Parameter inputs") | V | P0 |
| Math node feeding parameters | V | P0 |
| Live Time node feeding parameters | V | P0 |
| Graph-level exposed parameters (with groups, labels, ranges) | SD | P1 |
| Parameter presets per graph (named sets of exposed values) | SD | P1 |
| Expressions in fields (`$time * 2`, `$seed + 3`) | SD | P1 |
| Function graphs / value processor | SD | P2 |
| Random seed button + lock | N | P0 |
| Parameter animation curves on the timeline (keyframes) | N | P2 |

## 3.5 Reuse

| Feature | Source | Priority | Notes |
|---|---|---|---|
| Functions / subgraphs with up to 16 inputs and 16 outputs | V SD | P1 | SD-style graph instances |
| Import / export functions as files | V | P1 | `.vfxfn` |
| Function library panel | V SD | P1 | |
| Gradient libraries (save, tag, import/export) | V | P1 | |
| Sample a gradient from an image | SD | P1 | Drag a line on a reference image |
| Node presets (saved parameter sets per node type) | SD | P2 | |
| Compiled graph package for headless use with exposed parameters | SD | P2 | Our `.sbsar` equivalent: `.vfxpkg` |

## 3.6 Animation and sprite sheets

| Feature | Source | Priority | Notes |
|---|---|---|---|
| Time node (normalized loop phase 0–1, frame index, seconds) | V | P0 | |
| Exact loops: periodic noise + phase-based time | N | P0 | Loop is guaranteed, not crossfaded |
| Frame count, fps, loop on/off at graph level | N | P0 | |
| Atlas / Pattern Grid node: frames or variations into one sheet | V | P0 | |
| Random Flipbook: N variations by seed into a sheet | V | P0 | |
| Timeline with play, scrub, fps | N | P0 | |
| Onion skin (previous/next frame ghosts) | N | P1 | |
| Seam check (last→first frame difference) | N | P1 | |
| Image sequence import (EmberGen / Blender renders) as an animated input | V N | P1 | Vefects mentions animated texture inputs |
| Motion vectors sheet export for flipbook blending | N | P2 | Unity Shader Graph flipbook blending |
| Per-frame parameter variation (jitter by frame) | N | P1 | |
| Sub-UV padding and edge dilation between frames | N | P0 | No bleeding at mip levels |

## 3.7 Preview

| Feature | Source | Priority |
|---|---|---|
| Live 2D preview of the selected or pinned node | V SD | P0 |
| Channels: RGB, RGBA, R, G, B, A, luminance | V SD | P0 |
| Zoom, Fit, 1:1, Tile 2×2 | V | P0 |
| Backgrounds: checker, black, white, custom, game backdrop | N | P0 |
| Sheet view + animated playback | N | P0 |
| A/B compare against a reference or snapshot | N | P1 |
| Pixel probe and histogram | SD | P1 |
| Snapshots (freeze current output for comparison) | N | P1 |
| Particle preview: the texture on a simple emitter, additive or alpha | N | P2 |
| Live link to Unity (texture hot-reloads in the open scene) | N | P2 |

## 3.8 Export

| Feature | Source | Priority | Notes |
|---|---|---|---|
| Formats: PNG, TGA, JPG, BMP, TIFF | V | P0 | |
| EXR for 16F / 32F | SD | P2 | |
| Output nodes with name, format, size, bit depth | SD | P0 | |
| Export all outputs in one go | SD | P0 | |
| File name templates (`{graph}_{output}_tex`) | SD | P1 | Default matches the `_tex` naming used in the fx project |
| Channel packing (R/G/B/A from different outputs) | SD N | P0 | |
| Straight or premultiplied alpha on export | N | P0 | |
| Power-of-two enforcement and padding | N | P1 | |
| Sidecar metadata JSON (rows, cols, frames, fps, loop, packing) | N | P0 | Read by the Unity importer |
| Engine export presets (Unity URP, Unreal) | V N | P1 | |
| Export to a watched folder inside a Unity project | N | P1 | |

## 3.9 AI link (details in 05)

| Feature | Source | Priority |
|---|---|---|
| Local MCP server exposing the full document model | P N | P0 |
| Shared selection with the agent | P | P0 |
| Agent presence on canvas and avatar | P | P0 |
| Agent edits as named, undoable transactions | P N | P0 |
| Render any node or frame to PNG for the agent | N | P0 |
| Side-by-side render with a reference image | N | P1 |
| Reference board the agent can read | N | P1 |
| Agent activity log panel | P | P1 |
| Comment threads on nodes the agent can read and answer | P | P1 |
| AI image generation into an Image node | P N | P2 |
| In-app prompt bar | N | P2 |
| Variation explorer: agent produces N candidates, artist picks | N | P2 |

## 3.10 Automation

| Feature | Source | Priority | Notes |
|---|---|---|---|
| Headless CLI: render / export a project | SD | P1 | Our `sbsrender` |
| CLI parameter overrides and seed sweeps | SD | P1 | |
| CLI batch across many projects | SD | P2 | |
| Same engine in UI and headless (identical pixels) | N | P0 | |

## 3.11 App

| Feature | Source | Priority |
|---|---|---|
| Windows 10/11 x64 portable build | V | P0 |
| Works offline, no account | V | P0 |
| Light and dark themes | V P | P1 |
| Changelog and About | V | P1 |
| Learn panel with short tutorials per node | V | P2 |
