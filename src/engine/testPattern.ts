import type { GpuContext } from "./gpu"
import shader from "./wgsl/testPattern.wgsl?raw"

/** Seconds for one full loop of the test pattern. */
export const TEST_PATTERN_LOOP_SECONDS = 4

export type TestPattern = {
  /** Draws one frame. `phase` is the loop position in [0, 1). */
  draw: (phase: number) => void
  destroy: () => void
}

export function createTestPattern(gpu: GpuContext, canvas: HTMLCanvasElement): TestPattern {
  const { device, canvasFormat } = gpu
  const context = canvas.getContext("webgpu")
  if (!context) throw new Error("Could not get a WebGPU context for the preview canvas.")
  context.configure({ device, format: canvasFormat, alphaMode: "opaque" })

  const module = device.createShaderModule({ label: "test-pattern", code: shader })
  const pipeline = device.createRenderPipeline({
    label: "test-pattern",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list" }
  })

  const uniforms = device.createBuffer({
    label: "test-pattern-uniforms",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  })
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniforms } }]
  })
  const data = new Float32Array(4)

  return {
    draw(phase) {
      if (canvas.width === 0 || canvas.height === 0) return
      data[0] = phase
      device.queue.writeBuffer(uniforms, 0, data)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store"
          }
        ]
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
    },
    destroy() {
      uniforms.destroy()
      context.unconfigure()
    }
  }
}
