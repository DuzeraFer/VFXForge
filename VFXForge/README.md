# VFXForge — Spec

A node-based VFX texture and sprite-sheet tool, built so a human and an AI agent work on the same graph at the same time.

- **Interface**: learned from Paper — quiet canvas, compact inspector, live agent presence.
- **Features**: the union of the Vefects Free VFX Texture Creator and Substance Designer, plus what real-time VFX for games needs (flipbooks, cel bands, channel packing, Unity export).
- **AI link**: a first-class MCP server. The agent reads, edits, renders and *looks at* the graph through the same model the UI uses. Every agent edit is visible, attributable and undoable.
- **Target look**: refined, very cartoony sprite sheets in the Brawl Stars style. See `reference/target_fire_cel_green.png`.

## Documents

| # | File | What it covers |
|---|---|---|
| 1 | [01-vision-and-principles.md](01-vision-and-principles.md) | Why the tool exists, who uses it, the rules every feature follows |
| 2 | [02-design-language.md](02-design-language.md) | Layout, panels, tokens, components, interaction patterns (from Paper + Vefects) |
| 3 | [03-feature-catalog.md](03-feature-catalog.md) | Every feature, grouped, with source (Vefects / Substance Designer / new) and priority |
| 4 | [04-node-library.md](04-node-library.md) | Every node: inputs, outputs, parameters, priority |
| 5 | [05-ai-integration.md](05-ai-integration.md) | MCP tools, agent presence, transactions, the see-and-iterate loop |
| 6 | [06-architecture.md](06-architecture.md) | Stack, graph format, GPU evaluation, files, headless CLI, Unity link |
| 7 | [07-roadmap.md](07-roadmap.md) | Step-by-step build order with acceptance checks |

## Priority legend

- **P0** — MVP. The tool is useless without it.
- **P1** — v1. Needed to replace Vefects for daily work.
- **P2** — v2. Substance Designer depth and AI extras.

## Source legend

- **[V]** Vefects Free VFX Texture Creator (v0.3.74)
- **[SD]** Adobe Substance 3D Designer
- **[P]** Paper (interface and agent patterns)
- **[N]** New — not in either tool

## Starting point

`Tools/VFXForge/vfxforge.py` in the `fx` Unity project is a throwaway Python prototype. It proves the target look is reachable procedurally: periodic noise → domain warp → erosion → three cel bands → gradient map → looping 4×4 sheet. Its logic becomes the first nodes (Periodic Noise, Warp, Flame Shape, Band, Gradient Map, Atlas). See `reference/prototype_fire_cel_green.png`.
