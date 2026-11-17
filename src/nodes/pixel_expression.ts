import { defineNode } from "../engine/nodeDef"
import { codeProblem } from "../engine/shader"

export default defineNode({
  type: "pixel_expression",
  category: "Math",
  doc: "Your own per-pixel code in WGSL. The code is the body of a function that returns a vec4f (r, g, b, a). It can read: uv (0 to 1, y down); a, b, c, d (the inputs at this pixel, vec4f, zero when not connected); x, y, z, w (the number parameters); and it can call sample_a(uv) to sample_d(uv), centered(uv), rotate2, perlin3, fbm3, voronoi3, hash3, sdf_fill, soft_step, luminance and the rest of the shared library. G.phase is the loop position and G.seed the seed. Loops must be for loops with a fixed count. Example: let p = centered(uv); let v = sdf_fill(length(p) - x, 0.0); return vec4f(v, v, v, 1.0);",
  inputs: { a: { type: "image", optional: true }, b: { type: "image", optional: true }, c: { type: "image", optional: true }, d: { type: "image", optional: true } },
  outputs: { out: "color" },
  usesTime: true,
  code: "code",
  check: (params) => codeProblem(String(params.code)),
  params: {
    code: { type: "string", default: "return a;", multiline: true, doc: "WGSL function body that returns vec4f." },
    x: { type: "float", default: 0.5 },
    y: { type: "float", default: 0 },
    z: { type: "float", default: 0 },
    w: { type: "float", default: 0 }
  },
  wgsl: /* wgsl */ `
fn expression(uv: vec2f, a: vec4f, b: vec4f, c: vec4f, d: vec4f, x: f32, y: f32, z: f32, w: f32) -> vec4f {
/*CODE*/
}
fn node(uv: vec2f) -> vec4f {
  return expression(uv, sample_a(uv), sample_b(uv), sample_c(uv), sample_d(uv), P.x, P.y, P.z, P.w);
}`
})
