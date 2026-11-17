/**
 * WGSL that several nodes share but that depends on a node's own names
 * (an input or a parameter), so it cannot live in library.wgsl.
 */

import type { ParamSchema } from "./nodeDef"

/**
 * `profile_<param>(t)`: a floatList read as evenly spaced values over t = 0..1,
 * joined smoothly. An empty list reads as 1.
 */
export function profileFn(param: string): string {
  return /* wgsl */ `
fn profile_${param}(t: f32) -> f32 {
  let count = P.${param}_count;
  if (count == 0u) { return 1.0; }
  if (count == 1u) { return P_${param}(0u); }
  let x = clamp(t, 0.0, 1.0) * f32(count - 1u);
  let i = min(u32(floor(x)), count - 2u);
  let f = x - f32(i);
  return mix(P_${param}(i), P_${param}(i + 1u), f * f * (3.0 - 2.0 * f));
}`
}

/** `blur_<input>(uv, radius)`: Gaussian blur, radius in UV units, 225 samples. */
export function blurFn(input: string): string {
  return /* wgsl */ `
fn blur_${input}(uv: vec2f, radius: f32) -> vec4f {
  if (radius <= 0.0) { return sample_${input}(uv); }
  let aspect = vec2f(G.resolution.y / G.resolution.x, 1.0);
  var sum = vec4f(0.0);
  var total = 0.0;
  for (var y = -7; y <= 7; y++) {
    for (var x = -7; x <= 7; x++) {
      let o = vec2f(f32(x), f32(y)) / 7.0;
      let w = exp(-4.5 * dot(o, o));
      sum += w * sample_${input}(uv + o * 1.5 * radius * aspect);
      total += w;
    }
  }
  return sum / total;
}`
}

/**
 * `stamp_<input>(local)`: the input read as a stamp, local in -1..1 (y up),
 * nothing outside. Without a wire it is a soft disc.
 */
export function stampFn(input: string): string {
  return /* wgsl */ `
fn stamp_${input}(local: vec2f) -> vec4f {
  if (max(abs(local.x), abs(local.y)) >= 1.0) { return vec4f(0.0); }
  if (has_${input}) { return sample_${input}(vec2f(local.x * 0.5 + 0.5, 0.5 - local.y * 0.5)); }
  let v = 1.0 - smoothstep(0.7, 0.9, length(local));
  return vec4f(v, v, v, v);
}`
}

/** Parameters every spline-based node has. */
export const SPLINE_PARAMS: Record<string, ParamSchema> = {
  points: {
    type: "floatList",
    default: [-0.7, -0.5, -0.2, 0.3, 0.3, -0.2, 0.7, 0.5],
    maxLength: 24,
    doc: "x, y pairs in centered units (-1 to 1, y up). Two to twelve points; the curve passes through each."
  },
  closed: { type: "bool", default: false },
  width: { type: "float", default: 0.08, min: 0, max: 1 },
  profile: { type: "floatList", default: [0, 1, 1, 0], maxLength: 8, min: 0, max: 4, doc: "Width along the length, evenly spaced from start to end, as a multiple of width." },
  curl: { type: "float", default: 0, min: 0, max: 1, doc: "How far noise pushes the curve around." },
  curl_scale: { type: "float", default: 3, min: 0.1, max: 32 },
  curl_offset: { type: "vec2", default: [0, 0] }
}

/**
 * `spline_at(p)` for SPLINE_PARAMS: x = distance to the curve minus its width
 * (negative inside), y = position along the length 0..1, z = side (-1..1 across the width).
 */
export const SPLINE_FN = /* wgsl */ `
${profileFn("profile")}

fn spline_point(i: i32, n: i32) -> vec2f {
  var k = i;
  if (P.closed == 1u) { k = ((i % n) + n) % n; } else { k = clamp(i, 0, n - 1); }
  return vec2f(P_points(u32(k * 2)), P_points(u32(k * 2 + 1)));
}

fn spline_pos(seg: i32, t: f32, n: i32) -> vec2f {
  let p0 = spline_point(seg - 1, n);
  let p1 = spline_point(seg, n);
  let p2 = spline_point(seg + 1, n);
  let p3 = spline_point(seg + 2, n);
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
}

fn spline_at(p_in: vec2f) -> vec3f {
  let n = i32(P.points_count / 2u);
  if (n < 2) { return vec3f(1.0, 0.0, 0.0); }
  var p = p_in;
  if (P.curl > 0.0) {
    let q = vec3f((p + P.curl_offset) * P.curl_scale, 0.0);
    p += P.curl * 0.3 * noise_vec2(q, vec3i(256, 256, 1), G.seed);
  }
  let segments = select(n - 1, n, P.closed == 1u);
  const STEPS = 8;
  let total = f32(segments * STEPS);
  var best = 1e9;
  var best_t = 0.0;
  var best_side = 0.0;
  var a = spline_pos(0, 0.0, n);
  for (var s = 0; s < segments; s++) {
    for (var k = 1; k <= STEPS; k++) {
      let b = spline_pos(s, f32(k) / f32(STEPS), n);
      let ba = b - a;
      let h = clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
      let d = length(p - a - ba * h);
      if (d < best) {
        best = d;
        best_t = (f32(s * STEPS + k - 1) + h) / total;
        best_side = sign(ba.x * (p.y - a.y) - ba.y * (p.x - a.x));
      }
      a = b;
    }
  }
  let half = max(P.width * profile_profile(best_t), 1e-5);
  return vec3f(best - half, best_t, clamp(best_side * best / half, -1.0, 1.0));
}`
