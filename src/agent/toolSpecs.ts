/**
 * The MCP tools (docs/05 §5.3). Kept small on purpose: one write tool that
 * takes a list of operations is easier for an agent than thirty write tools.
 * This file has no dependencies so that the main process can list the tools
 * and the renderer can run them.
 */

export type ToolSpec = {
  name: string
  description: string
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
  /** Read-only tools do not mark the agent as "editing". */
  readOnly: boolean
}

const graphId = { type: "string", description: "Graph id. Defaults to the graph the artist has open." }
const target = {
  type: "string",
  description: 'What to look at: "nodeId", "nodeId.output", or the name of an Output node. Defaults to the graph\'s first Output node.'
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "get_guide",
    description:
      "How to work in VFXForge: the build-look-measure loop, the texture review checklist, and the cel-shading recipe. Call this first, once.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true
  },
  {
    name: "get_basic_info",
    description: "The open project: graphs (id, name, size, frames, fps), their Output nodes, the project seed and which graph the artist has open.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true
  },
  {
    name: "get_selection",
    description: "What the artist is focused on: the open graph, the selected nodes and the node pinned in Preview.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true
  },
  {
    name: "get_graph",
    description:
      'A graph as compact text: one node per line with its non-default parameters, drivers ("param<-node.output") and input links ("input<-node"). Read this before editing.',
    inputSchema: {
      type: "object",
      properties: { graphId, detail: { type: "string", enum: ["compact", "full"], description: '"full" also lists parameters left at their defaults.' } }
    },
    readOnly: true
  },
  {
    name: "get_node",
    description: "One node in full: every parameter with its type, range, default and current value, what drives it, its inputs and outputs, its version and any errors.",
    inputSchema: { type: "object", properties: { graphId, nodeId: { type: "string" } }, required: ["nodeId"] },
    readOnly: true
  },
  {
    name: "list_node_types",
    description:
      "The node library. Without a query: one line per type. With a query (a type name or search words): full details of the matches, including the parameter schema. Angles are in degrees.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    readOnly: true
  },
  {
    name: "get_history",
    description: "Recent changes to the document, newest first: who made them (the artist or an agent), their label and when.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } } },
    readOnly: true
  },
  {
    name: "render",
    description:
      'Renders a node or output and returns the image. Use it after every few edits. frame: a frame number (default 0) or "sheet" for all frames in a grid. background: what shows behind transparent pixels.',
    inputSchema: {
      type: "object",
      properties: {
        graphId,
        target,
        frame: { description: 'Frame number, or "sheet".', oneOf: [{ type: "integer", minimum: 0 }, { type: "string", enum: ["sheet"] }] },
        background: { type: "string", description: '"checker" (default), "black", "white", "transparent" or a color like "#2a1f2b".' },
        tile: { type: "boolean", description: "Repeat 2×2 to check that the image tiles without seams." }
      }
    },
    readOnly: true
  },
  {
    name: "render_frames",
    description: "A strip of chosen frames side by side, to judge motion. Defaults to up to 8 frames spread evenly over the loop.",
    inputSchema: {
      type: "object",
      properties: { graphId, target, frames: { type: "array", items: { type: "integer", minimum: 0 }, maxItems: 16 }, background: { type: "string" } }
    },
    readOnly: true
  },
  {
    name: "measure",
    description:
      "Numbers about a rendered node or output, so you do not have to guess from pixels: coverage %, bounding box, which borders the shape touches, island count and smallest island, luminance and alpha histograms, dominant colors with their share of the shape (cel band proportions). With motion: true, also frame-to-frame change and the loop seam across all frames.",
    inputSchema: {
      type: "object",
      properties: {
        graphId,
        target,
        frame: { type: "integer", minimum: 0, default: 0 },
        motion: { type: "boolean", description: "Also measure all frames: change per frame and the loop seam." },
        mask: { type: "string", enum: ["alpha", "luminance"], description: "What counts as the shape. Default: alpha for color images, luminance for grayscale." }
      }
    },
    readOnly: true
  },
  {
    name: "apply",
    description: [
      "Changes the graph. Applies a list of operations as ONE atomic, undoable step that the artist sees under your label. If any operation is invalid, nothing changes and the error names the operation.",
      "Keep batches small: one visual idea per call, then render.",
      "Operations:",
      '  { "op": "add_node", "type": "perlin", "id"?: "n12", "name"?: "Warp noise", "params"?: { "scale": 3 }, "position"?: [x, y] }',
      '  { "op": "remove_node", "id": "n12" }',
      '  { "op": "set_params", "id": "n12", "params": { "scale": 4, "octaves": null } }   (null resets to the default)',
      '  { "op": "connect", "from": "n2.out", "to": "n5.map" }   (an input holds one wire; connecting replaces it)',
      '  { "op": "disconnect", "to": "n5.map" }',
      '  { "op": "drive_param", "id": "n2", "param": "evolution", "from": "n1.phase" }   (from: null stops driving)',
      '  { "op": "move_node", "id": "n12", "position": [x, y] }',
      '  { "op": "rename", "id": "n12", "name": "Warp noise" }   (name: null restores the type name)',
      '  { "op": "set_node_flags", "id": "n12", "bypass": true }',
      '  { "op": "set_graph", "name"?: "Fire", "width"?: 256, "height"?: 256, "frames"?: 16, "fps"?: 12, "loop"?: true, "seed"?: 7, "function"?: true, "description"?: "What the function makes" }',
      '  { "op": "expose_param", "id": "n8", "param": "gradient", "as"?: "palette", "label"?: "Palette" }   (shows the parameter at graph level; on a function it becomes a parameter of the function\'s node)',
      '  { "op": "unexpose_param", "as": "palette" }',
      '  { "op": "set_presets", "presets": [{ "name": "Green", "values": { "palette": [...] } }] }   (named sets of values for the exposed parameters; replaces the list)',
      "Give new nodes an id when later operations in the same batch refer to them. Leave position out: new nodes are placed next to what they connect to.",
      'Add "ifVersion": <version from get_node> to an operation on an existing node to fail instead of overwriting a change the artist made since you read it. Locked nodes cannot be changed.'
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        graphId,
        label: { type: "string", description: 'What this step does, in the artist\'s words, e.g. "Add flame shape and warp".' },
        ops: { type: "array", items: { type: "object" }, minItems: 1 }
      },
      required: ["label", "ops"]
    },
    readOnly: false
  },
  {
    name: "generate_image",
    description:
      "Asks an AI Image node (type ai_image) to draw its picture from its current prompt, mode, size and quality, using the artist's OpenAI account. It costs the artist money and takes up to a minute, so set the prompt carefully with apply first and do not retry in a loop. Only works if the artist allowed it in Settings, and only a few times per session; otherwise set the prompt and ask the artist to press Generate. Render the node afterwards to see the result.",
    inputSchema: { type: "object", properties: { graphId, nodeId: { type: "string", description: "An ai_image node." } }, required: ["nodeId"] },
    readOnly: false
  },
  {
    name: "list_references",
    description: "The reference board: pictures the artist wants you to work towards, each with their note on what to take from it. Also lists snapshots. Look here before you start.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true
  },
  {
    name: "get_reference",
    description: "One reference picture or snapshot as an image, with the artist's note.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "A reference id (ref1) or snapshot id (s1) from list_references." }, background: { type: "string" } }, required: ["id"] },
    readOnly: true
  },
  {
    name: "render_compare",
    description:
      "One picture with your render on the left and a reference or snapshot on the right, at the same height, plus the dominant colors of both. Use it to judge shape, proportions and palette against the reference, and to see what changed since a snapshot.",
    inputSchema: {
      type: "object",
      properties: { graphId, target: { type: "string" }, referenceId: { type: "string", description: "A reference or snapshot id." }, frame: { type: "integer", minimum: 0 }, background: { type: "string" } },
      required: ["referenceId"]
    },
    readOnly: true
  },
  {
    name: "add_reference",
    description: "Puts an image file from this computer on the reference board (PNG, JPEG or WebP, by its full path). Only for a file the artist pointed you to.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, name: { type: "string" }, note: { type: "string", description: "What to take from it." } }, required: ["path"] },
    readOnly: false
  },
  {
    name: "list_comments",
    description: "Comment threads the artist pinned to nodes or to a graph, with who wrote what. Threads marked WAITING FOR AN ANSWER are for you. Check this when you start and before you finish.",
    inputSchema: { type: "object", properties: { graphId, includeResolved: { type: "boolean" } } },
    readOnly: true
  },
  {
    name: "comment",
    description: "Starts a comment thread on a node (or on the graph, without nodeId). Use it to tell the artist something about a specific place: a plan, a question, why you made a choice. Keep it short.",
    inputSchema: { type: "object", properties: { graphId, nodeId: { type: "string" }, text: { type: "string" } }, required: ["text"] },
    readOnly: false
  },
  {
    name: "reply",
    description: "Answers a comment thread. After fixing what a comment asked for, say what you changed; resolve: true closes the thread.",
    inputSchema: { type: "object", properties: { threadId: { type: "string" }, text: { type: "string" }, resolve: { type: "boolean" } }, required: ["threadId", "text"] },
    readOnly: false
  },
  {
    name: "snapshot",
    description: "Keeps a picture of a render as it is now, so you and the artist can compare later versions with it (render_compare, or Compare in the Preview). Take one of a good state before a risky change.",
    inputSchema: { type: "object", properties: { graphId, target: { type: "string" }, frame: { type: "integer", minimum: 0 }, name: { type: "string", description: 'For example "before thinner tip".' } } },
    readOnly: false
  },
  {
    name: "render_variations",
    description: [
      "Renders several versions of one target side by side without changing the graph: other seeds, or other parameter values.",
      'variations: [{ "label": "thin", "params": { "n4": { "taper": 2 } } }, { "label": "wide", "params": { "n4": { "taper": 0.6 }, "n5": { "intensity": 0.3 } }, "seed"?: 12 }], or seeds: 6 for six other seeds.',
      "With offer: true the artist gets the same grid and picks one with a click; their pick is applied as their own step. Use that when the choice is a matter of taste."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        graphId,
        target: { type: "string" },
        frame: { type: "integer", minimum: 0 },
        variations: { type: "array", items: { type: "object" }, minItems: 2, maxItems: 16 },
        seeds: { type: "integer", minimum: 2, maximum: 16 },
        offer: { type: "boolean" },
        note: { type: "string", description: "One line shown to the artist above the grid." },
        background: { type: "string" }
      }
    },
    readOnly: true
  },
  {
    name: "apply_text",
    description:
      'Rewrites a whole graph from text in the form get_graph returns: one line per node, "id type param=value input<-node param<-node.output \\"Name\\"". The text is the whole graph: nodes it leaves out are removed, nodes that keep their id and type keep their place. One undoable step, with the same checks as apply. Clearer than many ops for a small graph or a big restructuring; for small changes use apply.',
    inputSchema: { type: "object", properties: { graphId, label: { type: "string" }, text: { type: "string" } }, required: ["label", "text"] },
    readOnly: false
  },
  {
    name: "list_functions",
    description:
      "Functions: graphs used as one node. Lists the ones in this project (node type, inputs, outputs, parameters, presets) and the recipes that ship with VFXForge (cel fire, smoke puff, slash, impact burst, magic ring, lightning, dissolve mask). Look here before building a common effect from scratch.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true
  },
  {
    name: "add_function",
    description: "Copies a shipped recipe into the project as a function and returns its node type, sockets and parameters. After that, add it to a graph with apply (add_node). The artist can open the copy and change what is inside.",
    inputSchema: { type: "object", properties: { recipe: { type: "string", description: "A recipe id from list_functions, e.g. cel_fire." } }, required: ["recipe"] },
    readOnly: false
  },
  {
    name: "create_function",
    description:
      "Moves nodes of a graph into a new function and puts one node in their place, wired as they were. Wires that crossed the group become the function's inputs and outputs. One undoable step. Use it to tidy a finished part of a graph, or to reuse it in other graphs.",
    inputSchema: {
      type: "object",
      properties: { graphId, nodeIds: { type: "array", items: { type: "string" }, minItems: 1 }, name: { type: "string", description: "The function's name, e.g. \"Cel bands\"." } },
      required: ["nodeIds"]
    },
    readOnly: false
  },
  {
    name: "create_graph",
    description:
      "Adds a new, empty graph to the project and returns its id. Does not switch the artist's view unless open is true. With function: true the graph is a function: other graphs use it as a node of type fn_<id>, with its graph_input nodes as inputs, its output nodes as outputs and its exposed parameters as parameters.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        width: { type: "integer", minimum: 1, maximum: 4096 },
        height: { type: "integer", minimum: 1, maximum: 4096 },
        frames: { type: "integer", minimum: 1 },
        fps: { type: "integer", minimum: 1 },
        function: { type: "boolean", description: "Make it a function that other graphs use as a node." },
        description: { type: "string", description: "For a function: what it makes, in a sentence." },
        open: { type: "boolean", description: "Show the new graph in the editor." }
      },
      required: ["name"]
    },
    readOnly: false
  },
  {
    name: "export",
    description:
      "Writes the project's results to disk as texture files, each with a .vfxforge.json sidecar that the Unity importer reads (sheet rows and columns, fps, loop, alpha, usage). Exports every Output and Sheet Output unless outputs names some (by output name or node id). Without folder, files go to the folder the artist last exported to, or to export/ next to the project. A folder you name has to be inside one of those two places. Returns the paths written.",
    inputSchema: {
      type: "object",
      properties: {
        outputs: { type: "array", items: { type: "string" }, description: "Output names or node ids. Leave out for all." },
        folder: { type: "string", description: "Leave out for the default folder." },
        format: { type: "string", enum: ["png", "tga", "jpg", "bmp", "tiff"], description: "Default: the artist's last choice (png at first)." },
        bitDepth: { type: "integer", enum: [8, 16], description: "16 only applies to png and tiff." },
        fileName: { type: "string", description: 'File name template with {output}, {graph}, {project}. Default "{output}".' }
      }
    },
    readOnly: false
  },
  {
    name: "set_selection",
    description: "Selects nodes in the artist's editor so the inspector and Preview show them. Does not move the view.",
    inputSchema: { type: "object", properties: { nodeIds: { type: "array", items: { type: "string" } } }, required: ["nodeIds"] },
    readOnly: false
  },
  {
    name: "save_project",
    description: "Saves the project to the file it was opened from. A project that has never been saved needs the artist to choose where it goes first.",
    inputSchema: { type: "object", properties: {} },
    readOnly: false
  },
  {
    name: "finish_working",
    description: "Call when you are done. Ends your presence in the editor and clears your highlights. Optionally leave one line for the artist.",
    inputSchema: { type: "object", properties: { summary: { type: "string" } } },
    readOnly: false
  }
]
