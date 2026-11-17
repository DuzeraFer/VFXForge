import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "lightning",
  category: "Splines",
  doc: "A jagged bolt from start to end with side branches. evolution reshapes it: whole numbers give the same bolt, so step it with Time.frame for a flicker. Add Glow after it.",
  inputs: {},
  outputs: { out: "gray" },
  seeded: true,
  params: {
    start: { type: "vec2", default: [-0.1, 0.9] },
    end: { type: "vec2", default: [0.1, -0.9] },
    jagged: { type: "float", default: 0.25, min: 0, max: 1, doc: "How far the bolt strays sideways." },
    width: { type: "float", default: 0.03, min: 0, max: 0.5 },
    branches: { type: "int", default: 4, min: 0, max: 8 },
    branch_length: { type: "float", default: 0.5, min: 0, max: 1.5 },
    evolution: { type: "int", default: 0, doc: "Another bolt for every whole number." },
    softness: { type: "float", default: 0, min: 0, max: 1 }
  },
  wgsl: /* wgsl */ `
const POINTS = 16;

// Sideways offset of point i of a bolt: big slow zigzags plus small fast ones, zero at both ends.
fn stray(i: i32, n: i32, key: u32) -> f32 {
  let t = f32(i) / f32(n);
  let coarse = hash1(i / 4, key) * 2.0 - 1.0;
  let next = hash1(i / 4 + 1, key) * 2.0 - 1.0;
  let fine = hash1(i, key + 53u) * 2.0 - 1.0;
  return (mix(coarse, next, f32(i % 4) / 4.0) * 0.7 + fine * 0.3) * sin(PI * t);
}

fn bolt_point(a: vec2f, b: vec2f, i: i32, n: i32, key: u32, pinned_end: bool) -> vec2f {
  let dir = b - a;
  let normal = vec2f(-dir.y, dir.x);
  var s = stray(i, n, key);
  // A branch ends in the open, so only its start is pinned.
  if (!pinned_end && i > 0) { s = (mix(hash1(i / 2, key), hash1(i / 2 + 1, key), f32(i % 2) * 0.5) * 2.0 - 1.0) * 0.5; }
  return a + dir * (f32(i) / f32(n)) + normal * s * P.jagged;
}

// Distance to a bolt minus its width, which thins toward the end.
fn bolt(p: vec2f, a: vec2f, b: vec2f, n: i32, key: u32, width: f32, pinned_end: bool) -> f32 {
  var d = 1e9;
  var prev = bolt_point(a, b, 0, n, key, pinned_end);
  for (var i = 1; i <= n; i++) {
    let next = bolt_point(a, b, i, n, key, pinned_end);
    let thin = select(1.0 - 0.8 * (f32(i) - 0.5) / f32(n), 1.0 - 0.3 * (f32(i) - 0.5) / f32(n), pinned_end);
    d = min(d, sd_segment(p, prev, next) - width * 0.5 * thin);
    prev = next;
  }
  return d;
}

fn node(uv: vec2f) -> vec4f {
  let p = centered(uv);
  let key = G.seed + u32(P.evolution) * 7919u;
  var d = bolt(p, P.start, P.end, POINTS, key, P.width, true);
  let main = P.end - P.start;
  for (var b = 0; b < P.branches; b++) {
    let bk = key + u32(b + 1) * 131u;
    let at = 2 + i32(hash1(b, bk) * f32(POINTS - 5));
    let origin = bolt_point(P.start, P.end, at, POINTS, key, true);
    let turn = (0.35 + 0.5 * hash1(b, bk + 1u)) * select(-1.0, 1.0, hash1(b, bk + 2u) > 0.5);
    let reach = P.branch_length * (0.4 + 0.6 * hash1(b, bk + 3u)) * (1.0 - f32(at) / f32(POINTS));
    let tip = origin + rotate2(main, turn) * reach;
    d = min(d, bolt(p, origin, tip, 8, bk, P.width * 0.6, false));
  }
  let v = sdf_fill(d, P.softness);
  return vec4f(v, v, v, 1.0);
}`
})
