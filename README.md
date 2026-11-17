# VFXForge

A node-based VFX texture and sprite-sheet tool, built so a human and an AI agent work on the same graph at the same time.

The full spec lives in [`docs/`](docs/README.md). Build order and acceptance checks are in [`docs/07-roadmap.md`](docs/07-roadmap.md).

## Status

**Phase 3 — Agent link.** Claude can now build and edit graphs in the running app through MCP while you watch: its nodes arrive with a clay outline, every step is one entry in the activity log, and each can be undone on its own. The editor from Phase 2 (canvas, inspector, gradient editor, Preview, timeline, history) is in the dark "Bench" design. Next: the AI Image node (Phase 3b), then animation and sprite sheets.

## Connect Claude

With VFXForge open, click **Connect Claude** in the title bar. It copies one command; run it once in a terminal:

```
claude mcp add vfxforge -- "C:\path\to\VFXForge.exe" mcp
```

Then ask Claude Code something like "build a cel-shaded fire in VFXForge". The app listens only on this computer, and only for clients that hold the token in its settings folder (`mcp.json`).

- If the app is open, Claude edits the graph you are looking at.
- If it is not, the same command works without a window: `VFXForge.exe mcp project.vfxf` opens that project, and `save_project` writes it back.
- Clients that speak HTTP can connect to the `url` in `mcp.json` with the header `Authorization: Bearer <token>`.

Tools: `get_guide`, `get_basic_info`, `get_selection`, `get_graph`, `get_node`, `list_node_types`, `get_history`, `render`, `render_frames`, `measure`, `apply`, `create_graph`, `set_selection`, `save_project`, `finish_working`. See `docs/05-ai-integration.md`.

![Cel fire sheet rendered by the engine](docs/progress/phase-1-cel-fire.png)

## Develop

Requires Node 22+.

```
npm install
npm run dev        # run the app with hot reload
npm run typecheck
npm test                 # unit tests
npm run test:golden      # renders every golden case headless and compares with tests/golden/expected
npm run build            # bundle main, preload and renderer into out/
npm run dist             # Windows portable .exe into release/ (run on Windows)
```

Open a project at startup by passing its path, for example `npm run preview -- src/library/examples/cel_fire.vfxf`.

### Headless rendering

The same engine runs without a window:

```
npx electron . render src/library/examples/cel_fire.vfxf --frame sheet --bg 2a1f2b --out renders
npx electron . golden tests/golden [--update]
```

On a machine without a GPU, set `VFXFORGE_SOFTWARE_GPU=1` (and on Linux run under `xvfb-run`).

### Adding a node

Add one file in `src/nodes/` that default-exports `defineNode({...})`: sockets, parameter schema, doc string and a WGSL `fn node(uv: vec2f) -> vec4f`. Then add a graph that uses it to `tests/golden/cases/nodes.vfxf` and run `npm run test:golden:update`.

Every push also builds the portable Windows `.exe` in GitHub Actions (artifact `VFXForge-portable`).

## Layout

```
docs/        the spec, plus progress screenshots
electron/    main process, preload, file I/O, headless commands
src/
  app/       React shell, panels, theme tokens, document session
  doc/       document model, ops, history, .vfxf format
  engine/    node API, validation, shader generation, evaluator, shared WGSL
  nodes/     one file per node type
  preview/   preview pane
  headless/  engine entry without UI
  library/   example projects
tests/
  golden/    cases (.vfxf) and expected renders
```
