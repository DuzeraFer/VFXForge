# VFXForge

A node-based VFX texture and sprite-sheet tool, built so a human and an AI agent work on the same graph at the same time.

The full spec lives in [`docs/`](docs/README.md). Build order and acceptance checks are in [`docs/07-roadmap.md`](docs/07-roadmap.md).

## Status

**Phase 2 — Editor.** The node canvas, library, schema-driven inspector, gradient editor, Preview controls, timeline and history panel are in, in the dark "Bench" design (a light theme is one click away). A graph can be built by hand from an empty project. The agent link (MCP) comes in Phase 3.

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
