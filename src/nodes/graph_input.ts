import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "graph_input",
  category: "Inputs",
  doc: "An input of a function. When the graph is used as a node in another graph, this becomes one of its input sockets, called name. Until something is plugged in there, and while you work on the function itself, it gives the fill color.",
  inputs: {},
  outputs: { out: "param:kind" },
  params: {
    name: { type: "string", default: "in" },
    kind: { type: "enum", default: "gray", options: ["gray", "color"], doc: "What the input carries. A gray input also accepts nothing else; a color input accepts both." },
    fill: { type: "color", default: [0, 0, 0, 1], doc: "Used when nothing is plugged in. A gray input uses its red value." }
  },
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  return P.fill;
}`
})
