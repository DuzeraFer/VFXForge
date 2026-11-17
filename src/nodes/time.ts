import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "time",
  category: "Inputs",
  doc: "Animation time. phase runs 0 to 1 over the graph's frames and loops exactly; sin and cos are of the phase.",
  inputs: {},
  outputs: { phase: "value", frame: "value", seconds: "value", sin: "value", cos: "value" },
  params: {},
  evaluate: ({ phase, frame, fps }) => ({
    phase,
    frame,
    seconds: frame / fps,
    sin: Math.sin(phase * Math.PI * 2),
    cos: Math.cos(phase * Math.PI * 2)
  })
})
