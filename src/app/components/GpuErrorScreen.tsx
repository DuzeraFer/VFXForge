import type { ReactElement } from "react"
import type { GpuFailure } from "../../engine/gpu"

type Props = { failure: GpuFailure; onRetry: () => void }

export function GpuErrorScreen({ failure, onRetry }: Props): ReactElement {
  return (
    <div className="gpu-error" role="alert">
      <div className="gpu-error-card">
        <div className="label gpu-error-label">Graphics unavailable</div>
        <h1>VFXForge can't start its GPU engine</h1>
        <p>{failure.message}</p>
        <ul>
          <li>Update your graphics driver, then restart VFXForge.</li>
          <li>On a laptop with two GPUs, make sure the app is allowed to use one of them.</li>
          <li>Remote desktop sessions and virtual machines often have no WebGPU support.</li>
        </ul>
        {failure.detail && <pre className="mono gpu-error-detail">{failure.detail}</pre>}
        <button className="button-primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  )
}
