/**
 * Draws images into the cells of a sheet (docs/06 §6.7): sprite sheets,
 * pattern grids and flipbooks. Every cell is one graph-sized image with
 * `padding` pixels of gutter on each side, so the sheet is an even grid that
 * a game engine can cut by rows and columns.
 *
 * Edge dilation: with `dilate` > 0, pixels that are transparent take
 * the color (not the alpha) of the nearest visible pixel within that many
 * pixels, and the gutter repeats the cell's border. Texture filtering and
 * mipmaps then blend with the sprite's own color instead of black.
 */

import type { GpuContext } from "./gpu"
import type { SheetPlan } from "./nodeDef"

export type SheetSize = { width: number; height: number; cols: number; rows: number; cellWidth: number; cellHeight: number }

/** Size of the sheet a plan makes from cells of the given size. */
export function sheetSize(plan: Pick<SheetPlan, "cols" | "padding"> & { cells: { length: number } }, cellWidth: number, cellHeight: number): SheetSize {
  const cols = Math.max(1, plan.cols)
  const rows = Math.max(1, Math.ceil(plan.cells.length / cols))
  const pitchX = cellWidth + plan.padding * 2
  const pitchY = cellHeight + plan.padding * 2
  return { width: cols * pitchX, height: rows * pitchY, cols, rows, cellWidth: pitchX, cellHeight: pitchY }
}

/** Columns for a count of cells: the asked number, or the squarest grid when it is 0. */
export function sheetCols(count: number, asked: number): number {
  return Math.max(1, Math.min(Math.max(1, count), asked > 0 ? asked : Math.ceil(Math.sqrt(count))))
}

const SHADER = /* wgsl */ `
struct Cell {
  // Size of the image inside the cell, in pixels.
  size: vec2f,
  padding: f32,
  dilate: f32,
  source_gray: u32,
}

@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var image_sampler: sampler;
@group(0) @binding(2) var<uniform> cell: Cell;

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

fn read(pixel: vec2f) -> vec4f {
  let c = textureSampleLevel(image, image_sampler, pixel / cell.size, 0.0);
  if (cell.source_gray == 1u) { return vec4f(c.r, c.r, c.r, 1.0); }
  return c;
}

// Below one step of 8-bit alpha a pixel counts as empty.
const VISIBLE = 0.004;

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  // Position in the image's own pixels; the gutter is outside 0..size.
  let p = in.uv * (cell.size + 2.0 * cell.padding) - cell.padding;
  let inside = all(p >= vec2f(0.0)) && all(p <= cell.size);
  if (!inside && cell.dilate <= 0.0) { return vec4f(0.0); }
  let q = clamp(p, vec2f(0.5), cell.size - 0.5);
  var c = read(q);
  if (cell.dilate > 0.0 && c.a < VISIBLE) {
    // The nearest visible pixel within reach gives its color; alpha stays 0.
    let reach = i32(cell.dilate);
    var best = f32(reach * reach) + 1.0;
    for (var dy = -reach; dy <= reach; dy++) {
      for (var dx = -reach; dx <= reach; dx++) {
        let offset = vec2f(f32(dx), f32(dy));
        let distance = dot(offset, offset);
        if (distance >= best) { continue; }
        let at = q + offset;
        if (any(at < vec2f(0.0)) || any(at > cell.size)) { continue; }
        let s = read(at);
        if (s.a >= VISIBLE) {
          best = distance;
          c = vec4f(s.rgb, 0.0);
        }
      }
    }
  }
  return c;
}
`

type Format = "gray" | "color"
const TARGET: Record<Format, GPUTextureFormat> = { gray: "r16float", color: "rgba16float" }

export type SheetBlitter = {
  /** Clears `target` and draws each cell (null leaves its cell empty). */
  draw: (
    target: GPUTexture,
    type: Format,
    plan: SheetPlan,
    cellWidth: number,
    cellHeight: number,
    cells: readonly ({ texture: GPUTexture; type: Format } | null)[]
  ) => void
}

export function createSheetBlitter(gpu: GpuContext): SheetBlitter {
  const { device } = gpu
  const module = device.createShaderModule({ label: "sheet", code: SHADER })
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
    ]
  })
  const pipelines = new Map<Format, GPURenderPipeline>()
  const pipelineFor = (type: Format): GPURenderPipeline => {
    let pipeline = pipelines.get(type)
    if (!pipeline) {
      pipeline = device.createRenderPipeline({
        label: `sheet:${type}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: TARGET[type] }] }
      })
      pipelines.set(type, pipeline)
    }
    return pipeline
  }
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" })

  return {
    draw(target, type, plan, cellWidth, cellHeight, cells) {
      const size = sheetSize(plan, cellWidth, cellHeight)
      const uniforms = (["color", "gray"] as const).map((source) => {
        const data = new ArrayBuffer(32)
        const view = new DataView(data)
        view.setFloat32(0, cellWidth, true)
        view.setFloat32(4, cellHeight, true)
        view.setFloat32(8, plan.padding, true)
        view.setFloat32(12, plan.dilate, true)
        view.setUint32(16, source === "gray" ? 1 : 0, true)
        const buffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
        device.queue.writeBuffer(buffer, 0, data)
        return buffer
      })
      const encoder = device.createCommandEncoder({ label: "sheet" })
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }]
      })
      pass.setPipeline(pipelineFor(type))
      cells.forEach((cell, index) => {
        if (!cell) return
        pass.setViewport((index % size.cols) * size.cellWidth, Math.floor(index / size.cols) * size.cellHeight, size.cellWidth, size.cellHeight, 0, 1)
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout,
            entries: [
              { binding: 0, resource: cell.texture.createView() },
              { binding: 1, resource: sampler },
              { binding: 2, resource: { buffer: uniforms[cell.type === "gray" ? 1 : 0] } }
            ]
          })
        )
        pass.draw(3)
      })
      pass.end()
      device.queue.submit([encoder.finish()])
      for (const buffer of uniforms) buffer.destroy()
    }
  }
}
