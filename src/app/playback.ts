/** Which frame is shown, and whether it is playing. Shared by Preview, the timeline and node thumbnails. */

import { useSyncExternalStore } from "react"

export type PlaybackState = { playing: boolean; frame: number }

class Playback {
  private state: PlaybackState = { playing: true, frame: 0 }
  private frames = 1
  private fps = 12
  private startTime = 0
  private readonly listeners = new Set<() => void>()

  constructor() {
    if (typeof requestAnimationFrame === "undefined") return
    const tick = (now: number): void => {
      requestAnimationFrame(tick)
      if (!this.state.playing || this.frames <= 1) return
      const frame = Math.floor(((now - this.startTime) / 1000) * this.fps) % this.frames
      if (frame !== this.state.frame) this.set({ ...this.state, frame })
    }
    requestAnimationFrame(tick)
  }

  private set(state: PlaybackState): void {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }

  private restartClock(): void {
    // Keep the current frame as the starting point of the running clock.
    this.startTime = performance.now() - (this.state.frame / this.fps) * 1000
  }

  getState = (): PlaybackState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Called when the active graph or its timing changes. */
  configure(frames: number, fps: number): void {
    if (frames === this.frames && fps === this.fps) return
    this.frames = Math.max(1, frames)
    this.fps = fps
    this.set({ ...this.state, frame: Math.min(this.state.frame, this.frames - 1) })
    this.restartClock()
  }

  setPlaying(playing: boolean): void {
    if (playing) this.restartClock()
    this.set({ ...this.state, playing })
  }

  /** Jumps to a frame and pauses. */
  seek(frame: number): void {
    const wrapped = ((Math.round(frame) % this.frames) + this.frames) % this.frames
    this.set({ playing: false, frame: wrapped })
  }

  step(delta: number): void {
    this.seek(this.state.frame + delta)
  }
}

export const playback = new Playback()

export function usePlayback(): PlaybackState {
  return useSyncExternalStore(playback.subscribe, playback.getState)
}
