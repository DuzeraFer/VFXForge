// Shared library, available to every node shader (docs/07 Phase 1 step 5).
// Everything here is deterministic: randomness comes from integer hashes only.

const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

// ── Coordinates ─────────────────────────────────────────────────────────────

// uv (0..1, y down) -> centered (-1..1, y up).
fn centered(uv: vec2f) -> vec2f {
  return vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
}

fn rotate2(p: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
}

// ── Anti-aliasing ───────────────────────────────────────────────────────────

// Step that is about one pixel wide, whatever the slope of x.
fn aa_step(edge: f32, x: f32) -> f32 {
  let w = max(fwidth(x), 1e-6) * 0.5;
  return clamp((x - edge) / (2.0 * w) + 0.5, 0.0, 1.0);
}

// Step with an extra softness, in the same units as x. Never sharper than a pixel.
fn soft_step(edge: f32, softness: f32, x: f32) -> f32 {
  let w = max(max(fwidth(x), 1e-6), softness);
  return clamp((x - edge) / w + 0.5, 0.0, 1.0);
}

// Coverage of a signed distance field (negative inside), d in centered units.
fn sdf_fill(d: f32, softness: f32) -> f32 {
  return 1.0 - soft_step(0.0, softness, d);
}

// ── Hashes (PCG) ────────────────────────────────────────────────────────────

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn hash3u(p: vec3i, seed: u32) -> u32 {
  return pcg(u32(p.x) + pcg(u32(p.y) + pcg(u32(p.z) + pcg(seed))));
}

fn u32_to_unit(h: u32) -> f32 {
  return f32(h >> 8u) * (1.0 / 16777216.0);
}

// 0..1
fn hash3(p: vec3i, seed: u32) -> f32 {
  return u32_to_unit(hash3u(p, seed));
}

// Two independent values in 0..1.
fn hash3_2(p: vec3i, seed: u32) -> vec2f {
  let h = hash3u(p, seed);
  return vec2f(u32_to_unit(h), u32_to_unit(pcg(h)));
}

// Unit-ish gradient for Perlin noise.
fn gradient3(p: vec3i, seed: u32) -> vec3f {
  let h = hash3u(p, seed);
  let a = u32_to_unit(h) * TAU;
  let z = u32_to_unit(pcg(h)) * 2.0 - 1.0;
  let r = sqrt(max(1.0 - z * z, 0.0));
  return vec3f(r * cos(a), r * sin(a), z);
}

// ── Periodic noise ──────────────────────────────────────────────────────────

fn wrap3(p: vec3i, period: vec3i) -> vec3i {
  return ((p % period) + period) % period;
}

fn fade3(t: vec3f) -> vec3f {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// Perlin noise, about -1..1, that repeats exactly every `period` lattice cells
// on each axis. Use z for time: z = phase * period.z loops with no seam.
fn perlin3(p: vec3f, period: vec3i, seed: u32) -> f32 {
  let i = vec3i(floor(p));
  let f = p - floor(p);
  let u = fade3(f);
  var corners: array<f32, 8>;
  for (var k = 0; k < 8; k++) {
    let o = vec3i(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    corners[k] = dot(gradient3(wrap3(i + o, period), seed), f - vec3f(o));
  }
  let x00 = mix(corners[0], corners[1], u.x);
  let x10 = mix(corners[2], corners[3], u.x);
  let x01 = mix(corners[4], corners[5], u.x);
  let x11 = mix(corners[6], corners[7], u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z) * 1.5;
}

// Fractal sum of perlin3, about -1..1. Each octave doubles the frequency in
// x and y (and its period, so tiling holds); time keeps one period.
fn fbm3(p: vec3f, period: vec3i, octaves: i32, lacunarity_gain: f32, seed: u32) -> f32 {
  var sum = 0.0;
  var amplitude = 1.0;
  var total = 0.0;
  var scale = 1;
  for (var o = 0; o < octaves; o++) {
    let s = f32(scale);
    sum += amplitude * perlin3(vec3f(p.xy * s, p.z), vec3i(period.xy * scale, period.z), seed + u32(o) * 1013u);
    total += amplitude;
    amplitude *= lacunarity_gain;
    scale *= 2;
  }
  return sum / max(total, 1e-6);
}

struct Voronoi {
  // Distance to the nearest and second nearest cell point, in cells.
  f1: f32,
  f2: f32,
  // Random 0..1 value of the nearest cell.
  id: f32,
}

// Periodic Voronoi. `p.z` moves the points on small loops (z in 0..1 = one loop).
fn voronoi3(p: vec3f, period: vec2i, jitter: f32, seed: u32) -> Voronoi {
  let cell = vec2i(floor(p.xy));
  let f = p.xy - floor(p.xy);
  var out: Voronoi;
  out.f1 = 8.0;
  out.f2 = 8.0;
  out.id = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2i(x, y);
      let wrapped = ((cell + o) % period + period) % period;
      let key = vec3i(wrapped, 0);
      let r = hash3_2(key, seed);
      let spin = TAU * (p.z + hash3(key, seed + 17u));
      let point = vec2f(o) + 0.5 + (r - 0.5) * jitter + 0.25 * jitter * vec2f(cos(spin), sin(spin)) * step(1e-6, abs(p.z));
      let d = length(point - f);
      if (d < out.f1) {
        out.f2 = out.f1;
        out.f1 = d;
        out.id = hash3(key, seed + 31u);
      } else if (d < out.f2) {
        out.f2 = d;
      }
    }
  }
  return out;
}

// ── Signed distance fields (centered units, negative inside) ───────────────

fn sd_circle(p: vec2f, r: f32) -> f32 {
  return length(p) - r;
}

fn sd_box(p: vec2f, half: vec2f, radius: f32) -> f32 {
  let q = abs(p) - half + radius;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

fn sd_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

// Regular polygon or star. `inner` in 0..1: 1 = polygon, lower = star with that inner radius ratio.
fn sd_polygon(p: vec2f, r: f32, sides: i32, inner: f32) -> f32 {
  let n = f32(max(sides, 3));
  let sector = TAU / n;
  // Fold into one sector, symmetric around the +y axis.
  var a = atan2(p.x, p.y);
  a = abs(a - sector * floor(a / sector + 0.5));
  let q = length(p) * vec2f(sin(a), cos(a));
  // Edge from the outer vertex (on the axis) to the inner vertex (at half a sector).
  let outer = vec2f(0.0, r);
  let apothem = r * cos(sector * 0.5);
  let inner_r = mix(apothem * inner, apothem, step(0.9999, inner));
  let inner_v = inner_r * vec2f(sin(sector * 0.5), cos(sector * 0.5));
  let d = sd_segment(q, outer, inner_v);
  let e = inner_v - outer;
  let w = q - outer;
  let side = e.x * w.y - e.y * w.x;
  return select(d, -d, side < 0.0);
}

// Smooth union of two distances.
fn smooth_min(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-6), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// ── Color ───────────────────────────────────────────────────────────────────

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn rgb_to_hsl(c: vec3f) -> vec3f {
  let hi = max(c.r, max(c.g, c.b));
  let lo = min(c.r, min(c.g, c.b));
  let l = (hi + lo) * 0.5;
  let d = hi - lo;
  if (d < 1e-6) { return vec3f(0.0, 0.0, l); }
  let s = d / max(1.0 - abs(2.0 * l - 1.0), 1e-6);
  var h: f32;
  if (hi == c.r) { h = (c.g - c.b) / d; }
  else if (hi == c.g) { h = (c.b - c.r) / d + 2.0; }
  else { h = (c.r - c.g) / d + 4.0; }
  return vec3f(fract(h / 6.0), clamp(s, 0.0, 1.0), l);
}

fn hsl_to_rgb(hsl: vec3f) -> vec3f {
  let k = fract(vec3f(0.0, 8.0 / 12.0, 4.0 / 12.0) + hsl.x) * 12.0;
  let a = hsl.y * min(hsl.z, 1.0 - hsl.z);
  return hsl.z - a * clamp(min(k - 3.0, 9.0 - k), vec3f(-1.0), vec3f(1.0));
}

// ── More hashes and noise helpers ───────────────────────────────────────────

// 0..1 from one integer.
fn hash1(i: i32, seed: u32) -> f32 {
  return u32_to_unit(pcg(u32(i) + pcg(seed)));
}

// Two smooth periodic noises, about -1..1 each, for pushing coordinates around.
fn noise_vec2(p: vec3f, period: vec3i, seed: u32) -> vec2f {
  return vec2f(perlin3(p, period, seed), perlin3(p, period, seed + 7919u));
}

// Divergence-free flow from a periodic noise potential: it swirls instead of piling up.
fn curl2(p: vec3f, period: vec3i, seed: u32) -> vec2f {
  let e = 0.05;
  let dx = perlin3(p + vec3f(e, 0.0, 0.0), period, seed) - perlin3(p - vec3f(e, 0.0, 0.0), period, seed);
  let dy = perlin3(p + vec3f(0.0, e, 0.0), period, seed) - perlin3(p - vec3f(0.0, e, 0.0), period, seed);
  return vec2f(dy, -dx) / (2.0 * e);
}

// Golden-angle disc: point i of n, inside the unit disc, evenly spread.
fn disc_point(i: i32, n: i32) -> vec2f {
  let r = sqrt((f32(i) + 0.5) / f32(n));
  let a = f32(i) * 2.399963229728653;
  return r * vec2f(cos(a), sin(a));
}
