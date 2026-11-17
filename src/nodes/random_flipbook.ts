import { defineNode } from "../engine/nodeDef"
import { sheetCols } from "../engine/sheet"

export default defineNode({
  type: "random_flipbook",
  category: "Blending",
  doc: "Variations of one image in a grid: the input is drawn count times, each with a different seed (the project seed plus 0, 1, 2 …), so every seeded node upstream changes together. Use it for a sheet of random sparks, puffs or debris. Each cell is graph-sized, plus padding.",
  inputs: { in: "image" },
  outputs: { out: "same:in" },
  params: {
    count: { type: "int", default: 4, min: 1, max: 64 },
    cols: { type: "int", default: 0, min: 0, max: 64, doc: "Columns of the grid. 0 picks the squarest grid." },
    padding: { type: "int", default: 0, min: 0, max: 64, doc: "Empty pixels around every cell." },
    dilate: { type: "int", default: 0, min: 0, max: 8, doc: "How far colors are bled under transparent pixels, in pixels." }
  },
  assemble: ({ params, frame }) => ({
    cols: sheetCols(params.count as number, params.cols as number),
    padding: params.padding as number,
    dilate: params.dilate as number,
    cells: Array.from({ length: params.count as number }, (_, seed) => ({ input: "in", frame, seed }))
  })
})
