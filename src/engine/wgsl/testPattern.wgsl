// Phase 0 test pattern: proves the WebGPU path from WGSL to the Preview pane.
// A UV grid with three hard cel bands that pulse on an exactly periodic phase,
// in the palette of reference/target_fire_cel_green.png.

struct Uniforms {
  // phase in [0, 1): one full loop. Frame N equals frame 0 by construction.
  phase: f32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  // One triangle that covers the whole target.
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: VertexOut;
  out.position = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(corner.x, 1.0 - corner.y);
  return out;
}

const TAU: f32 = 6.283185307179586;

// Anti-aliased step, about one pixel wide.
fn aa_step(edge: f32, x: f32) -> f32 {
  let w = fwidth(x) * 0.5;
  return smoothstep(edge - w, edge + w, x);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let uv = in.uv;

  // Background: dark UV tint with an 8x8 grid.
  var color = vec3f(0.07, 0.08, 0.07) + vec3f(uv.x, uv.y, 0.0) * 0.05;
  let cell = abs(fract(uv * 8.0) - 0.5);
  let line = 1.0 - aa_step(0.02, 0.5 - max(cell.x, cell.y));
  color = mix(color, vec3f(0.16, 0.18, 0.16), line);

  // Wobbling disc, cut into three hard bands.
  let p = uv - 0.5;
  let angle = atan2(p.y, p.x);
  let wobble = 0.02 * sin(angle * 5.0 + u.phase * TAU) + 0.012 * sin(angle * 9.0 - u.phase * TAU * 2.0);
  let d = length(p) + wobble;
  let pulse = 0.015 * sin(u.phase * TAU);

  let outer = vec3f(0.07, 0.42, 0.16);
  let mid = vec3f(0.36, 0.83, 0.22);
  let core = vec3f(0.93, 1.0, 0.62);

  color = mix(color, outer, 1.0 - aa_step(0.36 + pulse, d));
  color = mix(color, mid, 1.0 - aa_step(0.27 + pulse, d));
  color = mix(color, core, 1.0 - aa_step(0.15 + pulse, d));

  return vec4f(color, 1.0);
}
