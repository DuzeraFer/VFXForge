import { defineNode } from "../engine/nodeDef"
import { sheetCols } from "../engine/sheet"

export default defineNode({
  type: "sheet_output",
  category: "Outputs",
  doc: "A result of the graph as a sprite sheet: every frame of the animation in one grid, left to right then top to bottom. name becomes the exported file name. Each cell is one graph-sized frame plus padding on every side; dilate bleeds colors under transparent pixels and into the padding so sprites do not get dark fringes in the game. Needs frames > 1 in the graph settings to be more than a single cell.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    name: { type: "string", default: "sheet" },
    cols: { type: "int", default: 0, min: 0, max: 64, doc: "Columns of the grid. 0 picks the squarest grid for the frame count." },
    padding: { type: "int", default: 0, min: 0, max: 64, doc: "Empty pixels around every frame." },
    dilate: { type: "int", default: 4, min: 0, max: 8, doc: "How far colors are bled under transparent pixels, in pixels. 0 turns it off." },
    usage: { type: "enum", default: "color", options: ["color", "mask", "erosion", "flow", "normal"] },
    alpha: { type: "enum", default: "straight", options: ["straight", "premultiplied"] }
  },
  assemble: ({ params, frames }) => ({
    cols: sheetCols(frames, params.cols as number),
    padding: params.padding as number,
    dilate: params.dilate as number,
    cells: Array.from({ length: frames }, (_, frame) => ({ input: "in", frame, seed: 0 }))
  })
})
