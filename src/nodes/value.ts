import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "value",
  category: "Inputs",
  doc: "A constant number that can drive parameters of other nodes.",
  inputs: {},
  outputs: { out: "value" },
  params: {
    value: { type: "float", default: 0 }
  },
  evaluate: ({ params }) => ({ out: params.value as number })
})
