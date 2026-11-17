/** WebGPU device setup shared by the preview and, later, the graph engine. */

export type GpuContext = {
  adapter: GPUAdapter
  device: GPUDevice
  /** Preferred swap-chain format for canvases on this machine. */
  canvasFormat: GPUTextureFormat
}

export type GpuFailure = {
  reason: "unsupported" | "no-adapter" | "device-error" | "device-lost"
  /** Plain sentence for the error screen. */
  message: string
  /** Raw error text, if any, for bug reports. */
  detail?: string
}

export type GpuResult = { ok: true; gpu: GpuContext } | { ok: false; failure: GpuFailure }

export async function initGpu(): Promise<GpuResult> {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    return {
      ok: false,
      failure: {
        reason: "unsupported",
        message: "WebGPU is not available in this environment."
      }
    }
  }

  try {
    const adapter =
      (await navigator.gpu.requestAdapter({ powerPreference: "high-performance" })) ??
      (await navigator.gpu.requestAdapter())
    if (!adapter) {
      return {
        ok: false,
        failure: {
          reason: "no-adapter",
          message: "No compatible graphics adapter was found."
        }
      }
    }

    const device = await adapter.requestDevice({ label: "vfxforge" })
    return {
      ok: true,
      gpu: { adapter, device, canvasFormat: navigator.gpu.getPreferredCanvasFormat() }
    }
  } catch (error) {
    return {
      ok: false,
      failure: {
        reason: "device-error",
        message: "The graphics device could not be created.",
        detail: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

export function deviceLostFailure(info: GPUDeviceLostInfo): GpuFailure {
  return {
    reason: "device-lost",
    message: "The graphics device stopped responding.",
    detail: info.message || undefined
  }
}
