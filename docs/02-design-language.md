# 2 — Design Language

Learned from **Paper** (structure, density, agent presence) and **Vefects** (node cards, preview pane, curve editors). Restrained, editorial, neutral. The textures provide the color.

## 2.1 What we take from Paper

Observed on paper.design (Paper Desktop, 2026):

- **Three-zone layout**: left panel (pages + layer tree), thin vertical tool strip, center canvas, right inspector.
- **Document tabs** across the top (Dashboard, then one tab per open file with a doc icon and close ×).
- **Inspector sections** with a small label and chevron (`Layout ⌄`, `Flex`, `Radius`, `Blending`, `Fill`). Each section is a compact grid of fields.
- **Prefixed numeric fields**: a dim letter or icon inside the field (`X 500`, `Y 471`, `W 1075`, `H 649`, `∠ 0°`). Drag the prefix to scrub the value.
- **Segmented controls** for mode switches (`Solid | Gradient | Image`, direction arrows).
- **Slider + number** pairs (Radius).
- **Checkbox rows with the shortcut shown** on the right (`Clip content ⌥C`).
- **Presence row**: collaborator and agent avatars at the top of the inspector, next to a primary `Copy link ⌘L` button.
- **Live agent activity**: the canvas updates element by element while the agent works. The agent's tool calls read like a running log.
- **Agent tools are scoped and incremental**: get_basic_info → get_selection → small writes → screenshot → review → finish_working_on_nodes.
- **Footer links** in the left panel (`What's new • Feedback`).
- Small type (12–13 px), tight rows, neutral grays, a single blue for selection, almost no shadows.

## 2.2 What we take from Vefects

Observed on the Vefects interface screenshot (v0.3.74):

- **Top bar actions**: New, Open project, Save project, Save project as, Save backup, Recover project, Export image. Right side: Changelog, About, theme toggle.
- **Left node library**: a vertical list of nodes, each with a small thumbnail and name (read from a small screenshot, so some names are approximate: Shape, Polygon, Spline, Anime Star, Image Sample, Solid Color, Ramp, Perlin Noise, Fractal Noise, Gaussian Noise, Voronoi, Layer Mix, Normal Blend, Negative, Curves, Tone Range, Erosion, Input Gradient, Palette Remap, …).
- **Node cards**: a header with an icon, a title and status dots; a large thumbnail of the node's output; input sockets listed on the left with names (`curl seed`, `curl offset X`, `curl offset Y`); output socket on the right.
- **Split view**: graph on the left, a large **Preview** pane on the right with `Save image`. Under it: channel selector, zoom %, `Fit`, `Tile`.
- **Properties column** with sliders + numbers (Curl intensity, Curl scale, Curl seed, Curl offset X/Y), an inline **width-profile curve editor** with point type (Weighted) and Delete/Reset, an inline **spline point editor** (Add point / Delete point / Smooth), and a **Parameter inputs** list showing which parameters are driven by sockets (`Curl offset X ← Time`).
- **Graph footer**: Auto align, + Comment, Connections: angled.
- A pattern of Time → Spline → Glow → Palette Remap feeding one **Pattern Grid** node that assembles several variations into one sheet.

## 2.3 Our layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◧ VFXForge   [Home] [fire_cel_green ×] [slash_arc ×]          ○○● Claude  ⋯  │  title + tabs + presence
├────────────┬──┬──────────────────────────────────────┬───────────────────────┤
│ GRAPHS     │▸ │                                      │  PREVIEW              │
│  fire      │✋│          node graph canvas           │  ┌─────────────────┐  │
│  ⤷ core    │▭ │                                      │  │                 │  │
│ LIBRARY    │✎ │    [Noise]──[Warp]──[Band]──[Out]    │  │   texture /     │  │
│  ⌕ search  │💬│                                      │  │   sheet / anim  │  │
│  Shapes    │  │                                      │  └─────────────────┘  │
│  Noises    │  │                                      │  RGBA ▾  100%  Fit  ⊞ │
│  Filters   │  │                                      ├───────────────────────┤
│  …         │  │                                      │  INSPECTOR            │
│ REFERENCES │  │                                      │  Node ▾  Params ▾ …   │
│            │  │                                      │                       │
├────────────┴──┴──────────────────────────────────────┴───────────────────────┤
│  ◀ ▶ ▮▮  frame 07 / 16  ━━━━━━━●━━━━━━━  12 fps   loop ✓   onion ○           │  timeline (animated graphs)
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Left panel** (240 px, resizable): `GRAPHS` (graphs and functions in the project), `LIBRARY` (node library with search), `REFERENCES` (reference images board). Sections collapse.
- **Tool strip** (40 px): Select, Pan, Frame, Comment, Reroute, Measure/Pick color.
- **Canvas**: the node graph. Infinite, dotted grid, 8 px snap.
- **Right column** (360 px, resizable), split vertically:
  - **Preview** (Vefects-style, larger than Paper's): shows the selected node, the pinned output, or the whole sheet. Channel selector, zoom, Fit, Tile 2×2, background (checker / black / white / custom / game backdrop), A/B compare, histogram toggle.
  - **Inspector** (Paper-style sections).
- **Timeline** (only for animated graphs): play, frame scrubber, fps, loop toggle, onion skin.
- **Presence**: human + agent avatars top right. The agent's avatar shows a pulsing ring while it is working.

## 2.4 Visual tokens

Light is the default theme; a dark theme ships too. The **preview background is independent of the theme**: textures are judged on the background the artist picks.

```
--color-ink:            #0d0d0c
--color-ink-muted:      #6b6966
--color-ink-faint:      #a3a09b
--color-canvas:         #f3f2ef
--color-surface:        #ffffff
--color-surface-sunk:   #f7f6f4
--color-hairline:       #e4e2dd
--color-hairline-strong:#cfccc6
--color-select:         #2f6bd8
--color-agent:          #b4643c
--color-danger:         #b33a2e
--color-ok:             #3f7a4f

dark theme:
--color-ink:            #ecebe8
--color-ink-muted:      #9a9792
--color-canvas:         #1b1b1a
--color-surface:        #232322
--color-surface-sunk:   #1f1f1e
--color-hairline:       #343432
--color-select:         #5b8ef0
--color-agent:          #d08257

--font-ui:   "Inter", "Helvetica Neue", Arial, sans-serif
--font-mono: "JetBrains Mono", ui-monospace, monospace
--text-label: 11px / uppercase / tracking 0.08em / weight 600
--text-ui:    12px / 16px line / weight 450
--text-field: 12px / tabular numbers
--text-title: 13px / weight 600
--radius-field: 4px
--radius-node:  6px
--radius-button: 2px
--space: 4 / 8 / 12 / 16 / 24
--row-height: 28px
--hairline: 1px solid var(--color-hairline)
```

Rules:

- **Two accents only, each with one job.** Blue means selection. Clay means "the agent did or is doing this".
- No glows, gradients or shadows in the chrome. One soft shadow for floating menus only.
- Socket colors show data type, desaturated: grayscale = neutral gray, color = muted ochre, vector/UV = slate, value = ink outline.
- Numbers use tabular figures so columns of values don't jitter while scrubbing.

## 2.5 Components

| Component | Behavior |
|---|---|
| **Node card** | Header (type icon, title, bypass and preview-pin toggles). Thumbnail (96 px, live, checker behind alpha). Input sockets on the left with names, outputs on the right. Selected = 1.5 px blue outline. Agent-touched = clay outline + small "Claude" tag that fades 4 s after the transaction ends. Error = red dot with tooltip. |
| **Wire** | 1.5 px, type-colored. Styles: curved / angled / straight (Vefects' "Connections" toggle). Dragging a wire onto empty canvas opens search with type-filtered results (auto insert). |
| **Reroute dot** | 8 px dot, double-click a wire to add one. |
| **Comment / Frame** | A titled rectangle behind nodes, optional tint from 6 muted colors. Notes inside support markdown. |
| **Prefixed number field** | Paper-style. Drag the prefix to scrub; Shift = ×10, Alt = ×0.1. Typing accepts math (`0.5*2`). Right-click → Expose / Drive by input / Reset / Copy value. |
| **Slider + field** | For bounded values. Soft range shown, hard range enforced. |
| **Segmented control** | For enums with ≤ 4 options. Dropdown above that. |
| **Curve editor** | Vefects-style inline editor. Points: corner / smooth / weighted. Presets: linear, ease in, ease out, bell, step. |
| **Gradient editor** | A stop bar with a color picker, a hardness per stop (for cel bands), a library dropdown, an eyedropper that can sample a gradient from a reference image along a dragged line [SD]. |
| **Spline editor** | Inline canvas with Add point / Delete point / Smooth (Vefects), plus on-preview handle editing. |
| **Color field** | Swatch + hex + alpha. Opens a picker with recent and palette swatches. |
| **Seed field** | Number + dice button for a random seed + lock icon. |
| **Exposed parameter chip** | A clay or ink chip on the node header showing a parameter is driven by a socket (`curl offset X ← Time`). |
| **Agent activity log** | An optional floating panel (like Paper's terminal overlay) listing the agent's transactions in plain words: "Added Warp, connected to Band, set strength 0.45". Each entry: Undo, Focus. |
| **Toast** | Bottom center, short, no icons except for errors. |

## 2.6 Interaction patterns

- **Space** (or Tab) on the canvas opens node search at the cursor [V][SD].
- **Drop a wire on empty canvas** → search pre-filtered by type, the new node auto-connects [V].
- **Drag a node onto a wire** → inserts it inline [SD].
- **Ctrl+D** duplicate, **Ctrl+C/V** copy/paste with links kept inside the selection [V].
- **F** frame selected, **A** frame all; the graph is framed automatically when a project opens [V].
- **L** auto-align selected [V], **C** comment around selection [V].
- **B** bypass node, **1** pin the selected node to Preview [SD].
- **Alt+drag** on a socket to disconnect, Ctrl+drag to duplicate a link [SD].
- Every shortcut is customizable and exportable [V].
- **Selection is shared with the agent**: what the human selects, `get_selection` returns [P].
- **Agent edits never move the human's viewport.** A non-blocking pill says "Claude edited 3 nodes — show" [P].

## 2.7 Preview behaviors

- Channels: RGB, RGBA, R, G, B, A, Luminance [V].
- Zoom, Fit, 1:1, Tile 2×2 to check seams [V].
- **Sheet mode**: show the whole atlas, or **play** it as an animation at the timeline fps.
- **Game backdrop**: preview the texture on a quad over a game-like ground with alpha or additive blending, at in-game size [N].
- **A/B compare**: a split slider between the current output and a reference image or a previous snapshot [N].
- **Pixel probe**: hover shows value per channel; click to copy [SD].
- **Histogram** overlay [SD].
- **Seam check**: highlights the frame-15→0 difference for looped animations [N].
