# 4 — Node Library

Every node is a self-contained unit: a WGSL shader (or a CPU function for non-pixel nodes), a parameter schema, typed inputs and outputs, and a short doc string the agent receives through `list_node_types`.

Types: **G** grayscale image · **C** color image · **V** value (float / vector / int / bool) · **S** spline · **T** time.
Common to every image node: `resolution`, `bitDepth`, `tiling`, `seed` (if random).

## 4.1 Inputs and constants

| Node | Out | Key parameters | Source | P |
|---|---|---|---|---|
| Uniform Color | C/G | color | V SD | P0 |
| Value | V | float / float2 / float3 / float4 / int / bool | SD | P0 |
| Image Sample | C | file (PNG JPG BMP GIF TIFF TGA), fit mode, linear/sRGB | V SD | P0 |
| AI Image | C, G (mask) | prompt, background (transparent / opaque), alpha (from image / from luminance), size, quality; generated on request, result stored with the project (06 §6.11) | new | P0 |
| Image Sequence | C (animated) | folder or pattern, frame offset, loop | V N | P1 |
| SVG | G | file, fill/stroke, size | SD | P2 |
| Text | G | string, font, size, alignment | SD | P2 |
| Graph Input | any | name, type, default | SD | P1 |
| Time | T, V | outputs: phase 0–1, frame, seconds, sin/cos of phase | V | P0 |

## 4.2 Shapes (SDF-based, anti-aliased, output G + optional SDF)

| Node | Key parameters | Source | P |
|---|---|---|---|
| Shape | type (circle, square, rounded rect, ring, capsule, teardrop, crescent, cross, heart), size, softness, outline width | V SD | P0 |
| Polygon | sides, roundness, inner radius, star mode | V SD | P0 |
| Anime Star | points, inner/outer radius, curvature of spikes, spike length jitter | V | P0 |
| Flame Shape | bulb radius, tip height, taper, lean | N | P0 |
| Slash Arc | start/end angle, thickness profile curve, inner fade, tip taper | N | P0 |
| Burst | ray count, ray width profile, length jitter, inner hole | N | P1 |
| Droplet / Spark | length, head size, tail taper | N | P1 |
| Gradient | linear, radial, angular, diamond, bidirectional; position, angle | V SD | P0 |
| Gradient Dynamic | gradient driven by a G map (grayscale → position) | SD | P1 |

## 4.3 Splines

| Node | Key parameters | Source | P |
|---|---|---|---|
| Spline | points (editable), per-segment interpolation, closed, width profile curve, softness, curl intensity, curl scale, curl seed, curl offset X/Y | V SD | P0 |
| Spline Scatter | instances along a spline, scale/rotation over length | SD | P2 |
| Lightning | start/end, branching, jaggedness, sub-branches, seed | V N | P1 |
| Trail | spline + width profile + UV-along-length output for scrolling textures | N | P1 |

## 4.4 Noises (all periodic for exact tiling and looping; output G)

| Node | Key parameters | Source | P |
|---|---|---|---|
| Perlin | scale, octaves, persistence, lacunarity, offset, evolution (loops with Time) | V SD | P0 |
| Fractal (fBm) | type (fBm, ridged, billow), scale, octaves | V SD | P0 |
| Gaussian / Band Noise | scale, band width (what the prototype uses) | V N | P0 |
| Voronoi / Cells | scale, jitter, metric (euclid, manhattan, chebyshev), output (F1, F2, F2-F1, edges, cell id) | V SD | P0 |
| Clouds | scale, roughness | SD | P1 |
| BnW Spots | scale, density | SD | P1 |
| Crystal | scale, facets | SD | P2 |
| Moisture / Liquid | scale, flow | SD | P2 |
| Anisotropic / Directional | angle, stretch | SD | P1 |
| Curl Noise (vector) | scale, strength — outputs a flow field | N | P1 |
| White Noise | (per-pixel random) | SD | P1 |

## 4.5 Patterns and scattering

| Node | Key parameters | Source | P |
|---|---|---|---|
| Tile Generator | grid X/Y, shape input, scale/rotation/position jitter, offset rows | SD | P1 |
| Tile Sampler | as above, plus per-instance mask and color | SD | P2 |
| Shape Splatter | scatter an input shape by density, scale, rotation | SD | P1 |
| Splatter Circular | instances around a ring: count, radius, spiral, rotation | SD | P1 |
| Pattern Grid / Atlas | inputs 1–16 or one animated input; rows, cols, padding, order | V N | P0 |
| Random Flipbook | one graph input, N seeds → sheet | V | P0 |

## 4.6 Transform and distortion

| Node | Key parameters | Source | P |
|---|---|---|---|
| Transform 2D | offset, rotation, scale, pivot, tiling | V SD | P0 |
| Mirror / Symmetry | axis, radial symmetry count (kaleidoscope) | SD | P1 |
| Polar ↔ Cartesian | direction, center | SD N | P0 |
| Twirl | strength, radius | SD | P1 |
| Warp | input to warp, warp map (G), intensity | V SD | P0 |
| Directional Warp | angle, intensity, map | SD | P1 |
| Vector Warp | flow map (C or vector), intensity | SD | P1 |
| Curl Distort | scale, intensity, seed (Vefects curl params, usable on any image) | V | P0 |
| Make Tileable | blend width | SD | P1 |

## 4.7 Tone, color and stylization

| Node | Key parameters | Source | P |
|---|---|---|---|
| Levels | in low/high, gamma, out low/high, per channel | SD | P0 |
| Curves | curve per channel | V SD | P0 |
| Tone Range / Histogram Range | position, range, contrast | V SD | P0 |
| Histogram Scan | position, contrast | SD | P0 |
| Threshold | level, softness (pixel-aware AA) | SD N | P0 |
| Band / Posterize | count or list of thresholds, softness per band, per-band offset maps | N | P0 |
| Negative (Invert) | — | V SD | P0 |
| Clamp / Remap | min/max, input range → output range | SD | P0 |
| Palette Remap / Gradient Map | gradient (with hard stops for cel), library, sample-from-image | V SD | P0 |
| HSL | hue, saturation, lightness | SD | P1 |
| Replace Color / Color to Mask | color, tolerance | SD | P1 |
| Rim / Inner Shade | inner offset direction, width, color band — cartoon shading on a shape | N | P0 |
| Outline / Stroke | width, inside/outside/center, softness | N | P0 |
| Grayscale Conversion | weights | SD | P0 |

## 4.8 Filters

| Node | Key parameters | Source | P |
|---|---|---|---|
| Blur | radius, quality | V SD | P0 |
| Directional Blur | angle, length | SD | P1 |
| Radial / Zoom / Spin Blur | center, amount | N | P1 |
| Non-Uniform Blur | blur map, max radius | SD | P1 |
| Slope Blur | slope map, samples, intensity | SD | P1 |
| Glow | radius, intensity, threshold, tint | V | P0 |
| Erosion | erosion map, amount, edge softness, direction (from edge / by height) | V | P0 |
| Dilate / Erode (morphology) | radius | SD N | P1 |
| Edge Detect | width, roundness | SD | P1 |
| Distance | max distance, source mask, combine color | SD | P1 |
| Flood Fill (+ to random gray / to gradient) | — | SD | P2 |
| Bevel | distance, smoothing, corner type | SD | P2 |
| Sharpen | intensity | SD | P2 |
| Emboss | light angle, intensity | SD | P2 |
| Normal from Height | intensity, format (OpenGL/DirectX) | V SD | P1 |
| Normal Blend | detail normal, strength | V SD | P2 |

## 4.9 Blending and channels

| Node | Key parameters | Source | P |
|---|---|---|---|
| Blend / Layer Mix | foreground, background, mask, mode (copy, add, subtract, multiply, screen, overlay, max, min, divide, difference, soft light), opacity, alpha mode | V SD | P0 |
| Multi Blend (N layers) | layers list | N | P1 |
| Channels Split | → R, G, B, A | SD | P0 |
| Channels Merge / Shuffle | R, G, B, A ← any G input | SD | P0 |
| Alpha Merge / Alpha Split | — | SD | P0 |
| Premultiply / Unpremultiply | — | N | P0 |

## 4.10 Math and logic

| Node | Key parameters | Source | P |
|---|---|---|---|
| Math | op (add, sub, mul, div, pow, min, max, abs, sin, cos, lerp, clamp, step, smoothstep, fract, mod) | V SD | P0 |
| Random | seed, range | SD | P1 |
| Switch | bool, A, B | SD | P1 |
| Pixel Expression | WGSL snippet with typed inputs — custom per-pixel code the agent can write | SD N | P1 |
| Value Expression | expression on values | SD | P1 |
| Iterate | repeat a subgraph N times with an index (FX-map lite) | SD | P2 |

## 4.11 Outputs

| Node | Key parameters | Source | P |
|---|---|---|---|
| Output | name, usage (color, mask, erosion, flow, normal), format, bit depth, alpha mode | SD | P0 |
| Packed Output | R/G/B/A sources, format | N | P0 |
| Sheet Output | frames source, rows, cols, padding, fps, loop — writes the sidecar JSON | N | P0 |

## 4.12 Stylized recipe nodes (functions shipped as library graphs)

Built from the nodes above and shipped as editable functions, not engine code.

| Function | Builds | P |
|---|---|---|
| Cel Fire | Flame Shape → Warp (Perlin) → Erosion → Band ×3 → Palette Remap → Sheet | P0 |
| Cel Smoke Puff | Shape → Perlin warp → Band ×2 → Rim | P1 |
| Slash Arc | Slash Arc → Curl Distort → Band → Glow → Palette Remap | P1 |
| Impact Burst | Anime Star + Burst → Erosion over Time → Band | P1 |
| Magic Ring | Ring → Polar noise → Band | P1 |
| Lightning | Lightning → Glow → Palette Remap (Vefects example) | P1 |
| Dissolve Mask | Any shape → Voronoi + Perlin erosion map → G output | P1 |
