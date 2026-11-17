/** Draws an engine texture into a canvas. The canvas is premultiplied so the checker behind it shows through alpha. */

import type { ImageResult } from "../engine/evaluator"
import type { GpuContext } from "../engine/gpu"

const SHADER = /* wgsl */ `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var image_sampler: sampler;

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
fn fs_color(in: VertexOut) -> @location(0) vec4f {
  let c = clamp(textureSampleLevel(image, image_sampler, in.uv, 0.0), vec4f(0.0), vec4f(1.0));
  return vec4f(c.rgb * c.a, c.a);
}

@fragment
fn fs_gray(in: VertexOut) -> @location(0) vec4f {
  let v = clamp(textureSampleLevel(image, image_sampler, in.uv, 0.0).r, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}
`

export type Presenter = {
  present: (image: ImageResult) => void
  destroy: () => void
}

export function createPresenter(gpu: GpuContext, canvas: HTMLCanvasElement): Presenter {
  const { device, canvasFormat } = gpu
  const context = canvas.getContext("webgpu")
  if (!context) throw new Error("Could not get a WebGPU context for the preview canvas.")
  context.configure({ device, format: canvasFormat, alphaMode: "premultiplied" })

  const module = device.createShaderModule({ label: "present", code: SHADER })
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } }
    ]
  })
  const pipeline = (entryPoint: string): GPURenderPipeline =>
    device.createRenderPipeline({
      label: `present-${entryPoint}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint, targets: [{ format: canvasFormat }] }
    })
  const pipelines = { color: pipeline("fs_color"), gray: pipeline("fs_gray") }
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" })

  return {
    present(image) {
      if (canvas.width === 0 || canvas.height === 0) return
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }
        ]
      })
      pass.setPipeline(pipelines[image.type])
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: image.texture.createView() },
            { binding: 1, resource: sampler }
          ]
        })
      )
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
    },
    destroy() {
      context.unconfigure()
    }
  }
}
