import { defineNode, type InputDef } from "../engine/nodeDef"
import { sheetCols } from "../engine/sheet"

const INPUTS = ["in1", "in2", "in3", "in4", "in5", "in6", "in7", "in8"] as const

export default defineNode({
  type: "pattern_grid",
  category: "Blending",
  doc: "Puts up to eight different images side by side in one atlas, in input order; unconnected inputs are skipped. Each cell is graph-sized, plus padding. Grayscale inputs are shown as gray in the color atlas.",
  inputs: Object.fromEntries(INPUTS.map((name) => [name, { type: "image", optional: true } satisfies InputDef])),
  outputs: { out: "color" },
  params: {
    cols: { type: "int", default: 0, min: 0, max: 8, doc: "Columns of the grid. 0 picks the squarest grid." },
    padding: { type: "int", default: 0, min: 0, max: 64, doc: "Empty pixels around every cell." },
    dilate: { type: "int", default: 0, min: 0, max: 8, doc: "How far colors are bled under transparent pixels, in pixels." }
  },
  assemble: ({ params, connected, frame }) => ({
    cols: sheetCols(connected.length, params.cols as number),
    padding: params.padding as number,
    dilate: params.dilate as number,
    cells: connected.map((input) => ({ input, frame, seed: 0 }))
  })
})
