/** Draws an engine texture into a canvas. The canvas is premultiplied so whatever is behind it shows through alpha. */

import type { ImageResult } from "../engine/evaluator"
import type { GpuContext } from "../engine/gpu"

export const CHANNELS = ["RGBA", "RGB", "R", "G", "B", "A", "Luminance"] as const
export type Channel = (typeof CHANNELS)[number]

export type PresentOptions = {
  channel?: Channel
  /** Repeat the image this many times per axis (2 = Tile 2×2, to check seams). */
  tile?: number
  /** Show where the image differs from this one (same size), as heat on dark, instead of the image itself. */
  difference?: ImageResult
}

/** One image of a stack drawn back to front, for onion skins. */
export type Layer = { image: ImageResult; opacity?: number; tint?: [number, number, number] }

const SHADER = /* wgsl */ `
struct Options {
  channel: u32,
  gray: u32,
  tile: f32,
  opacity: f32,
  // rgb, and how much of it replaces the image's own color.
  tint: vec4f,
  difference: u32,
  other_gray: u32,
}

@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var image_sampler: sampler;
@group(0) @binding(2) var<uniform> options: Options;
@group(0) @binding(3) var other: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: VertexOut;
  out.position = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(corner.x, 1.0 - corner.y);
  return out;
}

fn channels(c: vec4f) -> vec4f {
  switch options.channel {
    case 1u { return vec4f(c.rgb, 1.0); }
    case 2u { return vec4f(c.r, c.r, c.r, 1.0); }
    case 3u { return vec4f(c.g, c.g, c.g, 1.0); }
    case 4u { return vec4f(c.b, c.b, c.b, 1.0); }
    case 5u { return vec4f(c.a, c.a, c.a, 1.0); }
    case 6u {
      let l = dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
      return vec4f(l, l, l, 1.0);
    }
    default { return vec4f(c.rgb * c.a, c.a); }
  }
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let uv = fract(in.uv * options.tile);
  var c = textureSampleLevel(image, image_sampler, uv, 0.0);
  if (options.gray == 1u) { c = vec4f(c.r, c.r, c.r, 1.0); }
  c = clamp(c, vec4f(0.0), vec4f(1.0));
  if (options.difference == 1u) {
    var o = textureSampleLevel(other, image_sampler, uv, 0.0);
    if (options.other_gray == 1u) { o = vec4f(o.r, o.r, o.r, 1.0); }
    o = clamp(o, vec4f(0.0), vec4f(1.0));
    // Compare what is seen: color weighted by alpha.
    let d = abs(vec4f(c.rgb * c.a, c.a) - vec4f(o.rgb * o.a, o.a));
    let heat = clamp(max(max(d.r, d.g), max(d.b, d.a)) * 3.0, 0.0, 1.0);
    let base = dot(c.rgb * c.a, vec3f(0.2126, 0.7152, 0.0722)) * 0.18 + 0.04;
    return vec4f(mix(vec3f(base), vec3f(1.0, 0.36, 0.12), heat), 1.0);
  }
  var shown = channels(c);
  shown = vec4f(mix(shown.rgb, options.tint.rgb * shown.a, options.tint.a), shown.a);
  return shown * options.opacity;
}
`

export type Presenter = {
  present: (image: ImageResult, options?: PresentOptions) => void
  /** Draws several images over each other, the first at the back. */
  presentLayers: (layers: readonly Layer[], options?: PresentOptions) => void
  /** Clears the canvas to transparent. */
  clear: () => void
  destroy: () => void
}

export function createPresenter(gpu: GpuContext, canvas: HTMLCanvasElement | OffscreenCanvas): Presenter {
  const { device, canvasFormat } = gpu
  const context = canvas.getContext("webgpu") as GPUCanvasContext | null
  if (!context) throw new Error("Could not get a WebGPU context for the canvas.")
  context.configure({ device, format: canvasFormat, alphaMode: "premultiplied" })

  const module = device.createShaderModule({ label: "present", code: SHADER })
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }
    ]
  })
  // Premultiplied "over", so layers stack and the page shows through.
  const blend: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }
  }
  const pipeline = device.createRenderPipeline({
    label: "present",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: canvasFormat, blend }] }
  })
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" })
  const UNIFORM_SIZE = 48

  const draw = (layers: readonly Layer[], options: PresentOptions): void => {
    if (canvas.width === 0 || canvas.height === 0) return
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }
      ]
    })
    const buffers: GPUBuffer[] = []
    for (const layer of layers) {
      const { image } = layer
      const data = new ArrayBuffer(UNIFORM_SIZE)
      const view = new DataView(data)
      view.setUint32(0, Math.max(0, CHANNELS.indexOf(options.channel ?? "RGBA")), true)
      view.setUint32(4, image.type === "gray" ? 1 : 0, true)
      view.setFloat32(8, options.tile ?? 1, true)
      view.setFloat32(12, layer.opacity ?? 1, true)
      ;(layer.tint ?? [0, 0, 0]).forEach((v, i) => view.setFloat32(16 + i * 4, v, true))
      view.setFloat32(28, layer.tint ? 0.6 : 0, true)
      view.setUint32(32, options.difference ? 1 : 0, true)
      view.setUint32(36, options.difference?.type === "gray" ? 1 : 0, true)
      const uniforms = device.createBuffer({ size: UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(uniforms, 0, data)
      buffers.push(uniforms)
      pass.setPipeline(pipeline)
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: image.texture.createView() },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: uniforms } },
            { binding: 3, resource: (options.difference ?? image).texture.createView() }
          ]
        })
      )
      pass.draw(3)
    }
    pass.end()
    device.queue.submit([encoder.finish()])
    for (const buffer of buffers) buffer.destroy()
  }

  return {
    present: (image, options = {}) => draw([{ image }], options),
    presentLayers: (layers, options = {}) => draw(layers, options),
    clear: () => draw([], {}),
    destroy() {
      context.unconfigure()
    }
  }
}
