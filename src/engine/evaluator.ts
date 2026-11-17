/**
 * Pull-based graph evaluation on WebGPU (docs/06 §6.6).
 *
 * A node output is identified by a content key: a hash of its type, resolved
 * parameters, the keys of its inputs, the resolution, the seed and (only for
 * time-dependent nodes) the frame. Results are cached by key, so:
 *  - nothing is rendered unless something asks for it,
 *  - an edit only re-renders what is downstream of it (the keys change),
 *  - time dependence spreads through input keys on its own.
 */

import { parseSocketRef, type Graph, type Node, type ParamValue } from "../doc/types"
import type { GpuContext } from "./gpu"
import type { DataType, EvalContext, NodeRegistry, ResolvedNodeDef } from "./nodeDef"
import { buildLayout, buildShader, GLOBALS_SIZE, packGlobals, packParams, variantKey, type InputBinding, type UniformLayout } from "./shader"
import { resolveGraph, type Problem, type ResolvedGraph } from "./validate"

export class EvalError extends Error {
  constructor(
    readonly nodeId: string,
    message: string,
    readonly problems: Problem[] = []
  ) {
    super(message)
    this.name = "EvalError"
  }
}

export type ImageResult = {
  texture: GPUTexture
  type: "gray" | "color"
  width: number
  height: number
  key: string
}

const FORMAT: Record<"gray" | "color", GPUTextureFormat> = { gray: "r16float", color: "rgba16float" }
const BYTES_PER_PIXEL: Record<"gray" | "color", number> = { gray: 2, color: 8 }

/** cyrb53: fast 53-bit string hash. Keys also carry the string length. */
function hashString(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + "." + text.length.toString(36)
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((k) => `${k}:${stable(record[k])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

type CacheEntry = { result: ImageResult; bytes: number; lastUsed: number }

type CompiledNode = { def: ResolvedNodeDef; layout: UniformLayout }

type Pipeline = { pipeline: GPURenderPipeline; textures: string[] }

export type EngineOptions = {
  /** Texture cache budget in bytes. Default 256 MB. */
  cacheBytes?: number
}

export type EngineStats = { renders: number; cacheHits: number; cachedTextures: number; cachedBytes: number }

export class Engine {
  private graph: Graph | null = null
  private resolved: ResolvedGraph | null = null
  private projectSeed = 0
  private nodes = new Map<string, Node>()
  private linkByTarget = new Map<string, string>()
  private problemsByNode = new Map<string, Problem[]>()

  private readonly compiled = new Map<string, CompiledNode>()
  private readonly pipelines = new Map<string, Pipeline>()
  private readonly cache = new Map<string, CacheEntry>()
  private cachedBytes = 0
  private clock = 0
  private readonly samplers: Record<string, GPUSampler>
  private readonly cacheBudget: number
  private readonly group0: GPUBindGroupLayout
  private readonly textureGroups = new Map<number, GPUBindGroupLayout>()
  private pendingChecks: Promise<void>[] = []
  private readonly shaderErrors = new Map<string, string>()

  /** Memo for one `evaluate` / `keyOf` call tree: keys and values per frame. */
  private memoFrame = -1
  private keyMemo = new Map<string, string>()
  private valueMemo = new Map<string, number>()

  stats: EngineStats = { renders: 0, cacheHits: 0, cachedTextures: 0, cachedBytes: 0 }

  constructor(
    private readonly gpu: GpuContext,
    private readonly registry: NodeRegistry,
    options: EngineOptions = {}
  ) {
    this.cacheBudget = options.cacheBytes ?? 256 * 1024 * 1024
    const make = (mode: GPUAddressMode): GPUSampler =>
      gpu.device.createSampler({ addressModeU: mode, addressModeV: mode, magFilter: "linear", minFilter: "linear" })
    this.group0 = gpu.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } }
      ]
    })
    this.samplers = { tile: make("repeat"), clamp: make("clamp-to-edge"), mirror: make("mirror-repeat") }
  }

  /** Points the engine at a graph. Cheap: cached textures stay valid, since they are keyed by content. */
  setGraph(graph: Graph, projectSeed: number): ResolvedGraph {
    if (graph === this.graph && projectSeed === this.projectSeed && this.resolved) return this.resolved
    this.graph = graph
    this.projectSeed = projectSeed
    this.resolved = resolveGraph(graph, this.registry)
    this.nodes = new Map(graph.nodes.map((n) => [n.id, n]))
    this.linkByTarget = new Map(graph.links.map((l) => [l.to, l.from]))
    this.problemsByNode = new Map()
    for (const problem of this.resolved.problems) {
      const list = this.problemsByNode.get(problem.nodeId)
      if (list) list.push(problem)
      else this.problemsByNode.set(problem.nodeId, [problem])
    }
    this.resetMemo(-1)
    return this.resolved
  }

  get problems(): Problem[] {
    return this.resolved?.problems ?? []
  }

  private resetMemo(frame: number): void {
    this.memoFrame = frame
    this.keyMemo = new Map()
    this.valueMemo = new Map()
  }

  private useFrame(frame: number): void {
    if (frame !== this.memoFrame) this.resetMemo(frame)
  }

  private need(nodeId: string): { node: Node; def: ResolvedNodeDef } {
    if (!this.graph) throw new Error("Engine.setGraph was not called.")
    const node = this.nodes.get(nodeId)
    if (!node) throw new EvalError(nodeId, `No node "${nodeId}".`)
    const problems = this.problemsByNode.get(nodeId)
    if (problems) throw new EvalError(nodeId, problems[0].message, problems)
    return { node, def: this.registry.get(node.type)! }
  }

  private timeOf(frame: number): Pick<EvalContext, "frame" | "frames" | "fps" | "phase"> {
    const { frames, fps } = this.graph!.settings
    return { frame, frames, fps, phase: (((frame % frames) + frames) % frames) / frames }
  }

  /** Parameters with defaults filled in and driven values applied, for one frame. */
  private paramsOf(node: Node, def: ResolvedNodeDef, frame: number): Record<string, ParamValue> {
    const values: Record<string, ParamValue> = {}
    for (const [name, schema] of Object.entries(def.params)) {
      values[name] = name in node.params ? node.params[name] : (schema.default as ParamValue)
    }
    for (const [param, ref] of Object.entries(node.driven)) {
      const from = parseSocketRef(ref)!
      const value = this.valueOfFrame(from.nodeId, from.socket, frame)
      values[param] = def.params[param].type === "int" ? Math.round(value) : value
    }
    return values
  }

  /** Value of a value-type output at a frame. */
  valueOf(nodeId: string, output: string, frame: number): number {
    this.useFrame(frame)
    return this.valueOfFrame(nodeId, output, frame)
  }

  private valueOfFrame(nodeId: string, output: string, frame: number): number {
    const memoKey = `${nodeId}.${output}`
    const cached = this.valueMemo.get(memoKey)
    if (cached !== undefined) return cached
    const { node, def } = this.need(nodeId)
    if (!def.evaluate) throw new EvalError(nodeId, `"${memoKey}" is an image, not a value.`)
    const inputs: Record<string, number> = {}
    for (const name of Object.keys(def.inputs)) {
      const source = this.linkByTarget.get(`${nodeId}.${name}`)
      if (!source) continue
      const from = parseSocketRef(source)!
      inputs[name] = this.valueOfFrame(from.nodeId, from.socket, frame)
    }
    const outputs = def.evaluate({ params: this.paramsOf(node, def, frame), inputs, ...this.timeOf(frame) })
    for (const [name, value] of Object.entries(outputs)) this.valueMemo.set(`${nodeId}.${name}`, value)
    const value = outputs[output]
    if (value === undefined) throw new EvalError(nodeId, `"${node.type}" has no output "${output}".`)
    return value
  }

  /** A bypassed node passes its first connected image input through. */
  private bypassSource(node: Node, def: ResolvedNodeDef): string | null {
    if (!node.bypass) return null
    for (const name of Object.keys(def.inputs)) {
      const source = this.linkByTarget.get(`${node.id}.${name}`)
      if (source) return source
    }
    return null
  }

  /** Content key of an image output at a frame. No GPU work. Equal keys mean equal pixels. */
  keyOf(nodeId: string, output: string, frame: number): string {
    this.useFrame(frame)
    return this.keyOfFrame(nodeId, output, frame)
  }

  private keyOfFrame(nodeId: string, output: string, frame: number): string {
    const memoKey = `${nodeId}.${output}`
    const cached = this.keyMemo.get(memoKey)
    if (cached) return cached
    const { node, def } = this.need(nodeId)
    if (!def.wgsl) throw new EvalError(nodeId, `"${memoKey}" is a value, not an image.`)
    if (!(output in def.outputs)) throw new EvalError(nodeId, `"${node.type}" has no output "${output}".`)

    let key: string
    const bypass = this.bypassSource(node, def)
    if (bypass) {
      const from = parseSocketRef(bypass)!
      key = this.keyOfFrame(from.nodeId, from.socket, frame)
    } else {
      const inputKeys: Record<string, string> = {}
      for (const name of Object.keys(def.inputs)) {
        const source = this.linkByTarget.get(`${nodeId}.${name}`)
        if (!source) continue
        const from = parseSocketRef(source)!
        inputKeys[name] = this.keyOfFrame(from.nodeId, from.socket, frame)
      }
      const { width, height } = this.graph!.settings
      const time = this.timeOf(frame)
      key = hashString(
        stable({
          type: def.type,
          output,
          as: this.resolved!.outputTypes.get(memoKey),
          params: this.paramsOf(node, def, frame),
          inputs: inputKeys,
          size: [width, height],
          seed: def.seeded ? this.projectSeed : 0,
          time: def.usesTime ? [time.frame % time.frames, time.frames, time.fps] : null
        })
      )
    }
    this.keyMemo.set(memoKey, key)
    return key
  }

  /** Renders (or fetches from cache) an image output at a frame. */
  evaluate(nodeId: string, output: string, frame: number): ImageResult {
    this.useFrame(frame)
    this.clock++
    const result = this.evaluateFrame(nodeId, output, frame)
    this.evict()
    return result
  }

  private evaluateFrame(nodeId: string, output: string, frame: number): ImageResult {
    const key = this.keyOfFrame(nodeId, output, frame)
    const hit = this.cache.get(key)
    if (hit) {
      hit.lastUsed = this.clock
      this.stats.cacheHits++
      return hit.result
    }

    const { node, def } = this.need(nodeId)
    const bypass = this.bypassSource(node, def)
    if (bypass) {
      const from = parseSocketRef(bypass)!
      return this.evaluateFrame(from.nodeId, from.socket, frame)
    }

    const inputs: Record<string, ImageResult> = {}
    const bound: InputBinding = {}
    for (const name of Object.keys(def.inputs)) {
      const source = this.linkByTarget.get(`${nodeId}.${name}`)
      if (!source) {
        bound[name] = null
        continue
      }
      const from = parseSocketRef(source)!
      inputs[name] = this.evaluateFrame(from.nodeId, from.socket, frame)
      bound[name] = inputs[name].type
    }

    const type = this.resolved!.outputTypes.get(`${nodeId}.${output}`) as "gray" | "color"
    const { width, height } = this.graph!.settings
    const texture = this.gpu.device.createTexture({
      label: `${def.type}:${nodeId}.${output}`,
      size: [width, height],
      format: FORMAT[type],
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
    })
    const params = this.paramsOf(node, def, frame)
    this.render(def, Object.keys(def.outputs).indexOf(output), type, bound, inputs, params, frame, texture, node)

    const result: ImageResult = { texture, type, width, height, key }
    const bytes = width * height * BYTES_PER_PIXEL[type]
    this.cache.set(key, { result, bytes, lastUsed: this.clock })
    this.cachedBytes += bytes
    this.stats.renders++
    return result
  }

  private compile(def: ResolvedNodeDef): CompiledNode {
    let compiled = this.compiled.get(def.type)
    if (!compiled) {
      compiled = { def, layout: buildLayout(def.params) }
      this.compiled.set(def.type, compiled)
    }
    return compiled
  }

  private textureGroup(count: number): GPUBindGroupLayout {
    let layout = this.textureGroups.get(count)
    if (!layout) {
      layout = this.gpu.device.createBindGroupLayout({
        entries: Array.from({ length: count }, (_, binding) => ({
          binding,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" as const }
        }))
      })
      this.textureGroups.set(count, layout)
    }
    return layout
  }

  private pipelineFor(def: ResolvedNodeDef, layout: UniformLayout, bound: InputBinding, outputIndex: number, type: "gray" | "color"): Pipeline {
    const key = `${variantKey(def, bound, outputIndex)}|${type}`
    let entry = this.pipelines.get(key)
    if (!entry) {
      const variant = buildShader(def, layout, bound, outputIndex)
      const module = this.gpu.device.createShaderModule({ label: key, code: variant.code })
      // Compile errors arrive asynchronously; `settle` reports them.
      this.pendingChecks.push(
        module.getCompilationInfo().then((info) => {
          const errors = info.messages.filter((m) => m.type === "error")
          if (errors.length > 0) {
            const lines = variant.code.split("\n")
            const text = errors.map((m) => `${m.message} (line: ${lines[m.lineNum - 1]?.trim() ?? ""})`).join("; ")
            this.shaderErrors.set(def.type, text)
          }
        })
      )
      // Explicit layouts: every node gets the same group 0, whether or not its code reads each binding.
      const layouts = [this.group0, this.textureGroup(variant.textures.length)]
      const pipeline = this.gpu.device.createRenderPipeline({
        label: key,
        layout: this.gpu.device.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: FORMAT[type] }] },
        primitive: { topology: "triangle-list" }
      })
      entry = { pipeline, textures: variant.textures }
      this.pipelines.set(key, entry)
    }
    return entry
  }

  private render(
    def: ResolvedNodeDef,
    outputIndex: number,
    type: "gray" | "color",
    bound: InputBinding,
    inputs: Record<string, ImageResult>,
    params: Record<string, ParamValue>,
    frame: number,
    target: GPUTexture,
    node: Node
  ): void {
    const { device } = this.gpu
    const { layout } = this.compile(def)
    const { pipeline, textures } = this.pipelineFor(def, layout, bound, outputIndex, type)
    const { width, height } = this.graph!.settings
    const time = this.timeOf(frame)

    const uniform = (data: ArrayBuffer, size: number): GPUBuffer => {
      const buffer = device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(buffer, 0, data)
      return buffer
    }
    const seedOffset = def.seeded ? (params.seed as number) : 0
    const globals = uniform(
      packGlobals({
        width,
        height,
        phase: time.phase,
        frame: time.frame,
        frames: time.frames,
        seed: (this.projectSeed + seedOffset) | 0,
        seconds: time.frame / time.fps
      }),
      GLOBALS_SIZE
    )
    const paramBuffer = uniform(packParams(layout, def.params, params), layout.size)

    const sampler = this.samplers[(params.tiling as string) ?? "tile"] ?? this.samplers.tile
    const group0 = device.createBindGroup({
      layout: this.group0,
      entries: [
        { binding: 0, resource: { buffer: globals } },
        { binding: 1, resource: { buffer: paramBuffer } },
        { binding: 2, resource: sampler }
      ]
    })
    const group1 = device.createBindGroup({
      layout: this.textureGroup(textures.length),
      entries: textures.map((name, binding) => ({ binding, resource: inputs[name].texture.createView() }))
    })

    const encoder = device.createCommandEncoder({ label: `${def.type}:${node.id}` })
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }]
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group0)
    pass.setBindGroup(1, group1)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
    globals.destroy()
    paramBuffer.destroy()
  }

  /**
   * Waits for shader compilation of everything rendered so far. Throws if a
   * node's shader failed to compile; results rendered with it are discarded.
   * Call it before trusting pixels (readback does).
   */
  async settle(): Promise<void> {
    const checks = this.pendingChecks.splice(0)
    await Promise.all(checks)
    if (this.shaderErrors.size === 0) return
    const [[type, text]] = this.shaderErrors
    this.shaderErrors.clear()
    for (const key of [...this.pipelines.keys()]) if (key.startsWith(`${type}|`)) this.pipelines.delete(key)
    this.dispose()
    const node = this.graph?.nodes.find((n) => n.type === type)
    throw new EvalError(node?.id ?? type, `Shader of node type "${type}" does not compile: ${text}`)
  }

  /** Drops least recently used textures over budget. Textures touched by the current call are kept. */
  private evict(): void {
    if (this.cachedBytes > this.cacheBudget) {
      const entries = [...this.cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
      for (const [key, entry] of entries) {
        if (this.cachedBytes <= this.cacheBudget || entry.lastUsed === this.clock) break
        entry.result.texture.destroy()
        this.cache.delete(key)
        this.cachedBytes -= entry.bytes
      }
    }
    this.stats.cachedTextures = this.cache.size
    this.stats.cachedBytes = this.cachedBytes
  }

  /** Reads an image back as RGBA floats, row by row from the top. Gray is expanded to r = g = b, a = 1. */
  async readPixels(image: ImageResult): Promise<Float32Array> {
    await this.settle()
    const { device } = this.gpu
    const { width, height, type } = image
    const bytesPerPixel = BYTES_PER_PIXEL[type]
    const bytesPerRow = Math.ceil((width * bytesPerPixel) / 256) * 256
    const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: image.texture }, { buffer, bytesPerRow }, [width, height])
    device.queue.submit([encoder.finish()])
    await buffer.mapAsync(GPUMapMode.READ)
    const halves = new Uint16Array(buffer.getMappedRange())
    const out = new Float32Array(width * height * 4)
    const rowStride = bytesPerRow / 2
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4
        if (type === "gray") {
          const v = halfToFloat(halves[y * rowStride + x])
          out[o] = out[o + 1] = out[o + 2] = v
          out[o + 3] = 1
        } else {
          const i = y * rowStride + x * 4
          out[o] = halfToFloat(halves[i])
          out[o + 1] = halfToFloat(halves[i + 1])
          out[o + 2] = halfToFloat(halves[i + 2])
          out[o + 3] = halfToFloat(halves[i + 3])
        }
      }
    }
    buffer.unmap()
    buffer.destroy()
    return out
  }

  /** Frees every cached texture. */
  dispose(): void {
    for (const entry of this.cache.values()) entry.result.texture.destroy()
    this.cache.clear()
    this.cachedBytes = 0
  }
}

export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1
  const exponent = (h >> 10) & 0x1f
  const fraction = h & 0x3ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 31) return fraction ? Number.NaN : sign * Infinity
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

/** Float RGBA (as displayed, straight alpha) to 8-bit. */
export function toRgba8(pixels: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length)
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i]
    out[i] = Number.isNaN(v) ? 0 : Math.round(Math.min(1, Math.max(0, v)) * 255)
  }
  return out
}
