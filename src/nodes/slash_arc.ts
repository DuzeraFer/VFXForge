import { defineNode } from "../engine/nodeDef"
import { profileFn } from "../engine/snippets"

export default defineNode({
  type: "slash_arc",
  category: "Shapes",
  doc: "A sword-slash arc: part of a ring whose thickness follows profile from start to end. fade darkens it toward the inner edge. Angles are counter-clockwise from the right; output=field is positive inside.",
  inputs: {},
  outputs: { out: "gray" },
  params: {
    radius: { type: "float", default: 0.6, min: 0, max: 2, softMax: 1 },
    start: { type: "angle", default: 20 },
    sweep: { type: "angle", default: 200, doc: "How far the arc goes round from start." },
    thickness: { type: "float", default: 0.25, min: 0, max: 1 },
    profile: { type: "floatList", default: [0, 0.6, 1, 0], maxLength: 8, min: 0, max: 4, doc: "Thickness along the arc, evenly spaced from start to end." },
    fade: { type: "float", default: 0, min: 0, max: 1, doc: "Fades the mask toward the inner edge." },
    offset: { type: "vec2", default: [0, 0] },
    softness: { type: "float", default: 0, min: 0, max: 1 },
    output: { type: "enum", default: "mask", options: ["mask", "field"] }
  },
  wgsl: /* wgsl */ `
${profileFn("profile")}
fn node(uv: vec2f) -> vec4f {
  let p = centered(uv) - P.offset;
  let sweep = max(abs(P.sweep), 1e-4);
  // Angle measured from the start, in the direction of the sweep, 0..TAU.
  var a = atan2(p.y, p.x) - P.start;
  if (P.sweep < 0.0) { a = -a; }
  a = a - TAU * floor(a / TAU);
  // Past the end, pick the nearer of the two ends.
  let beyond = a > sweep;
  let t = select(a / sweep, select(1.0, 0.0, a - sweep > (TAU - sweep) * 0.5), beyond);
  let half = P.thickness * 0.5 * profile_profile(t);
  let r = length(p);
  var d = abs(r - P.radius) - half;
  if (beyond) {
    let end_angle = P.start + sign(P.sweep) * sweep * t;
    d = max(d, length(p - P.radius * vec2f(cos(end_angle), sin(end_angle))) - half);
  }
  if (P.output == 1u) { return vec4f(-d, -d, -d, 1.0); }
  let across = clamp((r - (P.radius - half)) / max(2.0 * half, 1e-5), 0.0, 1.0);
  let v = sdf_fill(d, P.softness) * mix(1.0, across, P.fade);
  return vec4f(v, v, v, 1.0);
}`
})
