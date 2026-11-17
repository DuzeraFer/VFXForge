/** Draws an engine texture into a canvas. The canvas is premultiplied so whatever is behind it shows through alpha. */

import type { ImageResult } from "../engine/evaluator"
import type { GpuContext } from "../engine/gpu"

export const CHANNELS = ["RGBA", "RGB", "R", "G", "B", "A", "Luminance"] as const
export type Channel = (typeof CHANNELS)[number]

export type PresentOptions = {
  channel?: Channel
  /** Repeat the image this many times per axis (2 = Tile 2×2, to check seams). */
  tile?: number
}

const SHADER = /* wgsl */ `
struct Options {
  channel: u32,
  gray: u32,
  tile: f32,
  _pad: f32,
}

@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var image_sampler: sampler;
@group(0) @binding(2) var<uniform> options: Options;

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

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  var c = textureSampleLevel(image, image_sampler, fract(in.uv * options.tile), 0.0);
  if (options.gray == 1u) { c = vec4f(c.r, c.r, c.r, 1.0); }
  c = clamp(c, vec4f(0.0), vec4f(1.0));
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
`

export type Presenter = {
  present: (image: ImageResult, options?: PresentOptions) => void
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
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
    ]
  })
  const pipeline = device.createRenderPipeline({
    label: "present",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: canvasFormat }] }
  })
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" })
  const uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

  const draw = (image: ImageResult | null, options: PresentOptions): void => {
    if (canvas.width === 0 || canvas.height === 0) return
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }
      ]
    })
    if (image) {
      const data = new ArrayBuffer(16)
      const view = new DataView(data)
      view.setUint32(0, Math.max(0, CHANNELS.indexOf(options.channel ?? "RGBA")), true)
      view.setUint32(4, image.type === "gray" ? 1 : 0, true)
      view.setFloat32(8, options.tile ?? 1, true)
      device.queue.writeBuffer(uniforms, 0, data)
      pass.setPipeline(pipeline)
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: image.texture.createView() },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: uniforms } }
          ]
        })
      )
      pass.draw(3)
    }
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  return {
    present: (image, options = {}) => draw(image, options),
    clear: () => draw(null, {}),
    destroy() {
      uniforms.destroy()
      context.unconfigure()
    }
  }
}
