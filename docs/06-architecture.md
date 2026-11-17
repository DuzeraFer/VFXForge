# 6 — Architecture

## 6.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** (Windows x64, portable build) | Chromium ships WebGPU; Node in the main process hosts the MCP server; the same app runs headless with a hidden window. Paper is also a web-standards desktop app |
| UI | **React + TypeScript + Vite** | |
| Node canvas | **React Flow (@xyflow/react)** | Pan/zoom, selection, wires, minimap and custom node cards for free |
| State | One **document store** changed only through **operations** (the same ops `apply` accepts) | UI, undo/redo, MCP and file saves share one code path |
| GPU engine | **WebGPU + WGSL**, runs in the renderer process | Fast live previews; same code headless |
| MCP | **@modelcontextprotocol/sdk** in the Electron main process, streamable HTTP + stdio shim | |
| Image encode | `sharp` for PNG/JPG/TIFF, small built-in encoders for TGA/BMP | |
| Tests | Vitest for logic, golden-image tests for nodes (headless) | |

Rejected: Tauri (headless rendering and Node-based MCP are harder), native C++/Qt (slower UI iteration), Python (no good live GPU UI path).

## 6.2 Processes

```
┌───────────────────────── Electron main (Node) ─────────────────────────┐
│  MCP server (HTTP 127.0.0.1 + token)   File I/O   Export encoders      │
│        │ IPC: ops, queries, render requests                           │
└────────┼───────────────────────────────────────────────────────────────┘
         ▼
┌───────────────────────── Renderer (Chromium) ──────────────────────────┐
│  Document store ◄── ops ── UI (React Flow, Inspector, Preview)         │
│        │ change events                                                │
│        ▼                                                              │
│  Graph engine (WebGPU): scheduler · cache · node shaders              │
└────────────────────────────────────────────────────────────────────────┘
Headless mode = same renderer in a hidden window, no UI mounted.
```

## 6.3 Document model

```ts
type Project = {
  version: 1
  name: string
  seed: number
  graphs: Graph[]
  functions: Graph[]
  gradients: GradientLib[]
  references: Reference[]
  comments: CommentThread[]
}

type Graph = {
  id: string
  name: string
  settings: { width: number; height: number; frames: number; fps: number; loop: boolean; bitDepth: "8" | "16" | "16f" | "32f" }
  nodes: Node[]
  links: Link[]
  frames: CommentBox[]
  exposed: ExposedParam[]
}

type Node = {
  id: string
  type: string
  name?: string
  position: [number, number]
  params: Record<string, ParamValue>
  driven: Record<string, string>
  version: number
  locked?: boolean
  bypass?: boolean
}

type Link = { from: string; to: string }
```

- Saved as `name.vfxf` (pretty JSON, stable key order). Linked images live in `name_assets/` next to it.
- Only non-default params are written, so files and diffs stay small.

## 6.4 Operations, undo and history

- Every change is an `Op`. Applying an op returns its inverse. A **transaction** is a list of ops plus `{ label, author, timestamp }`.
- Undo/redo pops transactions. Selective undo of an agent transaction checks node versions first (see 05 §5.5).
- The UI produces ops too: dragging a slider makes one transaction on release (live preview during drag uses a transient value that is not recorded).

## 6.5 Node definition

Nodes are plain modules, discovered from `src/nodes/**`:

```ts
export default defineNode({
  type: "warp",
  category: "Transform",
  doc: "Offsets the input by a grayscale map. Strength in UV units.",
  inputs:  { in: "image", map: "gray" },
  outputs: { out: "same:in" },
  params: {
    intensity: { type: "float", default: 0.1, min: 0, max: 2, softMax: 1 },
    angle:     { type: "angle", default: 0 }
  },
  wgsl: /* wgsl */ `...`
})
```

- The inspector, `list_node_types`, validation and the file format all read this schema. Adding a node = adding one file.
- CPU-side nodes (Value, Math on values, Time) implement `evaluate(params, inputs)` instead of `wgsl`.
- Functions (user subgraphs) compile to the same interface.

## 6.6 Evaluation engine

- **Pull-based**: only nodes needed by something visible (thumbnails on screen, Preview, outputs being exported, agent renders) are evaluated.
- **Cache key** = hash(type, params, input keys, resolution, frame if time-dependent). Time dependence propagates: a node is time-dependent if any input is.
- **Dirty propagation**: a changed node invalidates downstream keys; evaluation is scheduled in topological order, coalesced per animation frame.
- **Textures**: `rgba16float` internally (gray uses one channel of `r16float`), converted at export.
- **Thumbnails**: rendered at 128 px from the full result; Preview at full resolution.
- **Animation**: the timeline evaluates frame `f` with `phase = f / frames`. Noises sample periodic domains in time, so frame `frames` equals frame 0 exactly.
- **Budget**: a long graph render reports progress; the UI stays responsive (work split across animation frames).
- **Determinism**: all randomness is seeded hashes in WGSL, no `Math.random`. Same GPU gives identical bytes; across GPUs the tolerance is ±1/255 (checked by golden tests).

## 6.7 Export

- Output nodes declare name, usage, format, bit depth, alpha mode.
- `Sheet Output` assembles frames with padding and edge dilation, then writes the sheet and a sidecar:

```json
{
  "tool": "VFXForge", "version": 1,
  "texture": "fire_cel_green_tex.png",
  "sheet": { "cols": 4, "rows": 4, "frames": 16, "fps": 12, "loop": true, "padding": 2 },
  "alpha": "straight",
  "usage": "color",
  "packing": null,
  "source": { "project": "fire.vfxf", "graph": "fire_cel_green", "seed": 7 }
}
```

## 6.8 Headless CLI

```
vfxforge render  project.vfxf [--graph g] [--output o] [--frame n|sheet] [--set key=value ...] [--seed n] [--out dir]
vfxforge export  project.vfxf [--preset unity] [--out dir]
vfxforge sweep   project.vfxf --param warp.intensity=0.2:0.6:5 --out dir
vfxforge mcp
```

The CLI starts the app with a hidden window, runs the job and exits. Same engine, same pixels.

## 6.9 Unity link

A small Unity editor package (lives in the Unity project, not in VFXForge):

- An `AssetPostprocessor` sees a texture with a `.vfxforge.json` sidecar and applies import settings: sRGB by usage, alpha is transparency, clamp wrap for sheets, mipmaps on, max size, compression.
- A menu command sets a selected `ParticleSystem`'s Texture Sheet Animation (tiles X/Y, frame over time, fps-derived cycles) and assigns the texture to its material instance on the project's shaders.
- Optional (P2): the export folder can point straight into `Assets/…/Textures/<Category>/`, so the scene updates on export.

## 6.10 Repository layout (new project)

```
vfxforge/
  docs/                  (this spec)
  electron/              main process: app, mcp server, file io, export, cli
  src/
    app/                 React shell, panels, theme tokens
    canvas/              React Flow node cards, wires, comments
    inspector/           schema-driven parameter UI, curve/gradient/spline editors
    preview/             preview pane, timeline, compare
    doc/                 document store, ops, history, serialization
    engine/              scheduler, cache, WebGPU device, shared WGSL (noise, sdf, hash)
    nodes/               one file per node type
    library/             shipped functions, gradients, example projects
  tests/
    golden/              per-node reference renders
```

## 6.11 Generated images (AI Image node)

The AI Image node is a texture source whose pixels come from an image model instead of a shader. It must not make graphs slow, costly or non-reproducible, so:

- **Generation is a deliberate action.** Changing the prompt marks the node "out of date" but calls nothing. Only the Generate button, or the agent's `generate_image` tool, makes a request. Each request costs money on the artist's own account.
- **The result is an asset.** The PNG is written to `<project>.assets/ai/<hash>.png` next to the `.vfxf`, and the node stores that path with the prompt and settings that produced it. Evaluation reads the file like Image Sample does, so rendering, golden tests and export never touch the network.
- **The key never leaves the main process.** It is entered in Settings, encrypted with the operating system's keychain (Electron `safeStorage`) in the user data folder, and used only for HTTPS requests from main to `api.openai.com`. It is never stored in a project, never sent to the renderer, never returned by any MCP tool, and never logged.
- **Transparency.** The request asks for a transparent background when the model supports it. Otherwise, or when the artist prefers, alpha is taken from luminance (white = opaque), which suits masks and glows. The node outputs the color image and a gray mask.
- **The agent.** The prompt and settings are ordinary parameters, so `set_params` and `get_node` cover them. `generate_image {graphId, nodeId}` starts a request and returns when the image is in the graph. It is refused unless the artist turned on "allow the agent to generate images", and a per-session limit caps the spend. The agent sees the image through `render`, never the key.
- **Failure is visible and harmless.** No key, no network, a refused prompt or a rate limit show as a message on the node; the previous image stays in place.

