# 5 — AI Integration

The selling point. Modeled on how Paper links agents to its canvas, extended for textures: the agent must not only edit the graph but **see and measure** its output.

## 5.1 Lessons taken from Paper's MCP

| Paper pattern | VFXForge equivalent |
|---|---|
| `get_basic_info` first: file, pages, artboards, tokens | `get_basic_info`: project, graphs, outputs, frame settings, palette libraries |
| `get_selection` shows what the human is focused on | Same. Selection is shared both ways |
| `get_tree_summary` / `get_jsx` give a compact structural view | `get_graph` returns a compact text form of the graph (5.4) |
| `write_html` adds one visual group at a time; the human watches it build | `apply` takes a small batch of operations; the canvas animates each one in |
| `get_screenshot` after every few edits, with a review checklist | `render` / `render_compare` / `measure` after every few edits, with a texture review checklist (5.6) |
| `finish_working_on_nodes` ends the agent's presence | `finish_working` |
| Agent avatar in the presence row, tool calls readable as a log | Same: presence avatar + activity log panel |
| Image generation via a built-in generator | P2: `generate_image` into an Image Sample node |

## 5.2 Transport

- The app runs a local **MCP server** (streamable HTTP) on `127.0.0.1`, port chosen at startup and written to `%APPDATA%/VFXForge/mcp.json` together with a random token.
- A stdio shim, `vfxforge mcp`, reads that file and proxies, so any MCP client can use a fixed command:

```json
{ "mcpServers": { "vfxforge": { "command": "vfxforge", "args": ["mcp"] } } }
```

- If the app is not running, the shim starts it **headless** with the same engine, so agents can work without the window open (CI, batch jobs).
- Multiple agents can connect. Each gets a session id, a display name and a presence color.

## 5.3 Tool set

Kept small on purpose: one write tool that takes a list of operations is easier for an agent than thirty write tools.

### Read

| Tool | Returns |
|---|---|
| `get_basic_info` | Project name, graphs (id, name, size, frames, fps, loop), outputs, global seed, libraries, active graph, version hash |
| `get_selection` | Selected node ids with type and name, active graph, pinned preview node |
| `get_graph(graphId, detail?)` | Compact text form (5.4). `detail: "full"` includes default values |
| `get_node(nodeId)` | All parameters with schema (type, range, default, current value, exposed/driven state), inputs, outputs, errors |
| `list_node_types(query?)` | Node types with doc string, inputs, outputs, parameter schema |
| `list_references` / `get_reference(id)` | Reference images on the board, with the artist's notes |
| `list_comments(graphId?)` / `get_comment_thread(id)` | Comment threads pinned to nodes or canvas points |
| `get_history(limit)` | Recent transactions: who, label, what changed |

### See and measure

| Tool | Returns |
|---|---|
| `render(target, options)` | PNG of a node or output. Options: frame or `"sheet"`, channel, size, background (checker / black / white / color / game), tile 2×2 |
| `render_compare(target, referenceId, options)` | One PNG: output and reference side by side at the same size and background, labeled |
| `render_frames(target, frames[])` | A contact strip of selected frames |
| `measure(target, options)` | Numbers the agent can reason about without guessing from pixels: alpha coverage %, bounding box, histogram (per channel, 16 bins), mean / dominant colors, band area ratios, number of islands and smallest island area, edge touching (does the shape hit the frame border), loop seam error, frame-to-frame change |

### Write

| Tool | Does |
|---|---|
| `apply(ops[], label)` | Applies a list of operations as **one atomic, undoable transaction** named `label`. Returns new ids, validation errors, and optionally a thumbnail of the affected outputs |
| `create_graph(name, settings)` | New graph in the project |
| `create_function(fromNodeIds, name)` | Collapse a selection into a reusable function |
| `set_selection(nodeIds)` / `focus(nodeId)` | Ask the UI to show something. Never moves the human's viewport without consent; shows a "Claude wants to show you…" pill instead |
| `add_reference(path or url, note)` | Puts an image on the reference board |
| `comment(target, text)` / `reply(threadId, text)` | Talk to the artist inside the document |
| `export(outputs?, folder?, preset?)` | Writes files + sidecar JSON, returns the paths |
| `snapshot(name)` | Saves the current outputs for later A/B |
| `finish_working` | Ends presence, clears agent highlights |
| `generate_image(prompt, size)` (P2) | AI-generated image into a new Image Sample node |

`export {outputs?, folder?, format?, bitDepth?, fileName?}` (Phase 5) writes textures and their `.vfxforge.json` sidecars. An agent can only write into the folder the artist last exported to, or into the project's own folder (default `export/` next to the `.vfxf`).

`generate_image {graphId, nodeId}` (Phase 3b) asks the AI Image node to produce its texture from its current prompt. It needs the artist's opt-in and counts against a per-session limit (06 §6.11).

### Operations accepted by `apply`

```
add_node        { type, id?, name?, params?, position? }
remove_node     { id }
set_params      { id, params: { key: value, ... } }
connect         { from: "nodeId.output", to: "nodeId.input" }
disconnect      { to: "nodeId.input" }
drive_param     { id, param, from: "nodeId.output" }
expose_param    { id, param, as, label?, group? }
move_node       { id, position }        (optional; auto-layout runs if omitted)
rename          { id, name }
set_graph       { size?, frames?, fps?, loop?, seed? }
add_comment_box { nodeIds, title, color? }
```

Positions are optional. When the agent omits them, the app places new nodes with auto-layout next to their inputs, so agent-built graphs stay tidy.

## 5.4 Compact graph text (what `get_graph` returns)

Designed for an LLM to read and write quickly: one node per line, only non-default parameters, links inline.

```
graph fire_cel_green  256x256  frames=16 fps=12 loop  seed=7
n1  time
n2  perlin        scale=3 octaves=2 evolution<-n1.phase
n3  perlin        scale=4.8 octaves=2 seed=+1 evolution<-n1.phase
n4  flame_shape   bulb_y=-0.5 bulb_r=0.4 tip_y=0.6 taper=1.1
n5  warp          intensity=0.45  in<-n4 map<-n2
n6  erosion       amount=0.22     in<-n5 map<-n3
n7  band          thresholds=[-0.06,0,0.12]  in<-n6
n8  palette_remap gradient="cel_green"  in<-n7
n9  sheet_output  name=fire_cel_green cols=4 rows=4  in<-n8
```

The same form is accepted by an `apply_text` convenience tool (P1) so the agent can rewrite a whole small graph in one go when that is clearer than many ops.

## 5.5 Presence and safety

- **Live presence**: while a transaction runs, touched nodes get the clay outline and a "Claude" tag; new nodes fade in one by one (~80 ms apart) so the human can follow, as in Paper.
- **Attribution**: every history entry records human or agent (with session name). The history panel can filter by author.
- **One-step undo** of a whole agent transaction, even if the human made unrelated edits after it (selective undo: only reverted if the touched values are unchanged; otherwise the conflict is shown).
- **Conflicts**: each node carries a version number. `apply` ops can include `ifVersion`; if the human changed that node since the agent read it, the op fails with the current state instead of overwriting.
- **Locks**: the artist can lock nodes or whole frames. The agent can read locked nodes but `apply` refuses to change them.
- **No hidden side effects**: the agent cannot write files outside the export folder and the project folder.

## 5.6 The see-and-iterate loop

The intended agent workflow, written into the tool descriptions and a guide returned by `get_guide`:

1. `get_basic_info`, `get_selection`, `list_references`.
2. Plan the graph in a few lines; post it as a comment if the artist is watching.
3. Build in small `apply` batches (one visual idea per batch).
4. After every few batches: `render` the output (sheet and one frame), `measure` it, and when a reference exists, `render_compare`.
5. Review against the checklist and fix before moving on.
6. `snapshot` good states. `finish_working` at the end.

**Texture review checklist** (the agent states one line per item):

- **Silhouette** — reads at game size? chunky, not noisy? (`measure`: smallest island area, island count)
- **Bands** — clean cel bands, right proportions? (`measure`: band area ratios)
- **Edges** — anti-aliased, no shape touching the frame border? (`measure`: edge touching)
- **Loop** — seamless? (`measure`: loop seam error)
- **Motion** — frames change enough, not too much? (`measure`: frame-to-frame change)
- **Alpha** — correct mode, no fringes on a dark background? (`render` on black and on white)
- **Palette** — matches the reference? (`measure`: dominant colors vs reference)

## 5.7 Artist-facing AI features (P1–P2)

| Feature | Description |
|---|---|
| Reference board | Drop images; add a note per image ("match the shape language, not the color") |
| Comment threads | Pin a comment on a node or a frame ("this tip is too thin") — the agent reads and answers in the thread, then fixes |
| Activity log | Floating panel with the agent's transactions in plain words, each with Undo and Focus |
| Variation explorer | Agent produces N candidate snapshots (seeds or parameter sweeps); the artist picks one in a grid |
| In-app prompt bar (P2) | A prompt field that sends a message to the connected agent with the current selection attached |
| Explain node | Right-click → "Ask Claude about this node" posts a comment thread the agent answers |
