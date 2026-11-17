# 1 — Vision and Principles

## Problem

Making stylized VFX textures today means choosing between:

- **Substance Designer** — deep and powerful, but built for PBR materials, heavy, and only automatable through a separate toolkit.
- **Vefects / IlluGen** — built for VFX, fast to use, but closed: an AI agent can only drive them by clicking pixels.
- **AI image generators** — fast, but not controllable, not loopable, not channel-correct, and every frame drifts.

None of them lets an agent and an artist build the same graph together, see each other's changes, and iterate on the actual pixels.

## Product

A desktop node-graph editor for VFX textures and sprite sheets where:

1. The **artist** works visually, like in Vefects or Substance Designer.
2. The **agent** works through MCP on the same live document, like it does in Paper.
3. Both see the result instantly, and either can take over at any moment.

## Users

| User | Needs |
|---|---|
| VFX artist | Fast graph editing, great previews, presets, export straight to Unity |
| AI agent (Claude) | A complete, typed, text-level view of the graph; renders it can look at; atomic, undoable edits; no hidden state |
| Tech artist | Functions, exposed parameters, headless batch rendering, engine-ready channel packing |

## Principles

1. **One model, two front ends.** The UI and the MCP API call the same operations on the same document. Nothing can be done in the UI that the agent cannot do, and the reverse.
2. **Everything is data.** A graph is a readable, diffable text file. No binary blobs except embedded images.
3. **The agent must be able to see.** Any node, any frame, any channel can be rendered to PNG and returned to the agent, alone or side by side with a reference.
4. **Agent work is visible and reversible.** Agent edits arrive as named transactions, highlighted on the canvas, grouped in history, undoable in one step.
5. **Deterministic.** Same graph + same seed = same pixels, on every machine, in the UI and headless.
6. **Loops are exact.** Animated graphs loop without a seam by construction (periodic time), not by crossfading.
7. **Game-ready by default.** Straight or premultiplied alpha chosen explicitly, edge padding, power-of-two sizes, channel packing, engine metadata.
8. **Stylized first.** Cel bands, outlines, rim tones, chunky shapes and palette remaps are first-class nodes, not tricks.
9. **Quiet interface.** The textures are the loudest thing on screen. Chrome stays out of the way.
10. **Small core, many nodes.** Nodes are self-contained (shader + parameter schema). Adding a node never touches the engine.

## Non-goals (for now)

- PBR material authoring (Substance Designer keeps that job).
- 3D meshes (IlluGen's mesh side).
- Fluid simulation (EmberGen's job). Simulated frames can be imported as image sequences.
- Multi-user cloud collaboration. One human + agents on one machine.
